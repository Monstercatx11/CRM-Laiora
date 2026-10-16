import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { PNG } from 'pngjs';

/** Locked layout from README §10. Coordinates are PDF points, origin bottom-left. */
export const DELIVERY_LAYOUT = Object.freeze({
  pageWidth: 283.4646, pageHeight: 425.1969,
  border: { x: 14.17323, y: 14.17328, width: 255.11809, height: 396.8504, stroke: 0.8 },
  logo: { x: 70.0157595, y: 313.3144955761, width: 143.433081, height: 95.622054 },
  textX: 28.34646, right: 255.1, titleY: 300.4008416743, orderY: 286.8613416743,
  bodyY: 272.1680416743, bodySize: 9.5, leading: 12, minimumY: 28.34646,
});
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SOURCE_BOUNDS = { left: 38, top: 73, right: 1499, bottom: 976 };

export class DocumentError extends Error {
  constructor(message: string) { super(message); this.name = 'DocumentError'; }
}

export type DeliveryOrderInput = {
  order_no: string | null; state: string;
  recipient_name: string | null; recipient_phone: string | null;
  delivery_date: string | null; delivery_time_note: string | null;
  address: string | null; shipping_method: string | null; operational_notes: string | null;
  order_items: { product_name: string; size: string; quantity: number; cutting_note: string | null; item_note: string | null }[];
};
export type TextRun = { text: string; x: number; y: number; bold: boolean; size: number };

/** Does not modify the source. The returned PNG is exclusively for monochrome printing. */
export function preparePrintLogo(source: Uint8Array) {
  if (source.byteLength > LOGO_MAX_BYTES) throw new DocumentError('Logo maksimum 2 MiB. Unggah PNG asli tanpa mengubah canvas.');
  const input = Buffer.from(source);
  if (input.length < 33 || !input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || input.toString('ascii', 12, 16) !== 'IHDR') {
    throw new DocumentError('Logo harus berupa file PNG asli.');
  }
  // Check IHDR before decompressing untrusted image data.
  if (input.readUInt32BE(16) !== 1536 || input.readUInt32BE(20) !== 1024) {
    throw new DocumentError('Canvas logo harus persis 1536 × 1024 px (3:2), tanpa crop atau stretch.');
  }
  let decoded: PNG;
  try { decoded = PNG.sync.read(input, { checkCRC: true }); }
  catch { throw new DocumentError('File PNG tidak dapat dibaca atau pemeriksaan integritasnya gagal. Unggah ulang file asli.'); }
  const printable = new PNG({ width: decoded.width, height: decoded.height });
  let left = decoded.width, top = decoded.height, right = 0, bottom = 0;
  for (let y = 0; y < decoded.height; y++) for (let x = 0; x < decoded.width; x++) {
    const offset = (y * decoded.width + x) * 4;
    const ink = decoded.data[offset + 3] >= 128;
    printable.data[offset] = printable.data[offset + 1] = printable.data[offset + 2] = 0;
    printable.data[offset + 3] = ink ? 255 : 0;
    if (ink) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
  }
  if (left !== SOURCE_BOUNDS.left || top !== SOURCE_BOUNDS.top || right !== SOURCE_BOUNDS.right || bottom !== SOURCE_BOUNDS.bottom) {
    throw new DocumentError('Posisi tinta/transparansi logo berbeda dari template resmi. Gunakan file asli “Vintage Blue Boulangerie Emblem(2).png”, canvas 1536 × 1024 dengan latar transparan.');
  }
  return { png: PNG.sync.write(printable), bounds: { left, top, right, bottom } };
}

function clean(value: string | null | undefined) {
  return (value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
}

// Delivery documents must never accidentally inherit billing/card instructions.
function operational(value: string | null | undefined, field: string) {
  const text = clean(value);
  if (/(?:\b(?:rp\.?|idr)\s*\d)|(?:\b(?:subtotal|grand\s*total|greeting\s*card|card\s*(?:from|to|message))\b)|(?:\b(?:harga|ongkir|delivery\s*(?:fee|price))\s*:?\s*\d)|(?:\b(?:from|to|message)\s*:)|(?:[\p{Sc}]\s*\d)|(?:\b\d{1,3}(?:[.,]\d{3})+\b)/iu.test(text)) {
    throw new DocumentError(`${field} memuat harga, ongkir nominal, atau isi kartu. Pisahkan data tersebut dari instruksi operasional sebelum membuat Delivery Order.`);
  }
  return text;
}

export function deliveryMethodNote(method: string | null) {
  const raw = operational(method, 'Metode pengiriman');
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
  const methods: Record<string, string> = {
    'grab instant': 'Pengiriman Grab Instant', 'grab same day': 'Pengiriman Grab Same Day',
    'paxel same day': 'Pengiriman Paxel Same Day', grab: 'Pengiriman Grab',
    shopee: 'Pengiriman via Shopee', 'pengiriman via shopee': 'Pengiriman via Shopee',
    'penerima yang memesan grab': 'Penerima yang memesan Grab',
    'pick up': 'Pick Up', 'drop off': 'Drop Off',
  };
  return `- ${methods[normalized] ?? (raw || 'Detail pengiriman belum dicantumkan')}`;
}

function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DocumentError('Tanggal pengiriman tidak valid.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new DocumentError('Tanggal pengiriman tidak valid.');
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function checkFont(text: string, font: PDFFont) {
  try { font.encodeText(text); }
  catch { throw new DocumentError('Ada karakter yang tidak didukung font Helvetica pada data pengiriman. Hapus emoji/karakter tersebut; isi tidak akan dipotong otomatis.'); }
}

function wrapped(text: string, font: PDFFont, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    checkFont(paragraph, font);
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, DELIVERY_LAYOUT.bodySize) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      // Long URLs/addresses must wrap too, without clipping or silently dropping characters.
      for (const character of word) {
        const next = line + character;
        if (font.widthOfTextAtSize(next, DELIVERY_LAYOUT.bodySize) > width && line) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Build a full layout before drawing: overflow fails instead of returning a clipped PDF. */
export function planDeliveryOrder(order: DeliveryOrderInput, regular: PDFFont, bold: PDFFont): TextRun[] {
  if (order.state !== 'confirmed' || !order.order_no || !/^\d{2}-\d{4}$/.test(order.order_no)) throw new DocumentError('Delivery Order hanya tersedia untuk PO yang sudah dikonfirmasi.');
  if (!order.recipient_name || !order.recipient_phone || !order.delivery_date || !order.order_items.length) throw new DocumentError('Lengkapi penerima, nomor HP, tanggal kirim, dan produk sebelum membuat Delivery Order.');
  const pickup = /^(pick up|drop off)$/i.test(clean(order.shipping_method));
  const address = clean(order.address) || (pickup ? clean(order.shipping_method) : '');
  if (!address) throw new DocumentError('Lengkapi alamat kirim sebelum membuat Delivery Order.');
  const layout = DELIVERY_LAYOUT;
  const runs: TextRun[] = [
    { text: '[Delivery Order]', x: layout.textX, y: layout.titleY, bold: true, size: 12 },
    { text: `Order No. ${order.order_no}`, x: layout.textX, y: layout.orderY, bold: true, size: 10.5 },
  ];
  let y = layout.bodyY;
  function addLine(text: string, isBold = false) {
    if (y < layout.minimumY) throw new DocumentError('Isi order melebihi satu halaman 100 × 150 mm pada template terkunci. Ringkas alamat/catatan operasional atau pisahkan pengiriman; data tidak dipotong.');
    runs.push({ text, x: layout.textX, y, bold: isBold, size: layout.bodySize }); y -= layout.leading;
  }
  function field(label: string, value: string) {
    checkFont(label, bold);
    const labelWidth = bold.widthOfTextAtSize(`${label} `, layout.bodySize);
    const valueLines = wrapped(value, regular, layout.right - layout.textX - labelWidth);
    if (y < layout.minimumY) throw new DocumentError('Isi order melebihi satu halaman. Ringkas catatan sebelum membuat PDF.');
    runs.push({ text: label, x: layout.textX, y, bold: true, size: layout.bodySize });
    runs.push({ text: valueLines[0] ?? '', x: layout.textX + labelWidth, y, bold: false, size: layout.bodySize });
    y -= layout.leading;
    // Continuations use the value column, retaining the locked body line spacing.
    for (const line of valueLines.slice(1)) {
      if (y < layout.minimumY) throw new DocumentError('Isi order melebihi satu halaman. Ringkas alamat/catatan; data tidak dipotong.');
      runs.push({ text: line, x: layout.textX + labelWidth, y, bold: false, size: layout.bodySize }); y -= layout.leading;
    }
  }
  field('NAMA PENERIMA:', clean(order.recipient_name));
  field('NO HP:', clean(order.recipient_phone));
  addLine('PRODUCT:', true);
  let quantity = 0;
  for (const item of order.order_items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new DocumentError('Jumlah produk pada order tidak valid.');
    quantity += item.quantity;
    const notes = [operational(item.cutting_note, 'Catatan potong'), operational(item.item_note, 'Catatan produk')].filter(Boolean);
    const product = `- @${item.quantity} ${operational(item.product_name, 'Nama produk')} (${clean(item.size)})${notes.length ? `; ${notes.join('; ')}` : ''}`;
    wrapped(product, regular, layout.right - layout.textX).forEach(line => addLine(line));
  }
  field('QUANTITY:', String(quantity));
  field('DELIVERY DATE:', dateLabel(order.delivery_date));
  field('ALAMAT KIRIM:', address);
  addLine('NOTES:', true);
  const notes = [deliveryMethodNote(order.shipping_method), operational(order.delivery_time_note, 'Request waktu'), operational(order.operational_notes, 'Catatan operasional')].filter(Boolean);
  for (const note of notes) wrapped(note, regular, layout.right - layout.textX).forEach(line => addLine(line));
  for (const run of runs) {
    const font = run.bold ? bold : regular; checkFont(run.text, font);
    if (run.x + font.widthOfTextAtSize(run.text, run.size) > layout.right + 0.01) throw new DocumentError('Teks tidak muat di dalam outline PDF. Ringkas isian terkait.');
  }
  return runs;
}

export async function generateDeliveryOrder(order: DeliveryOrderInput, originalLogo: Uint8Array) {
  const logo = preparePrintLogo(originalLogo);
  const document = await PDFDocument.create();
  document.setTitle(`Delivery Order ${order.order_no ?? ''}`);
  document.setAuthor('Laiora Boulangerie');
  document.setSubject('Delivery Order; template 8 Oktober 2026');
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const text = planDeliveryOrder(order, regular, bold);
  const page = document.addPage([DELIVERY_LAYOUT.pageWidth, DELIVERY_LAYOUT.pageHeight]);
  page.drawRectangle({ ...DELIVERY_LAYOUT.border, borderWidth: DELIVERY_LAYOUT.border.stroke, borderColor: rgb(0, 0, 0), borderOpacity: 1 });
  const image = await document.embedPng(logo.png);
  page.drawImage(image, DELIVERY_LAYOUT.logo);
  for (const run of text) page.drawText(run.text, { x: run.x, y: run.y, size: run.size, font: run.bold ? bold : regular, color: rgb(0, 0, 0) });
  return document.save();
}
