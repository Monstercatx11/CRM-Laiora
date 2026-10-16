import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PNG } from 'pngjs';
import documents from '../src/lib/documents.ts';
const { DELIVERY_LAYOUT: L, preparePrintLogo, planDeliveryOrder, generateDeliveryOrder, deliveryMethodNote, DocumentError } = documents;

// TEST FIXTURE ONLY. Never uploaded as branding or used as a substitute for the official logo.
function syntheticLogo() {
  const png = new PNG({ width: 1536, height: 1024 });
  for (let y = 73; y < 976; y++) for (let x = 38; x < 1499; x++) {
    if (y > 92 && y < 956 && x > 57 && x < 1479 && !(y > 480 && y < 500)) continue;
    const i = (y * png.width + x) * 4;
    png.data[i] = 20; png.data[i + 1] = 80; png.data[i + 2] = 160; png.data[i + 3] = 128;
  }
  // Pixel below threshold must remain transparent and must not enlarge the ink bounds.
  png.data[3] = 127;
  return PNG.sync.write(png);
}

const original = syntheticLogo();
const originalSnapshot = Buffer.from(original);
const prepared = preparePrintLogo(original);
assert.deepEqual(original, originalSnapshot, 'source bytes stay unchanged');
assert.deepEqual(prepared.bounds, { left: 38, top: 73, right: 1499, bottom: 976 });
const printLogo = PNG.sync.read(prepared.png);
assert.equal(printLogo.width / printLogo.height, 1.5);
assert.equal(printLogo.data[3], 0, 'alpha127 becomes transparent');
assert.equal(printLogo.data[(73 * 1536 + 38) * 4 + 3], 255, 'alpha128 becomes fully opaque');
for (let i = 0; i < printLogo.data.length; i += 4) {
  assert.equal(printLogo.data[i], 0); assert.equal(printLogo.data[i + 1], 0); assert.equal(printLogo.data[i + 2], 0);
  assert.ok(printLogo.data[i + 3] === 0 || printLogo.data[i + 3] === 255);
}
const scale = L.logo.width / 1536;
const logoInkTop = L.logo.y + (1024 - prepared.bounds.top) * scale;
const logoInkBottom = L.logo.y + (1024 - prepared.bounds.bottom) * scale;
const outlineInnerTop = L.border.y + L.border.height - L.border.stroke / 2;
assert.ok(Math.abs(outlineInnerTop - logoInkTop - 3 * 72 / 25.4) < 0.00001, 'top ink gap is3mm');
assert.ok(Math.abs(logoInkBottom - (L.titleY + 8.8920006752) - 3 * 72 / 25.4) < 0.00001, 'title ink gap is3mm');
assert.throws(() => preparePrintLogo(new Uint8Array([0, 1, 2])), DocumentError);
assert.throws(() => preparePrintLogo(PNG.sync.write(new PNG({ width: 30, height: 20 }))), /1536/);
const opaque = new PNG({ width: 1536, height: 1024 }); opaque.data.fill(255);
assert.throws(() => preparePrintLogo(PNG.sync.write(opaque)), /transparansi/);
const corrupt = Buffer.from(original); corrupt[32] ^= 0xff;
assert.throws(() => preparePrintLogo(corrupt), /integritas/);

const order = {
  order_no: '26-0350', state: 'confirmed', recipient_name: 'Yolanda Leonard', recipient_phone: '081234567890',
  delivery_date: '2026-10-20', delivery_time_note: 'Sebelum pukul 12.00',
  address: 'Jalan Melati nomor 8, Gedung Selatan lantai 2, Jakarta', shipping_method: 'Grab Instant',
  operational_notes: 'Titipkan kepada petugas resepsionis.',
  order_items: [{ product_name: 'Brownies Original', size: 'Regular', quantity: 2, cutting_note: 'Potong 9', item_note: null }],
  // Excluded by construction, even when a complete database order is passed.
  sender_name: 'SECRET_SENDER', sender_phone: 'SECRET_SENDER_PHONE', card_message: 'SECRET_CARD_MESSAGE',
  card_from: 'SECRET_CARD_FROM', card_to: 'SECRET_CARD_TO', subtotal: 260000, shipping_fee: 19000, grand_total: 279000,
};
const document = await PDFDocument.create();
const regular = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
const runs = planDeliveryOrder(order, regular, bold);
for (const run of runs) {
  assert.ok(run.y >= L.minimumY);
  assert.ok(run.x + (run.bold ? bold : regular).widthOfTextAtSize(run.text, run.size) <= L.right + 0.01);
}
const text = runs.map(r => r.text).join('\n');
assert.ok(text.includes('@2 Brownies Original'));
assert.ok(text.includes('20 Oktober 2026'));
assert.ok(text.includes('Selasa,'), 'delivery date includes the Indonesian weekday');
assert.ok(!text.includes('SECRET_'));
assert.ok(!text.includes('260000') && !text.includes('19000') && !text.includes('279000'));
assert.throws(() => planDeliveryOrder({ ...order, state: 'draft', order_no: null }, regular, bold), /dikonfirmasi/);
assert.throws(() => planDeliveryOrder({ ...order, recipient_phone: null }, regular, bold), /Lengkapi/);
assert.throws(() => planDeliveryOrder({ ...order, address: 'X'.repeat(5000) }, regular, bold), /melebihi/);
assert.throws(() => planDeliveryOrder({ ...order, recipient_name: 'Nama 😊' }, regular, bold), /karakter/);
for (const note of ['Rp19000', 'Ongkir: 19000', 'IDR 19000', 'Greeting Card: yes', 'Message: isi kartu', '19.000']) {
  assert.throws(() => planDeliveryOrder({ ...order, operational_notes: note }, regular, bold), /harga|ongkir/);
}
assert.equal(deliveryMethodNote(null), '- Detail pengiriman belum dicantumkan');
assert.equal(deliveryMethodNote('Pick Up'), '- Pick Up');
assert.ok(planDeliveryOrder({ ...order, shipping_method: 'Pick Up', address: null }, regular, bold).some(r => r.text === 'Pick Up'));

const pdf = await generateDeliveryOrder(order, original);
const loaded = await PDFDocument.load(pdf);
assert.equal(loaded.getPageCount(), 1);
assert.deepEqual(loaded.getPage(0).getSize(), { width: L.pageWidth, height: L.pageHeight });
const scratch = await mkdtemp(path.join(tmpdir(), 'laiora-document-test-'));
try {
  const target = path.join(scratch, 'test-only.pdf'); await writeFile(target, pdf);
  // Optional system tools strengthen checks on the actual generated artifact.
  let textTool = true; try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { textTool = false; }
  if (textTool) {
    const extracted = execFileSync('pdftotext', ['-layout', target, '-'], { encoding: 'utf8' });
    assert.match(extracted, /Order No\. 26-0350/); assert.match(extracted, /Yolanda Leonard/);
    assert.doesNotMatch(extracted, /SECRET_|260000|19000|279000/);
  }
  // Prefer the system renderer: some managed runtime wrappers have incompatible font substitution.
  let renderer = 'pdftoppm'; try { await access('/usr/bin/pdftoppm'); renderer = '/usr/bin/pdftoppm'; } catch {}
  let renderTool = true; try { execFileSync(renderer, ['-v'], { stdio: 'ignore' }); } catch { renderTool = false; }
  if (renderTool) {
    execFileSync(renderer, ['-r', '200', '-singlefile', '-png', target, path.join(scratch, 'test-only')], { stdio: 'pipe' });
    const raster = PNG.sync.read(await readFile(path.join(scratch, 'test-only.png')));
    assert.ok(Math.abs(raster.width - 100 / 25.4 * 200) < 2);
    assert.ok(Math.abs(raster.height - 150 / 25.4 * 200) < 2);
    let inkCount = 0;
    for (let i = 0; i < raster.data.length; i += 4) {
      assert.equal(raster.data[i], raster.data[i + 1], 'render contains no colored ink');
      assert.equal(raster.data[i], raster.data[i + 2]);
      if (raster.data[i] < 128) {
        inkCount++;
        const pixel = i / 4, x = pixel % raster.width, y = Math.floor(pixel / raster.width);
        const factor = 200 / 72;
        assert.ok(x >= Math.floor((L.border.x - L.border.stroke / 2) * factor) - 1);
        assert.ok(x <= Math.ceil((L.border.x + L.border.width + L.border.stroke / 2) * factor) + 1);
        assert.ok(y >= Math.floor((L.pageHeight - L.border.y - L.border.height - L.border.stroke / 2) * factor) - 1);
        assert.ok(y <= Math.ceil((L.pageHeight - L.border.y + L.border.stroke / 2) * factor) + 1);
      }
    }
    assert.ok(inkCount > 1000, 'page has visible content');
    if (process.env.LAIORA_PDF_QA_DIR) {
      const { mkdir } = await import('node:fs/promises'); await mkdir(process.env.LAIORA_PDF_QA_DIR, { recursive: true });
      await writeFile(path.join(process.env.LAIORA_PDF_QA_DIR, 'TEST_ONLY_delivery_order.pdf'), pdf);
      await writeFile(path.join(process.env.LAIORA_PDF_QA_DIR, 'TEST_ONLY_delivery_order.png'), await readFile(path.join(scratch, 'test-only.png')));
    }
  }
  console.log(`Delivery Order checks passed: locked geometry, alpha conversion, wrapping, overflow, restricted fields, actual PDF${renderTool ? ' and 200 dpi monochrome render' : ' (raster check skipped: pdftoppm unavailable)'}.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
