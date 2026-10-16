import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { HEADERS, project, safeCell, sourceVersion, upsertProjection } from '../src/projection.mjs';
import { googleTokenProvider, sheetsAdapter, requestJson } from '../src/adapters.mjs';
import { createRunner, retryDelay, safeCode } from '../src/runner.mjs';

function fakeSheets(initial={}) {
  const tabs=structuredClone(initial);
  return {tabs,writes:[],async ensureTab(tab,headers) {tabs[tab]??=[];assert.deepEqual(headers,HEADERS[tab]);},async readRows(tab){return structuredClone(tabs[tab]);},async writeRows(tab,cols,updates){this.writes.push(...updates);for(const update of updates){const old=tabs[tab][update.row-2]??[];tabs[tab][update.row-2]=[...update.values,...old.slice(cols)];}}};
}
const orderSnapshot = (version='1',items=[{id:'item-a',order_id:'order-a',product_name:'Brownies',quantity:2}])=>({entity_id:'order-a',entity_type:'orders',version,data:{order:{id:'order-a',order_no:'26-0001',state:'confirmed',raw_form:'NEVER EXPORT'},items}});

test('upserts by stable ID after sorting and preserves manual extra columns',async()=>{
  const a=project(orderSnapshot())[0];
  const b=project({...orderSnapshot(),entity_id:'order-b',data:{order:{order_no:'26-0002'},items:[]}})[0];
  const api=fakeSheets();await upsertProjection(api,a);await upsertProjection(api,b);
  api.tabs.Orders[0].push('manual-a');api.tabs.Orders[1].push('manual-b');api.tabs.Orders.reverse();
  const update=project(orderSnapshot('2'))[0];update.rows[0][HEADERS.Orders.indexOf('recipient_name')]='Customer A';
  await upsertProjection(api,update);
  assert.equal(api.tabs.Orders[1][0],'order-a');assert.equal(api.tabs.Orders[1].at(-1),'manual-a');assert.equal(api.tabs.Orders[0].at(-1),'manual-b');
});
test('stale writes skipped using exact bigint versions',async()=>{
  const api=fakeSheets();await upsertProjection(api,project(orderSnapshot('9007199254740993'))[0]);
  assert.equal((await upsertProjection(api,project(orderSnapshot('9007199254740992'))[0])).skipped,true);
  assert.equal(api.tabs.Orders[0][1],'9007199254740993');assert.throws(()=>sourceVersion(9007199254740992),/INVALID_VERSION/);
});
test('whole order retries reconcile removed items and summary with tombstones',async()=>{
  const api=fakeSheets();const first=orderSnapshot('1',[{id:'old',order_id:'order-a',quantity:1},{id:'kept',order_id:'order-a',quantity:3}]);
  for(const output of project(first)) await upsertProjection(api,output);
  const second=orderSnapshot('2',[{id:'kept',order_id:'order-a',quantity:8}]);
  for(const output of project(second)) await upsertProjection(api,output);
  for(const tab of ['Order_Items','Production_Summary']) {assert.equal(api.tabs[tab].find(r=>r[0]==='old')[2],false);assert.equal(api.tabs[tab].find(r=>r[0]==='kept')[2],true);assert(api.tabs[tab].every(r=>r[1]==='2'));}
});
test('projection excludes raw chats/forms and protects spreadsheet formulas',()=>{
  const output=project(orderSnapshot());assert(!JSON.stringify(output).includes('NEVER EXPORT'));
  for(const input of ['=IMPORTXML("bad")','+CMD','-2+3','@SUM(A1)',' \t=SUM(1)']) assert.equal(safeCell(input),`'${input}`);
  assert.equal(safeCell(120),120);assert.equal(safeCell('normal'),'normal');
  const chat=project({entity_type:'chat_opportunities',entity_id:'chat-a',version:'1',data:{body:'SECRET CHAT',product_labels:['Brownies'],order_ids:[]}});
  assert(!JSON.stringify(chat).includes('SECRET CHAT'));
});
test('duplicate IDs halt writes rather than corrupting the wrong row',async()=>{
  const api=fakeSheets({Orders:[['order-a','1',true],['order-a','1',true]]});
  await assert.rejects(upsertProjection(api,project(orderSnapshot())[0]),/DUPLICATE_SHEET_ID/);assert.equal(api.writes.length,0);
});
test('future catalog prices do not replace current effective price',()=>{
  const rows=project({entity_type:'products',entity_id:'product-a',version:'1',today:'2026-10-16',data:{product:{active:true},prices:[{id:'price1',effective_from:'2026-10-01',unit_price:100},{id:'price2',effective_from:'2026-11-01',unit_price:200}]}});
  assert.equal(rows[0].rows[0][HEADERS.Products.indexOf('current_price')],100);assert.equal(rows[1].rows.length,2);
});
test('header conflicts never write to existing tabs',async()=>{
  const calls=[];const api=sheetsAdapter({spreadsheetId:'abcdefghijk123',tokenProvider:async()=>'FAKE',fetcher:async(url,opts)=>{calls.push({url:String(url),opts});return Response.json(String(url).includes('fields=')?{sheets:[{properties:{title:'Laiora_Orders'}}]}:{values:[['user','owned','headers']]});}});
  await assert.rejects(api.ensureTab('Orders',HEADERS.Orders),/SHEET_HEADER_CONFLICT/);assert(calls.every(c=>!c.opts.method || c.opts.method==='GET'));
});
test('new owned tab and fixed header are created atomically',async()=>{
  const calls=[];const api=sheetsAdapter({spreadsheetId:'abcdefghijk123',tokenProvider:async()=>'FAKE',fetcher:async(url,opts)=>{calls.push({url:String(url),opts});return Response.json(String(url).includes('fields=')?{sheets:[{properties:{title:'Customer Orders'}}]}:{});}});
  await api.ensureTab('Orders',HEADERS.Orders);
  const body=JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body);assert.equal(body.requests.length,2);assert.equal(body.requests[0].addSheet.properties.title,'Laiora_Orders');assert(body.requests[1].updateCells.rows[0].values.length>0);
});
test('Google token cached then refreshed before expiry, using fixed official endpoint',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let now=1000000,count=0;
  const token=googleTokenProvider({type:'service_account',client_email:'test@example.invalid',private_key:privateKey.export({format:'pem',type:'pkcs8'}),token_uri:'https://attacker.invalid'},{now:()=>now,fetcher:async(url)=>{assert.equal(url,'https://oauth2.googleapis.com/token');count++;return Response.json({access_token:`token-${count}`,expires_in:3600});}});
  assert.equal(await token(),'token-1');assert.equal(await token(),'token-1');now+=3550000;assert.equal(await token(),'token-2');
});
test('401 refreshes token once; request error body never leaks',async()=>{
  let count=0;const forces=[];
  const api=sheetsAdapter({spreadsheetId:'abcdefghijk123',tokenProvider:async(force)=>{forces.push(force);return 'PRIVATE';},fetcher:async()=>++count===1?new Response('SECRETS',{status:401}):Response.json({values:[HEADERS.Orders]})});
  assert.deepEqual(await api.readRows('Orders',HEADERS.Orders.length),[]);assert.deepEqual(forces,[false,true]);
  await assert.rejects(requestJson('https://example.invalid',{},async()=>new Response('PRIVATE',{status:403})),error=>error.message==='PERMISSION_DENIED'&&!error.message.includes('PRIVATE'));
});
test('rate limits honor Retry-After and bounded exponential retry',async()=>{
  let error;try {await requestJson('https://example.invalid',{},async()=>new Response('secret',{status:429,headers:{'Retry-After':'120'}}));}catch(e){error=e;}
  assert.equal(error.retryAfter,120);assert.equal(retryDelay(1,120,()=>0),120);assert.equal(retryDelay(50,0,()=>0),3600);
});
test('outage retries only claimed job with safe error and retains new dirty jobs',async()=>{
  const calls=[];const db={async rpc(name,args){calls.push({name,args});if(name==='laiora_sync_lease')return true;if(name==='laiora_claim_sync')return [{job_id:'old-job',attempts:2,snapshot:orderSnapshot()}];return true;}};
  const api=fakeSheets();api.writeRows=async()=>{throw Object.assign(new Error('PRIVATE'),{code:'NETWORK_ERROR'});};
  const runner=createRunner({db,sheets:api,owner:'worker',spreadsheetId:'sheet'});const result=await runner.tick();
  assert.equal(result.failed,true);const fail=calls.find(c=>c.name==='laiora_fail_sync');assert.equal(fail.args.p_job_id,'old-job');assert.equal(fail.args.p_error_code,'NETWORK_ERROR');assert(!calls.some(c=>c.name==='laiora_complete_sync'));assert.equal(safeCode(new Error('PRIVATE')),'SYNC_ERROR');
});
test('lost lease prevents writes and acknowledgement',async()=>{
  let leases=0;const calls=[];const db={async rpc(name,args){calls.push(name);if(name==='laiora_sync_lease')return ++leases<2;if(name==='laiora_claim_sync')return [{job_id:'1',attempts:1,snapshot:orderSnapshot()}];return false;}};
  const api=fakeSheets();const result=await createRunner({db,sheets:api,owner:'worker',spreadsheetId:'sheet'}).tick();assert.equal(result.code,'LEASE_LOST');assert.equal(api.writes.length,0);assert(!calls.includes('laiora_complete_sync'));
});
