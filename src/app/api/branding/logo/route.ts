import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase/server';
import { DocumentError, LOGO_MAX_BYTES, preparePrintLogo } from '@/lib/documents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

async function uploadForm(request: Request) {
  if (!request.body || !request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new DocumentError('Unggah file PNG melalui form logo.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > LOGO_MAX_BYTES + 65536) { await reader.cancel(); throw new DocumentError('Ukuran unggahan terlalu besar. Logo maksimum 2 MiB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Uint8Array.from(Buffer.concat(chunks));
  return new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
}

export async function POST(request: Request) {
  const access = await accountAccess();
  if (access.status !== 'authorized') return NextResponse.json({ error: 'Silakan login menggunakan akun Laiora yang diizinkan.' }, {
    status: access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503, headers,
  });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Asal permintaan tidak diizinkan.' }, { status: 403, headers });
  try {
    let form: FormData;
    try { form = await uploadForm(request); }
    catch (error) { throw error instanceof DocumentError ? error : new DocumentError('Form unggahan tidak valid. Pilih ulang file PNG asli.'); }
    const file = form.get('logo');
    if (!(file instanceof File) || file.type !== 'image/png' || !file.size || file.size > LOGO_MAX_BYTES) throw new DocumentError('Pilih file PNG asli, maksimum 2 MiB.');
    const original = new Uint8Array(await file.arrayBuffer());
    preparePrintLogo(original); // Validation only: store the exact original bytes, never the print conversion.
    const supabase = await sessionClient(true);
    if (!supabase) return NextResponse.json({ error: 'Koneksi Supabase belum dikonfigurasi.' }, { status: 503, headers });
    const path = `logos/${randomUUID()}.png`;
    const { error: uploadError } = await supabase.storage.from('branding').upload(path, original, { contentType: 'image/png', upsert: false, cacheControl: '0' });
    if (uploadError) return NextResponse.json({ error: 'Logo belum berhasil disimpan. Pastikan migrasi branding sudah diterapkan dan akun memiliki akses.' }, { status: 503, headers });
    const { error: settingsError } = await supabase.rpc('laiora_update_settings', { p_settings: { logo_path: path } });
    if (settingsError) {
      await supabase.storage.from('branding').remove([path]);
      return NextResponse.json({ error: 'Pengaturan logo belum tersimpan. Logo lama tetap aktif; coba unggah ulang setelah memeriksa migrasi terbaru.' }, { status: 503, headers });
    }
    return NextResponse.json({ message: 'Logo asli tersimpan privat. Konversi hitam-putih hanya dilakukan saat membuat PDF.', path }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DocumentError ? error.message : 'Unggahan logo belum berhasil. Coba lagi.' }, { status: error instanceof DocumentError ? 422 : 500, headers });
  }
}
