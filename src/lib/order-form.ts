// Deterministic form normalization shared by the server action and browser preview.
// Important order facts are never inferred from an ambiguous chat.
export type ProductOption = { id: string; name: string; size: string; unit_price?: number | null };
export type InputItem = { id?: string; product_id: string; quantity: number; cutting_note: string; item_note: string };
export type NormalizedOrderInput = {
  order_id: string | null; expected_revision: number | null; opportunity_id: string | null;
  intent: 'draft' | 'confirm'; items: InputItem[];
  raw_form: string | null; channel: string; sender_name: string | null; sender_phone: string | null;
  recipient_name: string | null; recipient_phone: string | null; delivery_date: string | null;
  delivery_time_note: string | null; address: string | null; shipping_method: string | null;
  shipping_fee: number | null; greeting_card_choice: 'yes' | 'no' | 'undecided'; greeting_card_qty: number;
  card_from: string | null; card_to: string | null; card_message: string | null; operational_notes: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizePhone(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  const digits = clean.replace(/[\s().-]/g, '');
  if (/^\+62\d+$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^62\d{8,13}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}
export function normalizeName(value: string) {
  const clean = value.trim().replace(/\s+/g, ' ');
  // Preserve intentional mixed casing, acronyms, and spelling; only clean all-uppercase names.
  return clean === clean.toLocaleUpperCase('id-ID') ? clean.toLocaleLowerCase('id-ID').replace(/(^|\s)\p{L}/gu, l => l.toLocaleUpperCase('id-ID')) : clean;
}
export function normalizeShippingMethod(value: string) {
  const clean = value.trim().replace(/\s+/g, ' ');
  const maps: Record<string, string> = { 'grab instan':'Grab Instant', 'grab instant':'Grab Instant', 'grab sameday':'Grab Same Day', 'grab same day':'Grab Same Day', 'paxel sameday':'Paxel Same Day', 'paxel same day':'Paxel Same Day', 'pick up':'Pick Up', 'pickup':'Pick Up', 'pick up sendiri':'Pick Up', 'puck up':'Pick Up', 'drop off':'Drop Off', 'shopee':'Pengiriman via Shopee', 'pengiriman via shopee':'Pengiriman via Shopee', 'penerima yang memesan grab':'Penerima yang memesan Grab', 'penerima memesan kurir':'Penerima memesan kurir' };
  return maps[clean.toLowerCase()] ?? clean;
}
export function defaultShippingFee(method: string, fee: string): number | null {
  if (fee.trim() !== '') return Number(fee);
  return ['Pick Up','Drop Off','Penerima yang memesan Grab','Penerima memesan kurir'].includes(normalizeShippingMethod(method)) ? 0 : null;
}
export function validateOrderInput(form: FormData): { data: NormalizedOrderInput | null; error: string | null } {
  const read = (key: string, max = 3000) => {
    const value = form.get(key);
    if (value !== null && typeof value !== 'string') throw new Error(`Isian ${key} tidak valid.`);
    const text = (value ?? '').toString().trim();
    if (text.length > max) throw new Error(`Isian ${key} terlalu panjang (maksimum ${max} karakter).`);
    return text;
  };
  try {
    const uuid = (key: string) => { const v = read(key, 36); if (v && !UUID.test(v)) throw new Error('ID order atau chat tidak valid.'); return v || null; };
    const order_id = uuid('order_id');
    const expected = read('expected_revision', 12);
    const expected_revision = expected === '' ? null : Number(expected);
    if (order_id && (expected_revision === null || !Number.isSafeInteger(expected_revision) || expected_revision < 0)) throw new Error('Versi order tidak valid. Muat ulang halaman.');
    const rawItems = JSON.parse(read('items', 100000) || '[]');
    if (!Array.isArray(rawItems) || rawItems.length > 100) throw new Error('Maksimum 100 baris produk per order.');
    const items: InputItem[] = rawItems.map((item: Record<string, unknown>) => {
      if (!item || typeof item !== 'object' || typeof item.product_id !== 'string' || !UUID.test(item.product_id)) throw new Error('Pilih produk untuk setiap baris.');
      const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Jumlah produk harus bilangan bulat 1–10.000.');
      const note = (key: string) => { const v = item[key]; if (v !== undefined && typeof v !== 'string') throw new Error('Catatan produk tidak valid.'); if (String(v ?? '').length > 1000) throw new Error('Catatan produk terlalu panjang.'); return String(v ?? '').trim(); };
      if (item.id !== undefined && (typeof item.id !== 'string' || !UUID.test(item.id))) throw new Error('ID item tidak valid.');
      return { ...(item.id ? { id: String(item.id) } : {}), product_id: item.product_id, quantity, cutting_note: note('cutting_note'), item_note: note('item_note') };
    });
    const intent = read('intent', 10) || 'draft';
    if (intent !== 'draft' && intent !== 'confirm') throw new Error('Tindakan order tidak valid.');
    const delivery_date = read('delivery_date', 10) || null;
    if (delivery_date && (!/^\d{4}-\d{2}-\d{2}$/.test(delivery_date) || !Number.isFinite(Date.parse(`${delivery_date}T00:00:00Z`)) || new Date(`${delivery_date}T00:00:00Z`).toISOString().slice(0,10) !== delivery_date)) throw new Error('Tanggal pengiriman tidak valid.');
    if (intent === 'confirm' && !delivery_date) throw new Error('Tanggal pengiriman wajib diisi sebelum konfirmasi.');
    if (intent === 'confirm' && !items.length) throw new Error('Tambahkan paling sedikit satu produk sebelum konfirmasi.');
    const sender_name = normalizeName(read('sender_name', 200)) || null;
    let sender_phone = normalizePhone(read('sender_phone', 40)) || null;
    const same = read('recipient_name', 200).toLowerCase() === 'sama';
    const recipient_name = same ? sender_name : normalizeName(read('recipient_name', 200)) || null;
    const recipient_phone = same ? sender_phone || normalizePhone(read('recipient_phone', 40)) || null : normalizePhone(read('recipient_phone', 40)) || null;
    if (same && !sender_phone && recipient_phone) sender_phone = recipient_phone;
    for (const phone of [sender_phone, recipient_phone]) if (phone && !/^\+?\d{7,16}$/.test(phone)) throw new Error('Nomor HP harus 7–16 digit. Gunakan nomor lengkap, misalnya 0812… atau +62812….');
    const choice = read('greeting_card_choice', 10) || 'undecided';
    if (!['yes','no','undecided'].includes(choice)) throw new Error('Pilihan kartu ucapan tidak valid.');
    const card_from = read('card_from', 300) || null, card_to = read('card_to', 300) || null, card_message = read('card_message', 3000) || null;
    const greeting_card_choice = choice === 'undecided' && (card_from || card_to || card_message) ? 'yes' : choice as 'yes' | 'no' | 'undecided';
    const cardQty = read('greeting_card_qty', 8);
    const greeting_card_qty = greeting_card_choice === 'yes' ? (cardQty ? Number(cardQty) : 1) : 0;
    if (!Number.isSafeInteger(greeting_card_qty) || greeting_card_qty < (greeting_card_choice === 'yes' ? 1 : 0) || greeting_card_qty > 10000) throw new Error('Jumlah kartu harus bilangan bulat 1–10.000.');
    const fee = read('shipping_fee', 15);
    const shipping_method = normalizeShippingMethod(read('shipping_method',200)) || null;
    const shipping_fee = defaultShippingFee(shipping_method ?? '', fee);
    if (shipping_fee !== null && (!Number.isSafeInteger(shipping_fee) || shipping_fee < 0 || shipping_fee > 1000000000)) throw new Error('Ongkir harus angka rupiah utuh, minimum 0.');
    const channel = read('channel', 50) || 'manual';
    if (!['manual','whatsapp','shopee','instagram','other'].includes(channel)) throw new Error('Sumber pesanan tidak valid.');
    return { error: null, data: { order_id, expected_revision, opportunity_id: uuid('opportunity_id'), intent, items, raw_form: read('raw_form', 50000) || null, channel, sender_name, sender_phone, recipient_name, recipient_phone, delivery_date, delivery_time_note: read('delivery_time_note',300)||null, address:read('address',3000)||null, shipping_method, shipping_fee, greeting_card_choice, greeting_card_qty, card_from:greeting_card_choice==='no'?null:card_from, card_to:greeting_card_choice==='no'?null:card_to, card_message:greeting_card_choice==='no'?null:card_message, operational_notes:read('operational_notes',5000)||null } };
  } catch (error) { return { data:null, error:error instanceof SyntaxError ? 'Daftar produk tidak valid. Muat ulang form.' : error instanceof Error ? error.message : 'Form order tidak valid.' }; }
}
export type ParsedForm = { fields: Record<string,string>; items: InputItem[]; warnings: string[] };
export function parseWhatsAppForm(text: string, products: ProductOption[]): ParsedForm {
  const fields: Record<string,string> = {}, warnings: string[] = [], items: InputItem[] = [];
  const lines = text.split(/\r?\n/); let block = ''; let phoneIndex = 0;
  const mapping: Record<string,string> = { 'nama pemesan':'sender_name','nama pemesanan':'sender_name','nama penerima':'recipient_name','delivery date':'delivery_date','tanggal kirim':'delivery_date','alamat kirim':'address','alamat':'address','notes':'operational_notes','catatan':'operational_notes','from':'card_from','to':'card_to','message':'card_message','pengiriman':'shipping_method','metode kirim':'shipping_method' };
  for (const raw of lines) {
    const line = raw.trim(); if (!line || /^\*{3,}$/.test(line)) { block=''; continue; }
    const labeled = line.match(/^\*?([^:]{2,40}?)\*?\s*:\s*(.*)$/);
    if (labeled) {
      const key=labeled[1].toLowerCase().replace(/\*/g,'').trim(), value=labeled[2].trim(); block='';
      if (/^(no\.?\s*hp|nomor hp|phone|whatsapp)$/.test(key)) { fields[phoneIndex++===0?'sender_phone':'recipient_phone']=normalizePhone(value); continue; }
      if (key==='greeting card') { fields.greeting_card_choice=/^(ya|yes)$/i.test(value)?'yes':/^(tidak|no)$/i.test(value)?'no':'undecided'; continue; }
      if (key==='product'||key==='produk') { block='product'; if (value) lines.push(`- ${value}`); continue; }
      const field=mapping[key];
      if (field) { fields[field]=value; block=field==='address'||field==='operational_notes'||field==='card_message'?field:''; }
      continue;
    }
    const itemLine=line.match(/^[-•]?\s*@?(\d+)\s*[x×]?\s+(.+)$/i);
    if (itemLine) {
      const description=itemLine[2].replace(/\*/g,'').trim(); const lower=description.toLowerCase();
      const personal=/personal|18\s*[x×]\s*10|9\s*[x×]\s*9/i.test(lower); const size=personal?'Personal':'Regular';
      let aliases=lower.replace(/\b(ori|origin)\b/g,'original').replace(/ferero/g,'ferrero').replace(/ovalmatine|ovamaltine|\bovo\b/g,'ovomaltine').replace(/choco chips classic/g,'choco chips').replace(/chocolate/g,'choco');
      if (/bolu/.test(aliases)) { if (/mix|choco cheese|coklat keju|keju n meses|ceres n keju/.test(aliases)) aliases='bolu jadul choco cheese'; else if (/coklat|choco/.test(aliases)) aliases=personal?'bolu jadul choco':'bolu jadul full choco'; else if (/cheese|keju/.test(aliases)) aliases=personal?'bolu jadul cheese':'bolu jadul full cheese'; }
      const candidates=products.filter(p=>p.size===size && aliases.includes(p.name.toLowerCase())).sort((a,b)=>b.name.length-a.name.length);
      // A mixed box needs human review; picking one matching component would invent its price.
      if (/\bmix(ed)?\b|\s[+x×]\s/.test(lower) && /brownies/.test(lower)) { warnings.push(`Tinjau mixed brownies secara manual: ${description}`); continue; }
      const product=candidates[0];
      if (!product) { warnings.push(`Produk belum dikenali: ${description}`); continue; }
      const cut=description.match(/potong\s*\d+/i)?.[0]??'';
      items.push({product_id:product.id,quantity:Number(itemLine[1]),cutting_note:cut,item_note:''}); continue;
    }
    if (block && block!=='product') fields[block]+=`\n${line}`;
  }
  if (fields.delivery_date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.delivery_date)) {
    const months=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
    const match=fields.delivery_date.toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(20\d{2})/);
    if (match && months.includes(match[2])) { fields.delivery_time_note=fields.delivery_date.match(/\(([^)]+)\)/)?.[1]??fields.delivery_date.match(/\b(pagi|siang|sore|malam)\b/i)?.[1]??''; fields.delivery_date=`${match[3]}-${String(months.indexOf(match[2])+1).padStart(2,'0')}-${match[1].padStart(2,'0')}`; }
    else { warnings.push(`Tanggal perlu diisi manual: ${fields.delivery_date}`); delete fields.delivery_date; }
  }
  if (fields.recipient_name?.toLowerCase()==='sama') { fields.recipient_name=fields.sender_name??''; fields.recipient_phone=fields.sender_phone??fields.recipient_phone??''; }
  if (fields.greeting_card_choice==='no') { fields.card_from=''; fields.card_to=''; fields.card_message=''; }
  else if (fields.card_from||fields.card_to||fields.card_message) fields.greeting_card_choice='yes';
  if (fields.shipping_method) fields.shipping_method=normalizeShippingMethod(fields.shipping_method);
  if (!items.length) warnings.push('Belum ada produk yang dikenali. Tambahkan produk secara manual.');
  warnings.unshift('Hasil ini usulan dari label form, bukan pembacaan seluruh konteks chat. Periksa semua isian sebelum menyimpan.');
  return {fields,items,warnings};
}

export function orderConfirmation(order: import('./types').Order, settings: Pick<import('./types').BusinessSettings,'bank_name'|'bank_account'|'bank_holder'|'business_name'>) {
  const rp=(amount:number)=>`Rp${new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(amount)}`;
  const date=order.delivery_date?new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${order.delivery_date}T12:00:00Z`)):'Belum diisi';
  const products=order.order_items.map(i=>`- @${i.quantity} ${i.product_name} (${i.size})${i.cutting_note?` · ${i.cutting_note}`:''} = ${rp(i.line_total)}`);
  if(order.greeting_card_choice==='yes')products.push(`- @${order.greeting_card_qty} Greeting Card = ${rp(order.card_total)}`);
  return [`*Order No. ${order.order_no??'Draft — belum dikonfirmasi'}*`,'','Thank you for your order!','','NAMA PEMESANAN: '+(order.sender_name||'Belum diisi'),'NO HP: '+(order.sender_phone||'Belum diisi'),'PRODUCT:',...products,'',`_*Subtotal= ${rp(order.subtotal)}_`,'',`QUANTITY: ${order.product_quantity}`,`DELIVERY DATE: ${date}${order.delivery_time_note?` (${order.delivery_time_note})`:''}`,'',`Delivery price: ${order.shipping_fee===null?'':rp(order.shipping_fee)}`,'',`*GRAND TOTAL= ${order.grand_total===null?`${rp(order.subtotal)} + Delivery price`:rp(order.grand_total)}*`,'',...(order.channel==='shopee'?['Order via Shopee']:['Kindly transfer to:',settings.bank_account,`${settings.bank_name} a/n ${settings.bank_holder}`,'(Mohon isi no. order di kolom berita)']),'','We hope to create more sweet moments for you soon!','','',settings.business_name,'#Magical in every bite#'].join('\n');
}
export function normalizedOrderForm(order: import('./types').Order) {
  const date=order.delivery_date?new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${order.delivery_date}T12:00:00Z`)):'Belum diisi';
  return ['[Form Order]','','NAMA PEMESAN: '+(order.sender_name||'Belum diisi'),'NO HP: '+(order.sender_phone||'Belum diisi'),'PRODUCT:',...order.order_items.map(i=>`- @${i.quantity} ${i.product_name} (${i.size})${i.cutting_note?` (${i.cutting_note})`:''}`),`QUANTITY: ${order.product_quantity}`,`DELIVERY DATE: ${date}${order.delivery_time_note?` (${order.delivery_time_note})`:''}`,...(order.greeting_card_choice==='no'?[]:['','*******',`Greeting Card: ${order.greeting_card_choice==='yes'?'Ya':'Belum dipilih'}`,...(order.greeting_card_choice==='yes'?[`Jumlah kartu: ${order.greeting_card_qty}`,`From: ${order.card_from||''}`,`To: ${order.card_to||''}`,`Message: ${order.card_message||''}`]:[]),'*******']),'','NAMA PENERIMA: '+(order.recipient_name||'Belum diisi'),'ALAMAT KIRIM: '+(order.address||'Belum diisi'),'No HP: '+(order.recipient_phone||'Belum diisi'),'NOTES: '+([order.shipping_method,order.operational_notes].filter(Boolean).join('\n')||'Belum diisi')].join('\n');
}
