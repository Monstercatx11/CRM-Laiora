import { NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
import { getOrder, getSettings } from '@/lib/data';
import { sessionClient } from '@/lib/supabase/server';
import { DocumentError, generateDeliveryOrder } from '@/lib/documents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await accountAccess();
  if (access.status !== 'authorized') return NextResponse.json({ error: 'Silakan login menggunakan akun Laiora yang diizinkan.' }, {
    status: access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503, headers,
  });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'ID order tidak valid.' }, { status: 400, headers });
  const [order, settings] = await Promise.all([getOrder(id), getSettings()]);
  if (order.error || settings.error) return NextResponse.json({ error: order.error || settings.error }, { status: 503, headers });
  if (!order.data) return NextResponse.json({ error: 'Order tidak ditemukan.' }, { status: 404, headers });
  const path = settings.data?.logo_path;
  if (!path) return NextResponse.json({ error: 'Unggah logo resmi asli di halaman Pengaturan sebelum membuat Delivery Order. Logo tidak akan diganti atau dibuat ulang.' }, { status: 422, headers });
  if (!/^logos\/[a-zA-Z0-9._-]+\.png$/.test(path)) return NextResponse.json({ error: 'Path logo tidak valid. Unggah ulang logo resmi melalui halaman Pengaturan.' }, { status: 422, headers });
  const supabase = await sessionClient(true);
  if (!supabase) return NextResponse.json({ error: 'Koneksi Supabase belum dikonfigurasi.' }, { status: 503, headers });
  const { data: logo, error: logoError } = await supabase.storage.from('branding').download(path);
  if (logoError || !logo) return NextResponse.json({ error: 'Logo resmi belum dapat dibaca dari penyimpanan privat. Periksa unggahan logo dan migrasi branding.' }, { status: 503, headers });
  try {
    const bytes = await generateDeliveryOrder(order.data, new Uint8Array(await logo.arrayBuffer()));
    return new NextResponse(Uint8Array.from(bytes), { headers: {
      ...headers, 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="Delivery_Order_${order.data.order_no}.pdf"`,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DocumentError ? error.message : 'PDF belum dapat dibuat. Coba lagi atau periksa data order.' }, { status: error instanceof DocumentError ? 422 : 500, headers });
  }
}
