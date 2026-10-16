import { project, upsertProjection } from './projection.mjs';
import { WorkerError } from './adapters.mjs';

export const SAFE_CODES = new Set(['NETWORK_ERROR','RATE_LIMITED','AUTH_EXPIRED','PERMISSION_DENIED','REMOTE_UNAVAILABLE','REMOTE_REQUEST_REJECTED','INVALID_REMOTE_RESPONSE','INVALID_GOOGLE_CREDENTIALS','INVALID_GOOGLE_TOKEN','SHEET_HEADER_CONFLICT','DUPLICATE_SHEET_ID','INVALID_VERSION','MISSING_PROJECTION','UNSUPPORTED_ENTITY','SHEET_MISSING','LEASE_LOST','INVALID_CELL']);
export const safeCode = error => SAFE_CODES.has(error?.code ?? error?.message) ? error.code ?? error.message : 'SYNC_ERROR';
export function retryDelay(attempts,retryAfter=0,random=Math.random) {
  return Math.max(retryAfter,Math.min(3600,5*(2**Math.min(10,Math.max(0,attempts-1))))+Math.floor(random()*5));
}

export function createRunner({db,sheets,owner,spreadsheetId,log=()=>{}}) {
  const args={p_owner:owner,p_spreadsheet_id:spreadsheetId};
  const assertLease=async()=>{
    const ok=await db.rpc('laiora_sync_lease',args);
    if (!ok) throw new WorkerError('LEASE_LOST');
  };
  return {
    async backfill() {
      await assertLease();
      return db.rpc('laiora_backfill_sync',args);
    },
    async tick() {
      // One claim per tick prevents queued jobs from losing their lease while a
      // large order is being written; the worker is intentionally serial.
      if (!await db.rpc('laiora_sync_lease',args)) return {busy:true};
      const jobs=await db.rpc('laiora_claim_sync',{...args,p_limit:1});
      if (!jobs?.length) return {idle:true};
      const job=jobs[0];
      try {
        for (const output of project(job.snapshot)) await upsertProjection(sheets,output,assertLease);
        await assertLease();
        const completed=await db.rpc('laiora_complete_sync',{...args,p_job_id:job.job_id});
        if (!completed) throw new WorkerError('LEASE_LOST');
        log({event:'sync_completed',entity:job.snapshot.entity_type});
        return {done:true};
      } catch(error) {
        const code=safeCode(error);
        // Only this exact claimed row is retried. Newer dirty versions are never
        // deleted, marked done, or reset by an older failure.
        try { await db.rpc('laiora_fail_sync',{...args,p_job_id:job.job_id,p_error_code:code,p_retry_seconds:retryDelay(job.attempts,error.retryAfter)}); }
        catch { /* lease expiry/restart: durable claim is recovered by SQL */ }
        log({event:'sync_retry',code});
        return {failed:true,code};
      }
    },
  };
}
