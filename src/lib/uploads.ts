export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export type ProofKind = { extension: 'png' | 'jpg' | 'pdf'; contentType: 'image/png' | 'image/jpeg' | 'application/pdf' };
export class UploadError extends Error {
  constructor(message: string, public status = 422) { super(message); this.name = 'UploadError'; }
}

/** Magic bytes determine the stored MIME, never the file name supplied by a browser. */
export function validateProofFile(bytes: Uint8Array): ProofKind {
  if (!bytes.byteLength) throw new UploadError('File bukti pembayaran kosong.');
  if (bytes.byteLength > PROOF_MAX_BYTES) throw new UploadError('Bukti pembayaran maksimum 10 MiB.', 413);
  const source = Buffer.from(bytes);
  if (source.length >= 33 && source.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && source.toString('ascii',12,16) === 'IHDR' && source.readUInt32BE(16) > 0 && source.readUInt32BE(20) > 0) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (source.length >= 4 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (source.length >= 16 && /^%PDF-(?:1\.[0-7]|2\.0)/.test(source.toString('ascii',0,8)) && source.subarray(Math.max(0, source.length - 1024)).includes(Buffer.from('%%EOF'))) {
    return { extension: 'pdf', contentType: 'application/pdf' };
  }
  throw new UploadError('File tidak dikenali sebagai PNG, JPEG, atau PDF. Pilih file bukti asli; SVG dan format lain tidak didukung.');
}

export function proofKindFromMime(mime: unknown): ProofKind {
  if (mime === 'image/png') return { extension: 'png', contentType: 'image/png' };
  if (mime === 'image/jpeg') return { extension: 'jpg', contentType: 'image/jpeg' };
  if (mime === 'application/pdf') return { extension: 'pdf', contentType: 'application/pdf' };
  throw new UploadError('Pilih file PNG, JPEG, atau PDF.');
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export function isPaymentProofPath(paymentId: string, path: unknown): path is string {
  if (!new RegExp(`^${UUID}$`, 'i').test(paymentId) || typeof path !== 'string') return false;
  const match = path.match(new RegExp(`^payments/(${UUID})/(${UUID})[.](png|jpg|jpeg|pdf)$`, 'i'));
  return !!match && match[1] === paymentId;
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw new UploadError('Permintaan unggahan kosong.', 400);
  const reader = request.body.getReader();
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new UploadError('Ukuran unggahan melebihi batas.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Uint8Array.from(Buffer.concat(chunks));
}
