import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
import uploads from '../src/lib/uploads.ts';
const { validateProofFile, proofKindFromMime, isPaymentProofPath, readLimitedBody, PROOF_MAX_BYTES, UploadError } = uploads;

const png = PNG.sync.write(new PNG({width:2,height:2}));
assert.deepEqual(validateProofFile(png),{extension:'png',contentType:'image/png'});
assert.deepEqual(validateProofFile(Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0xff,0xd9])),{extension:'jpg',contentType:'image/jpeg'});
const document=await PDFDocument.create();document.addPage();
assert.deepEqual(validateProofFile(await document.save()),{extension:'pdf',contentType:'application/pdf'});
for(const content of ['<svg xmlns="http://www.w3.org/2000/svg"/>','<html>not a PDF</html>','GIF89a','%PDF-1.7 truncated']) {
  assert.throws(()=>validateProofFile(Buffer.from(content)),UploadError);
}
assert.throws(()=>validateProofFile(new Uint8Array()),/kosong/);
assert.throws(()=>validateProofFile(new Uint8Array(PROOF_MAX_BYTES+1)),error=>error.status===413);
assert.throws(()=>proofKindFromMime('image/svg+xml'),/PNG/);
assert.deepEqual(proofKindFromMime('image/jpeg'),{extension:'jpg',contentType:'image/jpeg'});

const payment='e41a3083-fa61-47cb-9758-e0f682c7eb61',other='f41a3083-fa61-47cb-9758-e0f682c7eb61';
const object='b41a3083-fa61-47cb-9758-e0f682c7eb61';
assert.ok(isPaymentProofPath(payment,`payments/${payment}/${object}.pdf`));
assert.ok(!isPaymentProofPath(payment,`payments/${other}/${object}.pdf`));
assert.ok(!isPaymentProofPath(payment,`payments/${payment}/../../logo.png`));
assert.ok(!isPaymentProofPath(payment,`https://example.com/${object}.pdf`));
assert.ok(!isPaymentProofPath(payment,`payments/${payment}/${object}.svg`));
assert.ok(!isPaymentProofPath(payment,`payments/${payment}/${object}Xpdf`));
assert.ok(!isPaymentProofPath(payment,'payments/no-uuid/no-uuid.png'));

const body=Buffer.from('limited payload');
assert.deepEqual(Buffer.from(await readLimitedBody(new Request('http://localhost',{method:'POST',body}),body.length)),body);
await assert.rejects(()=>readLimitedBody(new Request('http://localhost',{method:'POST',body}),body.length-1),error=>error.status===413);
console.log('Payment proof checks passed: MIME signatures, rejected SVG/HTML/truncation/oversize, payment-bound immutable paths, streamed request limit.');
