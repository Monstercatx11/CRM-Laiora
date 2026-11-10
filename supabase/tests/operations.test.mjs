import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = new PGlite();
const account = '11111111-1111-1111-1111-111111111111';
const stranger = '22222222-2222-2222-2222-222222222222';
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function scalar(sql, params = []) { return Object.values((await rows(sql, params))[0])[0]; }
async function reject(sql, params, pattern) { await assert.rejects(db.query(sql, params), pattern); }
async function login(user = account) {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${user}'`);
}
async function owner() { await db.exec('reset role'); }
async function save(order, items, id = null, revision = null, confirm = false, opportunity = null) {
  return scalar('select public.laiora_save_order($1::jsonb,$2::jsonb,$3::uuid,$4::integer,$5::boolean,$6::uuid)',
    [JSON.stringify(order), JSON.stringify(items), id, revision, confirm, opportunity]);
}
async function readOrder(id) { return (await rows('select *,grand_total::text as total_text from public.orders where id=$1', [id]))[0]; }
async function itemsFor(id) { return rows('select * from public.order_items where order_id=$1 order by id', [id]); }
async function product(id, price, name = 'Produk Uji', active = true, from = '2000-01-01') {
  return scalar('select public.laiora_save_product($1,$2,$3,$4,$5,$6,$7)', [id, 'SYNTHETIC', name, 'Regular', price, from, active]);
}

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;
grant select on storage.objects to authenticated;
`);
const migrations = new URL('../migrations/', import.meta.url);
for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(name, migrations), 'utf8'));
}
await db.exec(`insert into auth.users values('${account}'),('${stranger}')`);
await login();
await check('RPC rejects an unbound authenticated account', async () =>
  reject('select public.laiora_get_sequence()', [], /tidak memiliki akses/));
await owner();
await db.exec(`insert into laiora_private.app_account(user_id) values('${account}')`);
await login(stranger);
await check('another authenticated account cannot change settings', async () =>
  reject(`select public.laiora_update_settings('{}')`, [], /tidak memiliki akses/));
await owner();
await db.exec('set role anon');
await check('anonymous callers cannot invoke mutation RPCs', async () =>
  reject('select public.laiora_initialize_sequence(2026,0)', [], /permission denied/));
await login();
await check('the browser cannot spoof the private batching context', async () =>
  reject('insert into laiora_private.order_mutations values(gen_random_uuid(),txid_current(),true)', [], /permission denied/));
await check('no historical SOP number is silently used as live counter', async () =>
  assert.deepEqual(await scalar('select public.laiora_get_sequence()'), []));

const year = await scalar(`select extract(year from now() at time zone 'Asia/Jakarta')::integer`);
await scalar('select public.laiora_initialize_sequence($1,10)', [year]);
await check('counter initialization is idempotent, not resettable', async () => {
  await scalar('select public.laiora_initialize_sequence($1,10)', [year]);
  await reject('select public.laiora_initialize_sequence($1,9)', [year], /tidak boleh direset/);
  await reject('select public.laiora_initialize_sequence($1,11)', [year], /tidak boleh direset/);
  assert.deepEqual(await scalar('select public.laiora_get_sequence()'), [{ year, last_value: 10 }]);
});
await check('settings validate timezone and accept partial updates', async () => {
  await scalar(`select public.laiora_update_settings(' {"business_name":"Laiora Uji","logo_path":"logos/test.png"}')`);
  await scalar(`select public.laiora_update_settings('{"greeting_card_price":6000}')`);
  assert.equal(await scalar('select logo_path from public.app_settings'), 'logos/test.png');
  await reject(`select public.laiora_update_settings('{"timezone":"Not/AZone"}')`, [], /Zona waktu/);
  await reject(`select public.laiora_update_settings('{"singleton":false}')`, [], /tidak didukung/);
  await reject(`select public.laiora_update_settings('{"logo_path":"../secret.png"}')`, [], /Path logo/);
});
const pid = await product(null, 65000);
const base = { sender_name: 'Pelanggan Uji', sender_phone: '081234', recipient_name: 'Penerima Uji', recipient_phone: '081234',
  delivery_date: `${year}-12-20`, shipping_method: 'Grab Instant', shipping_fee: null, greeting_card_choice: 'no', greeting_card_qty: 0 };
const one = [{ product_id: pid, quantity: 1, cutting_note: 'Potong 9', item_note: '' }];
let oid;
await check('one save creates a full revision zero with server-priced snapshots', async () => {
  oid = await save(base, one, null, null, true);
  const order = await readOrder(oid);
  assert.equal(order.order_no, `${String(year).slice(-2)}-0011`);
  assert.equal(order.revision_no, 0);
  assert.equal(order.product_quantity, 1);
  assert.equal(String(order.product_total), '65000');
  assert.equal(order.total_text, null);
  const history = await rows('select * from public.order_revisions where order_id=$1', [oid]);
  assert.equal(history.length, 1);
  assert.equal(history[0].before_data, null);
  assert.equal(history[0].after_data.items.length, 1);
  assert.equal(history[0].after_data.items[0].unit_price, 65000);
});
await check('client-supplied totals/prices are rejected', async () => {
  await assert.rejects(save({ ...base, product_total: 1 }, one), /Field order/);
  await assert.rejects(save(base, [{ ...one[0], unit_price: 1 }]), /Field item/);
});
await check('new-order errors roll back sequence, order, and private context together', async () => {
  const before = await scalar('select public.laiora_get_sequence()');
  const countBefore = await scalar('select count(*)::int from public.orders');
  await assert.rejects(save({ ...base, greeting_card_choice: 'invalid' }, one, null, null, true), /check constraint/);
  assert.deepEqual(await scalar('select public.laiora_get_sequence()'), before);
  assert.equal(await scalar('select count(*)::int from public.orders'), countBefore);
  await owner();
  assert.equal(await scalar('select count(*)::int from laiora_private.order_mutations'), 0);
  await login();
});
await check('RPC enforces card/product quantity and text limits without writing orders', async () => {
  const sequenceBefore = await scalar('select public.laiora_get_sequence()');
  const countBefore = await scalar('select count(*)::int from public.orders');
  await assert.rejects(save({...base,greeting_card_choice:'yes',greeting_card_qty:0},one,null,null,true), /Jumlah kartu/);
  await assert.rejects(save({...base,greeting_card_choice:'yes',greeting_card_qty:10001},one,null,null,true), /Jumlah kartu/);
  await assert.rejects(save(base,[{...one[0],quantity:10001}],null,null,true), /jumlah item/);
  await assert.rejects(save({...base,raw_form:'x'.repeat(50001)},one,null,null,true), /Teks order terlalu panjang/);
  await assert.rejects(save(base,[{...one[0],item_note:'x'.repeat(1001)}],null,null,true), /Catatan produk/);
  assert.deepEqual(await scalar('select public.laiora_get_sequence()'), sequenceBefore);
  assert.equal(await scalar('select count(*)::int from public.orders'), countBefore);
});
await check('SOP pickup and recipient-booked courier default to zero while explicit fee wins', async () => {
  for (const method of ['Pick Up','Drop Off','Penerima yang memesan Grab','Penerima memesan kurir']) {
    const draft = await save({...base,shipping_method:method},one);
    assert.equal(Number((await readOrder(draft)).shipping_fee),0);
  }
  const paidPickup = await save({...base,shipping_method:'Pick Up',shipping_fee:12000},one);
  assert.equal(Number((await readOrder(paidPickup)).shipping_fee),12000);
});
let originalItem = (await itemsFor(oid))[0];
await product(pid, 80000, 'Produk Uji Revisi');
await check('full replacement of confirmed items is atomic and preserves historical prices', async () => {
  await save({ operational_notes: 'Revisi kuantitas' }, [{ id: originalItem.id, product_id: pid, quantity: 2 }], oid, 0);
  const order = await readOrder(oid);
  assert.equal(order.revision_no, 1);
  assert.equal(order.order_no, `${String(year).slice(-2)}-0011`);
  assert.equal(String(order.product_total), '130000');
  const savedItem = (await itemsFor(oid))[0];
  assert.equal(String(savedItem.unit_price), '65000');
  assert.equal(savedItem.product_name, 'Produk Uji');
  assert.equal(await scalar('select count(*)::int from public.order_revisions where order_id=$1', [oid]), 2);
  const revision = (await rows('select * from public.order_revisions where order_id=$1 and revision_no=1', [oid]))[0];
  assert.equal(revision.before_data.items[0].quantity, 1);
  assert.equal(revision.after_data.items[0].quantity, 2);
});
await check('stale or missing expected revisions cannot overwrite another save', async () => {
  await assert.rejects(save({ sender_name: 'Overwrite' }, one, oid, 0), /berubah di sesi lain/);
  await assert.rejects(save({}, one, oid), /berubah di sesi lain/);
  assert.equal((await readOrder(oid)).sender_name, base.sender_name);
});
await check('empty confirmed replacement rolls back without deleting existing items', async () => {
  await assert.rejects(save({}, [], oid, 1), /Minimal satu produk/);
  assert.equal((await itemsFor(oid)).length, 1);
  assert.equal((await readOrder(oid)).revision_no, 1);
});
await check('new rows use current catalog price; retained rows use frozen price', async () => {
  await save({ shipping_fee: 0 }, [{ id: originalItem.id, product_id: pid, quantity: 2 }, { product_id: pid, quantity: 1 }], oid, 1);
  assert.equal((await readOrder(oid)).total_text, '210000');
  assert.deepEqual((await itemsFor(oid)).map(i => String(i.unit_price)).sort(), ['65000', '80000']);
  assert.equal((await readOrder(oid)).revision_no, 2);
});
await check('future price is not active early', async () => {
  const tomorrow = await scalar(`select ((now() at time zone 'Asia/Jakarta')::date+1)::text`);
  await product(pid, 999999, 'Produk Uji Revisi', true, tomorrow);
  const draft = await save(base, one);
  assert.equal(String((await itemsFor(draft))[0].unit_price), '80000');
});
await check('greeting card snapshot uses server setting and preserves old-order price', async () => {
  await save({ greeting_card_choice: 'yes', greeting_card_qty: 1 }, (await itemsFor(oid)).map(i => ({ id: i.id, product_id: i.product_id, quantity: i.quantity })), oid, 2);
  assert.equal(String((await readOrder(oid)).card_total), '6000');
  await scalar(`select public.laiora_update_settings('{"greeting_card_price":9000}')`);
  await save({ greeting_card_qty: 2 }, (await itemsFor(oid)).map(i => ({ id: i.id, product_id: i.product_id, quantity: i.quantity })), oid, 3);
  assert.equal(String((await readOrder(oid)).card_total), '12000');
});
await check('create request retries cannot create duplicate drafts or order numbers', async () => {
  const data = { ...base, client_request_id: randomUUID() };
  const first = await save(data, one);
  assert.equal(await save(data, one), first);
  await product(pid, 85000, 'Produk Uji Revisi');
  assert.equal(await save(data, one, null, null, true), first);
  assert.equal((await readOrder(first)).state, 'confirmed');
  assert.equal(String((await itemsFor(first))[0].unit_price), '80000');
  assert.equal(await save(data, one, null, null, true), first);
  await assert.rejects(save({ ...data, sender_name: 'Different' }, one), /data berbeda/);
  assert.equal(await scalar('select count(*)::int from public.orders where client_request_id=$1', [data.client_request_id]), 1);
});
await check('null confirmation on a draft retry cannot allocate an order number', async () => {
  const data = {...base,client_request_id:randomUUID()};
  const draftId = await save(data,one);
  const sequenceBefore = await scalar('select public.laiora_get_sequence()');
  await assert.rejects(save(data,one,null,null,null), /Pilihan konfirmasi tidak valid/);
  assert.equal((await readOrder(draftId)).state,'draft');
  assert.equal((await readOrder(draftId)).order_no,null);
  assert.deepEqual(await scalar('select public.laiora_get_sequence()'),sequenceBefore);
});
let paymentId;
await check('payments are verified by session account and retry is idempotent', async () => {
  const req = randomUUID();
  paymentId = await scalar('select public.laiora_record_payment($1,10000,$2,null,$3)', [oid, 'Transfer Uji', req]);
  assert.equal(await scalar('select public.laiora_record_payment($1,10000,$2,null,$3)', [oid, 'Transfer Uji', req]), paymentId);
  const payment = (await rows('select * from public.payments where id=$1', [paymentId]))[0];
  assert.equal(payment.verified_by, account);
  assert.equal(payment.verification_status, 'confirmed');
  await reject('select public.laiora_record_payment($1,20000,$2,null,$3)', [oid, 'Transfer Uji', req], /data berbeda/);
  assert.equal(await scalar('select count(*)::int from public.payments where order_id=$1', [oid]), 1);
});
await check('payment proofs attach only an existing private file for that payment', async () => {
  const path = `payments/${paymentId}/${randomUUID()}.png`;
  await reject('select public.laiora_attach_payment_proof($1,$2)', [paymentId,path], /belum diunggah/);
  await scalar('insert into storage.objects(bucket_id,name) values($1,$2) returning id', ['payment-proofs',path]);
  await scalar('select public.laiora_attach_payment_proof($1,$2)', [paymentId,path]);
  assert.equal(await scalar('select proof_path from public.payments where id=$1',[paymentId]),path);
  await scalar('select public.laiora_attach_payment_proof($1,$2)', [paymentId,path]);
  await reject('select public.laiora_attach_payment_proof($1,$2)', [paymentId,`payments/${randomUUID()}/${randomUUID()}.png`], /Path bukti/);
  await reject('insert into storage.objects(bucket_id,name) values($1,$2) returning id', ['payment-proofs',`payments/${randomUUID()}/${randomUUID()}.png`], /row-level security/);
});
await check('unknown delivery fee remains null after a full subtotal payment', async () => {
  const unknown = await save(base, one, null, null, true);
  await scalar('select public.laiora_record_payment($1,85000,null,null,$2)', [unknown, randomUUID()]);
  assert.equal((await readOrder(unknown)).total_text, null);
});
await check('draft payment/status writes are rejected', async () => {
  const draft = await save(base, one);
  await reject('select public.laiora_record_payment($1,10,null,null,$2)', [draft, randomUUID()], /hanya untuk order terkonfirmasi/);
  await reject(`select public.laiora_set_status($1,0,'scheduled')`, [draft], /Konfirmasikan/);
});
await check('operational status obeys optimistic revision checks', async () => {
  const rev = (await readOrder(oid)).revision_no;
  await scalar(`select public.laiora_set_status($1,$2,'in_progress')`, [oid, rev]);
  assert.equal((await readOrder(oid)).production_status, 'in_progress');
  assert.equal((await readOrder(oid)).revision_no, rev + 1);
  await reject(`select public.laiora_set_status($1,$2,null,'completed')`, [oid, rev], /berubah di sesi lain/);
});

const ingest = `select public.laiora_ingest_message('synthetic','chat-1','m1','Nama Uji','08123456','Brownies?', 'inbound','text',now())`;
await check('message ingestion is service-role only', async () => reject(ingest, [], /permission denied/));
await owner();
await db.exec('set role service_role');
let mid = await scalar(ingest);
await check('duplicate incoming events create one message/opportunity', async () => {
  assert.equal(await scalar(ingest), mid);
  await owner();
  assert.equal(await scalar('select count(*)::int from public.messages'), 1);
  assert.equal(await scalar('select count(*)::int from public.chat_opportunities'), 1);
});
const cid = await scalar('select id from public.conversations');
const opportunity = await scalar('select id from public.chat_opportunities');
await login();
await check('chat labels and linking are explicit and preserve independent opportunities', async () => {
  const other = await scalar('select public.laiora_manage_opportunity($1,$2)', [cid, 'Pertanyaan berikutnya']);
  await scalar('select public.laiora_manage_opportunity($1,$2,$3,$4,$5::uuid[],$6)', [cid, 'PO pertama', opportunity, 'needs_review', [pid], oid]);
  const tracking = await rows('select opportunity_id,po_status from public.chat_tracking order by opportunity_id');
  assert.equal(tracking.find(t => t.opportunity_id === opportunity).po_status, 'Sudah PO');
  assert.equal(tracking.find(t => t.opportunity_id === other).po_status, 'Belum PO');
  assert.equal(await scalar('select count(*)::int from public.opportunity_product_labels where opportunity_id=$1', [opportunity]), 1);
  await reject('select public.laiora_manage_opportunity($1,$2,null,$3,$4::uuid[])', [cid, 'Bad label', 'new', [randomUUID()]], /Label produk/);
  assert.equal(await scalar('select count(*)::int from public.chat_opportunities'), 2);
});
await check('pipeline stage RPC preserves title, labels and order links', async () => {
  const before = await rows('select * from public.chat_opportunities where id=$1', [opportunity]);
  const labels = await rows('select * from public.opportunity_product_labels where opportunity_id=$1', [opportunity]);
  const links = await rows('select * from public.opportunity_order_links where opportunity_id=$1', [opportunity]);
  await scalar('select public.laiora_set_opportunity_stage($1,$2)', [opportunity,'waiting_for_data']);
  assert.equal(await scalar('select follow_up from public.chat_opportunities where id=$1',[opportunity]),'waiting_for_data');
  assert.equal(await scalar('select title from public.chat_opportunities where id=$1',[opportunity]), before[0].title);
  assert.deepEqual(await rows('select * from public.opportunity_product_labels where opportunity_id=$1',[opportunity]),labels);
  assert.deepEqual(await rows('select * from public.opportunity_order_links where opportunity_id=$1',[opportunity]),links);
  assert.equal(await scalar('select po_status from public.chat_tracking where opportunity_id=$1',[opportunity]),'Sudah PO');
  assert.equal(await scalar("select count(*)::int from public.app_audit_log where entity_id=$1 and action='opportunity.stage_changed'",[opportunity]),1);
});
await check('pipeline rejects invalid stages and missing opportunities', async () => {
  await reject('select public.laiora_set_opportunity_stage($1,$2)',[opportunity,'confirmed'],/Tahap pipeline/);
  await reject('select public.laiora_set_opportunity_stage($1,$2)',[randomUUID(),'new'],/Peluang tidak ditemukan/);
});
await check('pipeline denies anonymous and unbound accounts', async () => {
  await login(stranger);
  await reject('select public.laiora_set_opportunity_stage($1,$2)',[opportunity,'new'],/tidak memiliki akses/);
  await owner();await db.exec('set role anon');
  await reject('select public.laiora_set_opportunity_stage($1,$2)',[opportunity,'new'],/permission denied/);
  await login();
});
await check('pipeline migration can be replayed without resetting customer data', async () => {
  await owner();
  await db.exec(await readFile(new URL('202611100007_chat_pipeline.sql',migrations),'utf8'));
  await login();
  assert.equal(await scalar('select follow_up from public.chat_opportunities where id=$1',[opportunity]),'waiting_for_data');
});
await check('cancellation preserves number/history and changes derived PO label', async () => {
  const previous = await readOrder(oid);
  await scalar('select public.laiora_set_status($1,$2,null,null,true)', [oid, previous.revision_no]);
  const cancelled = await readOrder(oid);
  assert.equal(cancelled.order_no, previous.order_no);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await scalar('select po_status from public.chat_tracking where opportunity_id=$1', [opportunity]), 'Belum PO');
  await assert.rejects(save({}, one, oid, cancelled.revision_no), /dibatalkan/);
  await reject('select public.laiora_record_payment($1,10,null,null,$2)', [oid, randomUUID()], /hanya untuk order terkonfirmasi/);
});
await check('catalog updates coalesce pending work without stealing a processing job', async () => {
  await owner();
  const processing = await scalar(`update public.outbox_jobs set state='processing',leased_until=now()+interval '1 minute'
    where id=(select id from public.outbox_jobs where entity_type='products' and entity_id=$1 order by entity_version desc limit 1) returning id::text`, [pid]);
  await login();
  await product(pid, 86000, 'Produk Uji Revisi');
  await owner();
  assert.equal(await scalar('select state from public.outbox_jobs where id=$1', [processing]), 'processing');
  assert.equal(await scalar(`select count(*)::int from public.outbox_jobs where entity_type='products' and entity_id=$1 and state='pending'`, [pid]), 1);
  assert.equal(await scalar(`select count(*)::int from public.outbox_jobs where entity_type='payments' and entity_id=$1`, [paymentId]), 2);
  assert.equal(await scalar(`select count(*)::int from public.outbox_jobs where entity_type='payments' and entity_id=$1 and state='pending'`, [paymentId]), 1);
  await login();
});
await check('private logo uploads require the bound account and safe PNG object path', async () => {
  await scalar(`insert into storage.objects(bucket_id,name) values('branding','logos/test.png') returning id`);
  await reject(`insert into storage.objects(bucket_id,name) values('branding','../test.png') returning id`, [], /row-level security/);
  await login(stranger);
  assert.equal(await scalar(`select count(*)::int from storage.objects where bucket_id='branding'`), 0);
  await reject(`insert into storage.objects(bucket_id,name) values('branding','logos/stranger.png') returning id`, [], /row-level security/);
  await reject(`select public.laiora_attach_payment_proof($1,$2)`, [paymentId,`payments/${paymentId}/${randomUUID()}.png`], /tidak memiliki akses/);
});
await owner();
await check('private mutation contexts are cleared and all public tables have RLS', async () => {
  assert.equal(await scalar('select count(*)::int from laiora_private.order_mutations'), 0);
  assert.equal(await scalar(`select count(*)::int from pg_tables where schemaname='public' and not rowsecurity`), 0);
});
console.log(`${count} operation checks passed. Local PostgreSQL WASM; not a hosted Supabase or concurrent-session test.`);
await db.close();
