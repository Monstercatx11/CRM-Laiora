import { createSign, randomInt } from 'node:crypto';
import { columnName } from './projection.mjs';

export class WorkerError extends Error {
  constructor(code, retryAfter = 0) { super(code); this.code=code; this.retryAfter=retryAfter; }
}

// Do not include remote bodies, URLs, authorization headers, or request data in
// exceptions: the UI/audit stores only these allowlisted operational codes.
export async function requestJson(url, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url,{...options,signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)}); }
  catch { throw new WorkerError('NETWORK_ERROR'); }
  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after'));
    throw new WorkerError(response.status===429 ? 'RATE_LIMITED' : response.status===401 ? 'AUTH_EXPIRED' : response.status===403 ? 'PERMISSION_DENIED' : response.status>=500 ? 'REMOTE_UNAVAILABLE' : 'REMOTE_REQUEST_REJECTED', Number.isFinite(retry) ? Math.min(3600,Math.max(0,retry)) : 0);
  }
  try { return await response.json(); } catch { throw new WorkerError('INVALID_REMOTE_RESPONSE'); }
}

export function supabaseAdapter({url,key,fetcher=fetch}) {
  const base = new URL(url);
  if (base.protocol!=='https:' && base.hostname!=='127.0.0.1' && base.hostname!=='localhost') throw new WorkerError('HTTPS_REQUIRED');
  return {
    async rpc(name,args={}) {
      return requestJson(new URL(`/rest/v1/rpc/${name}`,base),{
        method:'POST',headers:{'Content-Type':'application/json',apikey:key,...(!key.startsWith('sb_secret_') ? {Authorization:`Bearer ${key}`} : {})},body:JSON.stringify(args),
      },fetcher);
    },
  };
}

export function googleTokenProvider(serviceAccount,{fetcher=fetch,now=()=>Date.now()}={}) {
  const account=serviceAccount;
  if (!account || typeof account.client_email!=='string' || typeof account.private_key!=='string' || account.type!=='service_account') throw new WorkerError('INVALID_GOOGLE_CREDENTIALS');
  // Use Google's fixed token endpoint: credential metadata cannot redirect keys
  // or signed assertions to arbitrary hosts.
  let token=null,expiresAt=0;
  return async function accessToken(force=false) {
    if (!force && token && now()<expiresAt-90000) return token;
    const issued=Math.floor(now()/1000);
    const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600})}`;
    let signature;
    try { signature=createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url'); }
    catch { throw new WorkerError('INVALID_GOOGLE_CREDENTIALS'); }
    const result=await requestJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`})},fetcher);
    if (!result.access_token) throw new WorkerError('INVALID_GOOGLE_TOKEN');
    token=result.access_token;expiresAt=now()+Math.min(Number(result.expires_in)||3600,3600)*1000;
    return token;
  };
}

export function sheetsAdapter({spreadsheetId,prefix='Laiora_',tokenProvider,fetcher=fetch,beforeRequest=async()=>{}}) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,35}_$/.test(prefix)) throw new WorkerError('INVALID_TAB_PREFIX');
  if (!/^[a-zA-Z0-9_-]{10,150}$/.test(spreadsheetId)) throw new WorkerError('INVALID_SPREADSHEET_ID');
  const base=`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  async function call(suffix,{method='GET',body}={}) {
    for (let attempt=0;attempt<2;attempt++) {
      await beforeRequest();
      const token=await tokenProvider(attempt>0);
      try { return await requestJson(`${base}${suffix}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})},fetcher); }
      catch(error) { if (error.code!=='AUTH_EXPIRED' || attempt) throw error; }
    }
  }
  const title=tab=>`${prefix}${tab}`;
  const range=(tab,cols)=>`'${title(tab)}'!A:${columnName(cols)}`;
  return {
    async ensureTab(tab,headers) {
      // Metadata and headers are rechecked, including on retries. A preexisting
      // unrelated tab is never cleared or silently adopted.
      const meta=await call('?fields=sheets(properties(title))');
      const exists=meta.sheets?.some(sheet=>sheet.properties.title===title(tab));
      if (!exists) {
        const sheetId=randomInt(1,2147483646);
        // Google applies batchUpdate requests atomically: a crash cannot leave
        // an empty tab which would be indistinguishable from a user's own tab.
        await call(':batchUpdate',{method:'POST',body:{requests:[
          {addSheet:{properties:{sheetId,title:title(tab),gridProperties:{rowCount:1000,columnCount:Math.max(26,headers.length),frozenRowCount:1}}}},
          {updateCells:{start:{sheetId,rowIndex:0,columnIndex:0},rows:[{values:headers.map(stringValue=>({userEnteredValue:{stringValue}}))}],fields:'userEnteredValue'}},
        ]}});
      } else {
        const current=await call(`/values/${encodeURIComponent(`'${title(tab)}'!A1:${columnName(headers.length)}1`)}?valueRenderOption=UNFORMATTED_VALUE`);
        if (JSON.stringify(current.values?.[0] ?? [])!==JSON.stringify(headers)) throw new WorkerError('SHEET_HEADER_CONFLICT');
      }
    },
    async readRows(tab,cols) {
      const result=await call(`/values/${encodeURIComponent(range(tab,cols))}?valueRenderOption=UNFORMATTED_VALUE`);
      return (result.values ?? []).slice(1);
    },
    async writeRows(tab,cols,updates) {
      // Extend only the tab's grid as required. Never insert/delete rows, which
      // would move user columns; column writes preserve all manual extra cells.
      const metadata=await call('?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))');
      const sheet=metadata.sheets.find(s=>s.properties.title===title(tab));
      if (!sheet) throw new WorkerError('SHEET_MISSING');
      const maxRow=Math.max(...updates.map(u=>u.row));
      if (maxRow>sheet.properties.gridProperties.rowCount) await call(':batchUpdate',{method:'POST',body:{requests:[{updateSheetProperties:{properties:{sheetId:sheet.properties.sheetId,gridProperties:{rowCount:maxRow+100}},fields:'gridProperties.rowCount'}}]}});
      // Bounded request sizes stay well below Google's recommended 2MB payload.
      for (let i=0;i<updates.length;i+=200) await call('/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data:updates.slice(i,i+200).map(update=>({range:`'${title(tab)}'!A${update.row}:${columnName(cols)}${update.row}`,values:[update.values]}))}});
    },
  };
}
