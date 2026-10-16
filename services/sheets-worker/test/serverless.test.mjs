import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedSync } from '../src/serverless.mjs';

const snapshot={entity_type:'app_settings',entity_id:'00000000-0000-0000-0000-000000000001',version:'1',data:{business_name:'Test only'}};
function fixture({busy=false,tickTime=0,crash=false}={}) {
  let now=0,claims=0,releases=0;const calls=[];
  const db={async rpc(name){calls.push(name);if(name==='laiora_sync_lease')return !busy;if(name==='laiora_claim_sync'){claims++;return [{job_id:String(claims),attempts:1,snapshot}];}if(name==='laiora_complete_sync'){now+=tickTime;return true;}if(name==='laiora_release_sync'){releases++;return true;}return 0;}};
  const sheets={async ensureTab(){if(crash)throw new Error('PRIVATE DETAILS');},async readRows(){return [];},async writeRows(){}};
  return {db,sheets,now:()=>now,owner:'owner',spreadsheetId:'sheet',calls,get claims(){return claims;},get releases(){return releases;}};
}
test('serverless request is bounded to five jobs and always releases lease',async()=>{
  const f=fixture();const result=await runBoundedSync({...f,maxJobs:100});assert.equal(result.processed,5);assert.equal(f.claims,5);assert.equal(f.releases,1);assert(f.calls.includes('laiora_ensure_sync_backfill'));
});
test('time budget stops before the next job without background loop',async()=>{
  const f=fixture({tickTime:16000});const result=await runBoundedSync({...f,budgetMs:30000});assert.equal(result.processed,2);assert.equal(result.timeLimited,true);assert.equal(f.claims,2);assert.equal(f.releases,1);
});
test('a competing request returns busy without stealing or releasing another lease',async()=>{
  const f=fixture({busy:true});const result=await runBoundedSync(f);assert.equal(result.busy,true);assert.equal(f.claims,0);assert.equal(f.releases,0);
});
test('outage ends batch early, masks details, and releases using separate cleanup transport',async()=>{
  const f=fixture({crash:true});let cleanup=0;
  const result=await runBoundedSync({...f,cleanupDb:{async rpc(name){assert.equal(name,'laiora_release_sync');cleanup++;return true;}}});assert.equal(result.processed,0);assert.equal(result.failed,1);assert.equal(result.code,'SYNC_ERROR');assert.equal(f.claims,1);assert.equal(cleanup,1);
});
test('no pending jobs returns idle and releases lease',async()=>{
  const f=fixture();const base=f.db.rpc;f.db.rpc=async(name,args)=>name==='laiora_claim_sync'?[]:base(name,args);
  const result=await runBoundedSync(f);assert.equal(result.idle,true);assert.equal(result.processed,0);assert.equal(f.releases,1);
});
