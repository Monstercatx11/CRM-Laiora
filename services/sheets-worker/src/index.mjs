import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { googleTokenProvider,sheetsAdapter,supabaseAdapter } from './adapters.mjs';
import { createRunner,safeCode } from './runner.mjs';

const required=['SUPABASE_URL','SUPABASE_SECRET_KEY','GOOGLE_SERVICE_ACCOUNT_JSON'];
if (required.some(name=>!process.env[name])) {
  console.error(JSON.stringify({event:'configuration_missing',variables:required.filter(name=>!process.env[name])}));
  process.exitCode=1;
} else {
  let stopping=false;
  process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
  try {
    let credentials;
    try { credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('INVALID_GOOGLE_CREDENTIALS'); }
    const spreadsheetId=process.env.GOOGLE_SPREADSHEET_ID || '1KTxNabq2oEw-kevJEBj2J4BZ7ZTd21fisIALeGkXMs0';
    const db=supabaseAdapter({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY});
    const owner=randomUUID();
    const sheets=sheetsAdapter({spreadsheetId,prefix:process.env.SHEETS_TAB_PREFIX || 'Laiora_',tokenProvider:googleTokenProvider(credentials),beforeRequest:async()=>{
      if (!await db.rpc('laiora_sync_lease',{p_owner:owner,p_spreadsheet_id:spreadsheetId})) throw new Error('LEASE_LOST');
    }});
    const runner=createRunner({db,sheets,owner,spreadsheetId,log:event=>console.log(JSON.stringify(event))});
    const interval=Number(process.env.POLL_INTERVAL_MS || 5000);
    if (!Number.isFinite(interval) || interval<1000 || interval>60000) throw new Error('INVALID_POLL_INTERVAL');
    if (process.argv.includes('--backfill')) {
      await runner.backfill();
      console.log(JSON.stringify({event:'backfill_queued'}));
    } else {
      while (!stopping) {
        try {
          const result=await runner.tick();
          // Refresh existing rows once daily, including prices that became
          // effective today, and initialize records predating outbox triggers.
          // Database business_today() owns timezone and daily idempotency.
          if (!result.busy) await db.rpc('laiora_ensure_sync_backfill',{p_owner:owner,p_spreadsheet_id:spreadsheetId});
          if (result.idle || result.busy || result.failed) await delay(interval);
        } catch(error) { console.error(JSON.stringify({event:'worker_retry',code:safeCode(error)})); await delay(interval); }
      }
    }
  } catch(error) { console.error(JSON.stringify({event:'worker_stopped',code:safeCode(error)})); process.exitCode=1; }
}
