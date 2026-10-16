import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select on storage.objects to authenticated;`);
for(const name of ['202610160001_foundation.sql','202610160002_order_transactions.sql','202610160003_sop_catalog.sql','202610160004_private_documents.sql'])await db.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
const user='11111111-1111-4111-8111-111111111111';
const order='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await db.exec(`insert into auth.users values('${user}');insert into laiora_private.app_account(user_id) values('${user}');
insert into laiora_private.order_sequences(year,last_value) values(2026,383);
insert into public.orders(id,sender_name,shipping_fee) values('${order}','Synthetic existing order',null);
insert into public.order_items(order_id,product_id,product_name,size,quantity,unit_price)
select '${order}',id,name,size,2,130000 from public.products where sku='BR-ORI-R';
insert into storage.objects(bucket_id,name) values('payment-proofs','synthetic-existing-file.pdf');`);
async function snapshot(){return {orders:(await db.query('select id,sender_name,state,revision_no,product_quantity,product_total,shipping_fee,grand_total,created_at,updated_at from public.orders order by id')).rows,
items:(await db.query('select * from public.order_items order by id')).rows,
revisions:(await db.query('select * from public.order_revisions order by revision_no')).rows,
counter:(await db.query('select * from laiora_private.order_sequences')).rows,
account:(await db.query('select * from laiora_private.app_account')).rows,
files:(await db.query('select * from storage.objects')).rows};}
const before=await snapshot();
await db.exec(await readFile(new URL('../UPGRADE_OPERASIONAL.sql',import.meta.url),'utf8'));
assert.deepEqual(await snapshot(),before);
console.log('PASS upgrade preserves existing orders, items, revisions, account binding, sequence, and private files.');
await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}'`);
assert.equal((await db.query('select public.laiora_has_access() as allowed')).rows[0].allowed,true);
assert.equal((await db.query('select * from public.app_settings')).rows.length,1);
console.log('PASS original account can read upgraded settings through RLS.');
await db.exec('reset role');
await assert.rejects(db.exec(await readFile(new URL('../UPGRADE_OPERASIONAL.sql',import.meta.url),'utf8')),/already exists/);
await db.exec('rollback');
assert.deepEqual(await snapshot(),before);
console.log('PASS accidental repeated upgrade fails without altering existing data.');
await db.close();
