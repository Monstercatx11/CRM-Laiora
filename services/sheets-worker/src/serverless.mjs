import { createRunner, safeCode } from './runner.mjs';

// Request-scoped execution: no intervals, subprocess, or process-level mutable
// authentication state. Adapters also receive the caller's hard deadline signal.
export async function runBoundedSync({db,sheets,cleanupDb=db,owner,spreadsheetId,maxJobs=5,budgetMs=35000,now=Date.now}) {
  const started=now();
  const args={p_owner:owner,p_spreadsheet_id:spreadsheetId};
  let acquired=false,processed=0,failed=0,code=null,timeLimited=false,idle=false;
  const deadline=()=>now()-started>=budgetMs;
  try {
    acquired=await db.rpc('laiora_sync_lease',args);
    if (!acquired) return {processed,failed,busy:true,timeLimited:false,code:null};
    await db.rpc('laiora_ensure_sync_backfill',args);
    const runner=createRunner({db,sheets,owner,spreadsheetId});
    for(let i=0;i<Math.min(Math.max(maxJobs,1),5);i++) {
      if (deadline()) {timeLimited=true;break;}
      const result=await runner.tick();
      if (result.done) processed++;
      if (result.failed) {failed++;code=result.code;timeLimited=deadline();break;}
      if (result.idle) {idle=true;break;}
      if (result.busy) {code='LEASE_LOST';break;}
    }
    return {processed,failed,busy:false,timeLimited:timeLimited || deadline(),idle,code};
  } catch(error) {
    timeLimited=deadline();
    return {processed,failed:failed+1,busy:false,timeLimited,idle:false,code:timeLimited ? 'REQUEST_TIME_LIMIT' : safeCode(error)};
  } finally {
    // Separate <=5s cleanup transport is required after the main request's
    // deadline. If cleanup cannot connect, SQL expires/reclaims the durable job.
    if (acquired) try {await cleanupDb.rpc('laiora_release_sync',args);} catch { /* recovered on lease expiry */ }
  }
}
