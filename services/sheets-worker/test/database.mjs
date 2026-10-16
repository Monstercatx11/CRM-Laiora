import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../../supabase/tests/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const bound='11111111-1111-1111-1111-111111111111';
const stranger='22222222-2222-2222-2222-222222222222';
const worker='aaaaaaaa-1111-1111-1111-111111111111';
const second='bbbbbbbb-1111-1111-1111-111111111111';
const order='cccccccc-1111-1111-1111-111111111111';
const spreadsheet='SYNTHETIC_SHEET_123';
let count=0;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const check=async(name,fn)=>{await fn();count++;console.log(`PASS ${name}`);};
const rpc=async(name,args=[])=>scalar(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
const owner=async()=>db.exec('reset role');
const service=async()=>db.exec('reset role; set role service_role');
const login=async(id=bound)=>db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}'`);
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;grant select on storage.objects to authenticated;
`);
const migrations=new URL('../../../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,migrations),'utf8'));
await db.exec(`insert into auth.users values('${bound}'),('${stranger}');insert into laiora_private.app_account(user_id) values('${bound}');`);

await check('anonymous has no access to status, lease, backfill or retry',async()=>{
  await db.exec('set role anon');
  for(const [name,args] of [['laiora_sync_status',[]],['laiora_retry_sync',[]],['laiora_sync_lease',[worker,spreadsheet]],['laiora_backfill_sync',[worker,spreadsheet]]]) await assert.rejects(rpc(name,args),/permission denied/);
});
await check('only bound account may inspect/retry; browser cannot claim service jobs',async()=>{
  await login(stranger);await assert.rejects(rpc('laiora_sync_status'),/Unauthorized/);await assert.rejects(rpc('laiora_retry_sync'),/Unauthorized/);
  await login();const status=await rpc('laiora_sync_status');assert.equal(status.configured,false);assert.equal(status.lastCompleted,null);
  await assert.rejects(rpc('laiora_claim_sync',[worker,spreadsheet,1]),/permission denied/);
});
await check('single spreadsheet lease rejects a second worker and another target',async()=>{
  await service();assert.equal(await rpc('laiora_sync_lease',[worker,spreadsheet]),true);assert.equal(await rpc('laiora_sync_lease',[second,spreadsheet]),false);assert.equal(await rpc('laiora_sync_lease',[worker,'OTHER_SHEET_123']),false);
});
await check('backfill queues existing catalog and settings without source mutations',async()=>{
  assert.equal(await rpc('laiora_backfill_sync',[worker,spreadsheet]),17);
  await owner();assert.equal(Number(await scalar('select count(*) from public.outbox_jobs where state=\'pending\'')),17);
  assert.equal(Number(await scalar('select count(*) from public.products')),16);
  assert.equal(Number(await scalar('select count(*) from laiora_private.order_sequences')),0);
  await db.exec(`update public.outbox_jobs set state='done';insert into public.orders(id,recipient_name,raw_form) values('${order}','Synthetic','PRIVATE RAW FORM');`);
  await service();
});
let first;
await check('claim returns current order+whole items snapshot with bigint version strings and no raw form',async()=>{
  first=(await rpc('laiora_claim_sync',[worker,spreadsheet,1]))[0];
  assert.equal(first.snapshot.entity_id,order);assert.equal(typeof first.snapshot.version,'string');assert.equal(typeof first.job_id,'string');assert.equal(first.attempts,1);assert.deepEqual(first.snapshot.data.items,[]);assert(!JSON.stringify(first).includes('PRIVATE RAW FORM'));
});
await check('new dirty version survives acknowledgement of older processing job',async()=>{
  await owner();await db.query('update public.orders set recipient_name=$1 where id=$2',['Changed',order]);
  await service();assert.equal(await rpc('laiora_complete_sync',[worker,spreadsheet,first.job_id]),true);
  await owner();assert.equal(Number(await scalar("select count(*) from public.outbox_jobs where entity_id=$1 and state='pending'",[order])),1);
  assert.equal(await scalar('select state from public.outbox_jobs where id=$1',[first.job_id]),'done');
  await service();
});
let older;
await check('failed claimed version cannot erase or reset a newer queued version',async()=>{
  older=(await rpc('laiora_claim_sync',[worker,spreadsheet,1]))[0];
  await owner();await db.query('update public.orders set recipient_name=$1 where id=$2',['Newest',order]);
  await service();assert.equal(await rpc('laiora_fail_sync',[worker,spreadsheet,older.job_id,'NETWORK_ERROR',120]),true);
  await owner();assert.equal(Number(await scalar("select count(*) from public.outbox_jobs where entity_id=$1 and state='pending'",[order])),1);assert.equal(await scalar('select last_error_code from public.outbox_jobs where id=$1',[older.job_id]),'NETWORK_ERROR');
  await service();
});
await check('newer queued job snapshots latest entity; stale request never replays old data',async()=>{
  const job=(await rpc('laiora_claim_sync',[worker,spreadsheet,1]))[0];assert.equal(job.snapshot.data.order.recipient_name,'Newest');assert.equal(await rpc('laiora_complete_sync',[worker,spreadsheet,job.job_id]),true);
});
await check('retry bound account restores failures but leaves processing/new jobs intact',async()=>{
  await login();assert.equal(await rpc('laiora_retry_sync'),1);
  await owner();assert.equal(await scalar('select state from public.outbox_jobs where id=$1',[older.job_id]),'pending');assert.equal(Number(await scalar('select attempts from public.outbox_jobs where id=$1',[older.job_id])),0);
  await service();
});
await check('crash recovery allows takeover after expiration and rejects old owner completion',async()=>{
  const job=(await rpc('laiora_claim_sync',[worker,spreadsheet,1]))[0];
  await owner();await db.exec("update laiora_private.sheets_worker set leased_until=now()-interval '1 second';update public.outbox_jobs set leased_until=now()-interval '1 second' where state='processing'");
  await service();assert.equal(await rpc('laiora_sync_lease',[second,spreadsheet]),true);
  await assert.rejects(rpc('laiora_complete_sync',[worker,spreadsheet,job.job_id]),/LEASE_LOST/);
  const recovered=(await rpc('laiora_claim_sync',[second,spreadsheet,1]))[0];assert.equal(recovered.job_id,job.job_id);assert.equal(recovered.attempts,job.attempts+1);
  assert.equal(await rpc('laiora_complete_sync',[second,spreadsheet,recovered.job_id]),true);
});
await check('status distinguishes a connected worker, latest completion and pending failures',async()=>{
  await login();const status=await rpc('laiora_sync_status');assert.equal(status.configured,true);assert(status.lastCompleted);assert.equal(status.failed,0);
  await owner();await db.exec("update laiora_private.sheets_worker set last_heartbeat=now()-interval '121 seconds'");
  await login();assert.equal((await rpc('laiora_sync_status')).configured,false);await service();
});
await check('error audit is allowlisted and terminal attempts remain durable until manual retry',async()=>{
  await rpc('laiora_sync_lease',[second,spreadsheet]);
  await owner();await db.query('update public.orders set recipient_name=$1 where id=$2',['Another',order]);await service();
  const job=(await rpc('laiora_claim_sync',[second,spreadsheet,1]))[0];await rpc('laiora_fail_sync',[second,spreadsheet,job.job_id,'SECRET HTTP RESPONSE',0]);
  await owner();assert.equal(await scalar('select last_error_code from public.outbox_jobs where id=$1',[job.job_id]),'SYNC_ERROR');await db.query("update public.outbox_jobs set attempts=12,available_at=now()-interval '1 second' where id=$1",[job.job_id]);await service();assert.deepEqual(await rpc('laiora_claim_sync',[second,spreadsheet,1]),[]);
  await login();assert.equal(await rpc('laiora_retry_sync'),1);await service();assert.equal((await rpc('laiora_claim_sync',[second,spreadsheet,1]))[0].attempts,1);
});
await check('serverless initialization runs once per business day, preserving queue across clicks',async()=>{
  await service();
  assert.equal(await rpc('laiora_ensure_sync_backfill',[second,spreadsheet]),0);
  await owner();const before=await scalar('select count(*) from public.outbox_jobs');await db.exec("update laiora_private.sheets_worker set last_backfill_date=null");await service();
  assert.equal(await rpc('laiora_ensure_sync_backfill',[second,spreadsheet]),18);
  assert.equal(await rpc('laiora_ensure_sync_backfill',[second,spreadsheet]),0);
  await owner();assert(Number(await scalar('select count(*) from public.outbox_jobs'))>Number(before));await service();
});
await check('serverless release returns interrupted claim without losing newer dirty data',async()=>{
  const jobs=await rpc('laiora_claim_sync',[second,spreadsheet,1]);assert(jobs.length);const job=jobs[0];
  assert.equal(await rpc('laiora_release_sync',[second,spreadsheet]),true);
  await owner();assert.equal(await scalar('select state from public.outbox_jobs where id=$1',[job.job_id]),'pending');await service();
  assert.equal(await rpc('laiora_sync_lease',[worker,spreadsheet]),true);
  assert.equal(await rpc('laiora_release_sync',[second,spreadsheet]),false);
  assert.equal(await rpc('laiora_sync_lease',[second,spreadsheet]),false);
});
await check('changing spreadsheet clears initialization marker and prior target completion',async()=>{
  await rpc('laiora_release_sync',[worker,spreadsheet]);
  assert.equal(await rpc('laiora_sync_lease',[second,'NEW_SYNTHETIC_SHEET_123']),true);
  await owner();assert.equal(await scalar('select last_backfill_date from laiora_private.sheets_worker'),null);assert.equal(await scalar('select last_completed from laiora_private.sheets_worker'),null);await service();
  assert.equal(await rpc('laiora_ensure_sync_backfill',[second,'NEW_SYNTHETIC_SHEET_123']),18);
});
console.log(`${count} Sheets SQL checks passed; local PostgreSQL WASM, not remote API or concurrent transaction verification.`);
await db.close();
