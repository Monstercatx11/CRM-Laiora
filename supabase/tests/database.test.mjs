import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function scalar(sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
async function reject(sql, pattern) { await assert.rejects(db.exec(sql), pattern); }
// Supabase-managed schemas are minimal test doubles, not platform integration.
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
const migrations = new URL('../migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(name,migrations),'utf8'));
}
await check('all migrations run; 16 SOP prices seeded',async()=>assert.equal(await scalar('select count(*)::integer from public.product_prices'),16));
await check('RLS enabled on every public table',async()=>assert.equal(await scalar("select count(*)::integer from pg_tables where schemaname='public' and not rowsecurity"),0));
await check('anonymous cannot read orders',async()=>reject('set role anon; select * from public.orders',/permission denied/));
await db.exec('reset role');
await db.exec(`insert into auth.users values('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
set role authenticated; set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';`);
await check('authenticated user denied before binding',async()=>assert.equal(await scalar('select count(*)::integer from public.products'),0));
await db.exec(`reset role; insert into laiora_private.app_account(user_id) values('11111111-1111-1111-1111-111111111111'); set role authenticated;`);
await check('bound account can read catalogue',async()=>assert.equal(await scalar('select count(*)::integer from public.products'),16));
await check('browser cannot write orders',async()=>reject('insert into public.orders default values',/permission denied/));
await check('browser cannot execute confirmation RPC',async()=>reject("select public.confirm_laiora_order(gen_random_uuid(),2026)",/permission denied/));
await db.exec("set request.jwt.claim.sub='22222222-2222-2222-2222-222222222222'");
await check('another authenticated user sees no catalogue',async()=>assert.equal(await scalar('select count(*)::integer from public.products'),0));
await db.exec("reset role; set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111'");
await db.exec("insert into public.orders(id) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')");
const id="'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'";
await check('confirmation rejects missing delivery date',async()=>reject(`select public.confirm_laiora_order(${id},2026)`,/Delivery date/));
await db.exec(`update public.orders set delivery_date='2026-10-20' where id=${id}`);
await check('confirmation rejects empty items',async()=>reject(`select public.confirm_laiora_order(${id},2026)`,/At least one product/));
await db.exec(`insert into public.order_items(order_id,product_name,size,quantity,unit_price,cutting_note) values(${id},'Brownies Original','Regular',2,130000,'Potong 9')`);
await check('item quantity/price update aggregates; cutting does not multiply quantity',async()=>assert.deepEqual((await db.query(`select product_quantity,product_total::text,grand_total from public.orders where id=${id}`)).rows[0],{product_quantity:2,product_total:'260000',grand_total:null}));
await check('confirmation requires explicitly initialized counter',async()=>reject(`select public.confirm_laiora_order(${id},2026)`,/Sequence not initialized/));
// Synthetic test counter, never copied into a production environment.
await db.exec("insert into laiora_private.order_sequences values(2026,379)");
await check('service_role can confirm; number allocated atomically',async()=>{await db.exec('set role service_role');assert.equal(await scalar(`select public.confirm_laiora_order(${id},2026)`),'26-0380');await db.exec('reset role');});
await check('repeat confirmation keeps number and counter',async()=>{assert.equal(await scalar(`select public.confirm_laiora_order(${id},2026)`),'26-0380');assert.equal(await scalar('select last_value from laiora_private.order_sequences where year=2026'),380)});
await check('unknown card cannot have charged quantity',async()=>reject(`update public.orders set greeting_card_qty=1 where id=${id}`,/check constraint/));
await db.exec(`update public.orders set greeting_card_choice='yes',greeting_card_qty=1,shipping_fee=0 where id=${id}`);
await check('confirmed card charged; free shipping produces final total',async()=>assert.equal(String(await scalar(`select grand_total from public.orders where id=${id}`)),'265000'));
await db.exec(`update public.order_items set quantity=1 where order_id=${id}`);
await check('item revision refreshes price but preserves order number',async()=>assert.deepEqual((await db.query(`select order_no,grand_total::text from public.orders where id=${id}`)).rows[0],{order_no:'26-0380',grand_total:'135000'}));
await check('revision snapshots retain item versions',async()=>{const rows=(await db.query(`select after_data->'items'->0->>'quantity' as qty from public.order_revisions where order_id=${id} order by revision_no desc limit 2`)).rows;assert.deepEqual(rows.map(r=>r.qty),['1','2'])});
await check('order number cannot be revised',async()=>reject(`update public.orders set order_no='26-9999' where id=${id}`,/immutable/));
await check('order version has matching outbox record',async()=>assert.equal(await scalar(`select count(*)::integer from public.orders o join public.outbox_jobs j on j.entity_id=o.id and j.entity_version=o.revision_no where o.id=${id}`),1));
await db.exec(`insert into public.contacts(id,display_name) values('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Synthetic test');
insert into public.conversations(id,contact_id,account_ref,external_chat_id) values('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','test','chat-test');
insert into public.chat_opportunities(id,conversation_id) values('dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc');`);
await check('new opportunity is Belum PO',async()=>assert.equal(await scalar('select po_status from public.chat_tracking'),'Belum PO'));
await db.exec(`insert into public.opportunity_order_links values('dddddddd-dddd-dddd-dddd-dddddddddddd',${id})`);
await check('linked confirmed order is Sudah PO',async()=>assert.equal(await scalar('select po_status from public.chat_tracking'),'Sudah PO'));
await db.exec(`update public.orders set state='cancelled' where id=${id}`);
await check('cancellation returns opportunity to Belum PO without deleting history',async()=>{assert.equal(await scalar('select po_status from public.chat_tracking'),'Belum PO');assert.equal(await scalar(`select order_no from public.orders where id=${id}`),'26-0380')});
await db.exec("insert into public.messages(conversation_id,external_message_id,direction,body,sent_at) values('cccccccc-cccc-cccc-cccc-cccccccccccc','m1','inbound','test',now())");
await check('duplicate event rejected by database',async()=>reject("insert into public.messages(conversation_id,external_message_id,direction,sent_at) values('cccccccc-cccc-cccc-cccc-cccccccccccc','m1','inbound',now())",/unique constraint/));
await check('unverified payment cannot be marked confirmed',async()=>reject(`insert into public.payments(order_id,amount,verification_status) values(${id},1000,'confirmed')`,/check constraint/));
await check('document buckets are private with file restrictions',async()=>{const r=await db.query('select public,allowed_mime_types from storage.buckets');assert.equal(r.rows.length,3);assert(r.rows.every(b=>b.public===false && b.allowed_mime_types.length>0))});
await db.exec("insert into storage.objects(bucket_id,name) values('delivery-orders','synthetic.pdf'); set role authenticated; set request.jwt.claim.sub='22222222-2222-2222-2222-222222222222'");
await check('other account cannot read documents',async()=>assert.equal(await scalar('select count(*)::integer from storage.objects'),0));
await db.exec("set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111'");
await check('bound account can read documents metadata',async()=>assert.equal(await scalar('select count(*)::integer from storage.objects'),1));
await db.exec('reset role');
console.log(`${count} database checks passed. Local PostgreSQL WASM; not a Supabase-hosted or concurrency test.`);
await db.close();
