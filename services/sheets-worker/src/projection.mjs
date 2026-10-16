// Explicit allowlist: no chat bodies, raw forms, credentials, or signed URLs.
export const HEADERS = Object.freeze({
  Orders: ['id','source_version','active','order_no','state','revision_no','channel','sender_name','sender_phone','recipient_name','recipient_phone','delivery_date','delivery_time_note','address','shipping_method','shipping_fee','product_quantity','product_total','greeting_card_choice','greeting_card_qty','card_unit_price','card_from','card_to','card_message','card_total','subtotal','grand_total','completeness','production_status','fulfillment_status','operational_notes','created_at','updated_at','dashboard_reference'],
  Order_Items: ['id','source_version','active','order_id','order_no','product_id','product_name','size','quantity','unit_price','line_total','cutting_note','item_note'],
  Production_Summary: ['id','source_version','active','order_id','order_no','delivery_date','order_state','production_status','fulfillment_status','product_name','size','quantity','cutting_note','item_note'],
  Payments: ['id','source_version','active','order_id','amount','paid_at','reference','verification_status','verified_at','verified_by','proof_reference','created_at'],
  Products: ['id','source_version','active','sku','name','size','current_price','price_effective_from'],
  Price_History: ['id','source_version','active','product_id','unit_price','effective_from'],
  Chat_Tracking: ['id','source_version','active','contact_name','contact_phone','follow_up','po_status','product_labels','order_ids','last_message_at'],
  Settings: ['id','source_version','active','business_name','timezone','greeting_card_price','updated_at'],
  Revisions: ['id','source_version','active','order_id','revision_no','actor_id','changed_at','changed_fields'],
  Sync_Status: ['id','source_version','active','entity_type','entity_id','status','last_completed','error_code'],
});

export function sourceVersion(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('INVALID_VERSION');
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error('INVALID_VERSION');
  return BigInt(text);
}

export function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_CELL');
    return value;
  }
  const text = String(value);
  // RAW writes already prevent Sheets formula execution. Prefix also protects
  // later CSV exports opened in programs that interpret formula-like strings.
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function row(tab, id, version, data, active = true) {
  return HEADERS[tab].map(key => safeCell(key === 'id' ? id : key === 'source_version' ? String(version) : key === 'active' ? active : data[key]));
}

export function project(snapshot) {
  const version = sourceVersion(snapshot.version).toString();
  const id = snapshot.entity_id;
  const d = snapshot.data;
  if (!d) throw new Error('MISSING_PROJECTION');
  const outputs = [];
  const add = (tab, rows, groupColumn = null) => outputs.push({tab,version,entityId:id,rows,groupColumn});
  switch (snapshot.entity_type) {
    case 'orders': {
      const order = d.order;
      add('Orders', [row('Orders',id,version,{...order,dashboard_reference:`/pesanan/${id}`})]);
      add('Order_Items', d.items.map(item => row('Order_Items',item.id,version,{...item,order_no:order.order_no})), 'order_id');
      add('Production_Summary', d.items.map(item => row('Production_Summary',item.id,version,{...item,order_no:order.order_no,delivery_date:order.delivery_date,order_state:order.state,production_status:order.production_status,fulfillment_status:order.fulfillment_status})), 'order_id');
      add('Revisions',(d.revisions ?? []).map(revision=>row('Revisions',revision.id,version,{...revision,changed_fields:revision.changed_fields.join(', ')})),'order_id');
      break;
    }
    case 'payments':
      add('Payments',[row('Payments',id,version,{...d,proof_reference:d.proof_path ? `/api/payments/${id}/proof` : ''})]);
      break;
    case 'products': {
      const today = snapshot.today;
      const current = [...d.prices].filter(p => p.effective_from <= today).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
      add('Products',[row('Products',id,version,{...d.product,current_price:current?.unit_price,price_effective_from:current?.effective_from},d.product.active)]);
      add('Price_History',d.prices.map(price=>row('Price_History',price.id,version,price)),'product_id');
      break;
    }
    case 'chat_opportunities':
      add('Chat_Tracking',[row('Chat_Tracking',id,version,{...d,product_labels:d.product_labels.join(', '),order_ids:d.order_ids.join(', ')})]);
      break;
    case 'app_settings':
      add('Settings',[row('Settings',id,version,d)]);
      break;
    default: throw new Error('UNSUPPORTED_ENTITY');
  }
  // This tab is written last, after all projections for the entity succeed.
  // An interrupted job is retried before the database marks it completed.
  add('Sync_Status',[row('Sync_Status',`${snapshot.entity_type}:${id}`,version,{entity_type:snapshot.entity_type,entity_id:id,status:'synced',last_completed:snapshot.projected_at ?? '',error_code:''})]);
  return outputs;
}

export function columnName(index) {
  let n = index, result = '';
  while (n > 0) { n--; result = String.fromCharCode(65+n%26)+result; n=Math.floor(n/26); }
  return result;
}

// Re-read IDs for every batch. No row-number cache survives sorting, retries,
// restarts, or independent appends. Only owned columns are ever updated.
export async function upsertProjection(api, output, assertLease = async()=>{}) {
  const {tab,rows,groupColumn,entityId,version} = output;
  const headers = HEADERS[tab];
  await assertLease();
  await api.ensureTab(tab, headers);
  await assertLease();
  const existing = await api.readRows(tab,headers.length);
  const ids = new Map();
  for (let i=0; i<existing.length; i++) {
    const old = existing[i];
    if (!old[0]) continue;
    if (ids.has(String(old[0]))) throw new Error('DUPLICATE_SHEET_ID');
    ids.set(String(old[0]),{values:old,row:i+2});
  }
  const groupIndex = groupColumn ? headers.indexOf(groupColumn) : -1;
  const selected = new Set(rows.map(r=>String(r[0])));
  const incomingVersion = sourceVersion(version);
  const affected = [...ids.values()].filter(({values})=>selected.has(String(values[0])) || (groupIndex>=0 && values[groupIndex]===entityId));
  // A delayed snapshot cannot replace even a partially written newer snapshot.
  if (affected.some(({values})=>sourceVersion(values[1] ?? 0)>incomingVersion)) return {skipped:true,written:0};
  const updates = [];
  let nextRow = existing.length+2;
  for (const values of rows) {
    const existingRow = ids.get(String(values[0]));
    updates.push({row:existingRow?.row ?? nextRow++,values});
  }
  // Replaced/deleted items become tombstones, retaining their stable ID. Reports
  // must filter active=TRUE. Retry and multiple updates preserve the latest set.
  if (groupIndex >= 0) for (const old of affected) {
    if (selected.has(String(old.values[0]))) continue;
    const values = [...old.values];
    while (values.length < headers.length) values.push('');
    values[1] = String(version); values[2] = false;
    updates.push({row:old.row,values:values.slice(0,headers.length)});
  }
  if (updates.length) { await assertLease(); await api.writeRows(tab,headers.length,updates); }
  return {skipped:false,written:updates.length};
}
