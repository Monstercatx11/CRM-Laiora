import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase/server';
import { isPaymentProofPath, PROOF_MAX_BYTES, proofKindFromMime, readLimitedBody, UploadError, validateProofFile } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };

async function authorizedPayment(context: Context) {
  const access = await accountAccess();
  if (access.status !== 'authorized') return { response: NextResponse.json({ error: 'Silakan login menggunakan akun Laiora yang diizinkan.' }, {
    status: access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503, headers,
  }) };
  const { id } = await context.params;
  if (!UUID.test(id)) return { response: NextResponse.json({ error: 'ID pembayaran tidak valid.' }, { status: 400, headers }) };
  const db = await sessionClient(true);
  if (!db) return { response: NextResponse.json({ error: 'Koneksi Supabase belum dikonfigurasi.' }, { status: 503, headers }) };
  const { data: payment, error } = await db.from('payments').select('id,proof_path').eq('id',id).maybeSingle();
  if (error) return { response: NextResponse.json({ error: 'Pembayaran belum dapat dibaca. Periksa koneksi database.' }, { status: 503, headers }) };
  if (!payment) return { response: NextResponse.json({ error: 'Pembayaran tidak ditemukan.' }, { status: 404, headers }) };
  return { db, payment: payment as { id: string; proof_path: string | null } };
}

export async function GET(request: Request, context: Context) {
  try {
    const auth = await authorizedPayment(context); if (auth.response) return auth.response;
    const { db, payment } = auth;
    if (!isPaymentProofPath(payment.id,payment.proof_path)) return NextResponse.json({ error: 'Bukti pembayaran belum tersedia. Unggah bukti terlebih dahulu.' }, { status: 404, headers });
    const { data: file, error } = await db.storage.from('payment-proofs').download(payment.proof_path);
    if (error || !file) return NextResponse.json({ error: 'Bukti pembayaran belum dapat dibaca dari penyimpanan privat.' }, { status: 503, headers });
    const bytes = new Uint8Array(await file.arrayBuffer()); const kind = validateProofFile(bytes);
    if (new URL(request.url).searchParams.get('direct') === '1') {
      const {data,error:signingError}=await db.storage.from('payment-proofs').createSignedUrl(payment.proof_path,60,{download:`Bukti_Pembayaran_${payment.id}.${kind.extension}`});
      if(signingError||!data) throw new UploadError('Izin unduh bukti belum dapat dibuat. Coba lagi.',503);
      return NextResponse.json({signedUrl:data.signedUrl,contentType:kind.contentType,extension:kind.extension},{headers});
    }
    return new NextResponse(bytes, { headers: { ...headers, 'Content-Type': kind.contentType,
      'Content-Disposition': `attachment; filename="Bukti_Pembayaran_${payment.id}.${kind.extension}"` } });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof UploadError ? error.message : 'Bukti pembayaran belum dapat diproses. Periksa koneksi lalu coba lagi.' }, { status: error instanceof UploadError ? error.status : 503, headers });
}

export async function POST(request: Request, context: Context) {
  try {
    const auth = await authorizedPayment(context); if (auth.response) return auth.response;
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Asal permintaan tidak diizinkan.' }, { status: 403, headers });
    const { db, payment } = auth;
    const bucket = db.storage.from('payment-proofs');
    let path: string;
    if (request.headers.get('content-type')?.startsWith('application/json')) {
      let input: { action?: unknown; contentType?: unknown; size?: unknown; path?: unknown };
      try { input = JSON.parse(Buffer.from(await readLimitedBody(request, 8192)).toString('utf8')); }
      catch (error) { throw error instanceof UploadError ? error : new UploadError('Permintaan unggahan tidak valid.', 400); }
      if (!input || typeof input !== 'object') throw new UploadError('Permintaan unggahan tidak valid.', 400);
      if (input.action === 'prepare') {
        const kind = proofKindFromMime(input.contentType);
        if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > PROOF_MAX_BYTES) throw new UploadError('Bukti pembayaran harus berukuran 1 byte sampai 10 MiB.', 413);
        path = `payments/${payment.id}/${randomUUID()}.${kind.extension}`;
        const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false });
        if (error || !data) throw new UploadError('Izin unggah belum dapat dibuat. Pastikan migrasi bukti pembayaran sudah diterapkan.', 503);
        // Uploads go directly to private Storage, so 10MiB files do not cross Vercel's function payload limit.
        return NextResponse.json({ path, signedUrl: data.signedUrl }, { headers });
      }
      if (input.action !== 'complete' || !isPaymentProofPath(payment.id,input.path)) throw new UploadError('Path bukti pembayaran tidak valid.', 400);
      path = input.path;
      const { data: file, error } = await bucket.download(path);
      if (error || !file) throw new UploadError('File belum selesai diunggah. Pilih ulang file lalu coba lagi.', 422);
      try {
        const kind = validateProofFile(new Uint8Array(await file.arrayBuffer()));
        if (!path.endsWith(`.${kind.extension}`) && !(kind.extension === 'jpg' && path.endsWith('.jpeg'))) throw new UploadError('Isi file berbeda dari format unggahan. Gunakan file PNG, JPEG, atau PDF asli.');
      } catch (error) { if (path !== payment.proof_path) await bucket.remove([path]); throw error; }
    } else if (request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
      // Supported for self-hosted clients; the browser UI uses signed direct uploads above.
      const bytes = await readLimitedBody(request, PROOF_MAX_BYTES + 65536);
      let form: FormData;
      try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
      catch { throw new UploadError('Form unggahan tidak valid.', 400); }
      const file = form.get('proof');
      if (!(file instanceof File)) throw new UploadError('Pilih bukti pembayaran terlebih dahulu.');
      const original = new Uint8Array(await file.arrayBuffer()); const kind = validateProofFile(original);
      path = `payments/${payment.id}/${randomUUID()}.${kind.extension}`;
      const { error } = await bucket.upload(path,original,{ contentType: kind.contentType, upsert:false, cacheControl:'0' });
      if (error) throw new UploadError('File belum berhasil disimpan. Periksa koneksi dan migrasi penyimpanan.',503);
    } else throw new UploadError('Format permintaan unggahan tidak didukung.',400);
    const { error } = await db.rpc('laiora_attach_payment_proof',{ p_payment_id:payment.id,p_path:path });
    if (error) {
      if (path !== payment.proof_path) await bucket.remove([path]);
      throw new UploadError('File belum dapat dihubungkan ke pembayaran. Bukti sebelumnya tetap tersimpan; periksa migrasi lalu coba lagi.',503);
    }
    return NextResponse.json({ message:'Bukti pembayaran tersimpan privat. Status verifikasi pembayaran tetap perlu diperiksa admin.' },{ headers });
  } catch (error) { return failure(error); }
}
