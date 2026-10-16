import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase/server';
import { googleTokenProvider, sheetsAdapter, supabaseAdapter } from '../../../../services/sheets-worker/src/adapters.mjs';
import { runBoundedSync } from '../../../../services/sheets-worker/src/serverless.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const defaultSpreadsheet = '1KTxNabq2oEw-kevJEBj2J4BZ7ZTd21fisIALeGkXMs0';
type GoogleCredentials = { type: 'service_account'; client_email: string; private_key: string };
type SyncConfig = { url: string; key: string; credentials: GoogleCredentials; spreadsheetId: string; prefix: string };

function configuration(): { config: SyncConfig | null; missing: string[]; invalid: boolean } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const rawGoogle = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const missing = [!url && 'SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SECRET_KEY', !rawGoogle && 'GOOGLE_SERVICE_ACCOUNT_JSON'].filter((value): value is string => !!value);
  if (missing.length) return { config: null, missing, invalid: false };
  try {
    const parsedUrl = new URL(url!);
    const local = ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);
    if (parsedUrl.username || parsedUrl.password || (parsedUrl.protocol !== 'https:' && !(local && parsedUrl.protocol === 'http:'))) throw new Error();
    if (key!.startsWith('sb_publishable_')) throw new Error();
    const credentials: unknown = JSON.parse(rawGoogle!);
    if (!credentials || typeof credentials !== 'object' || !('type' in credentials) || credentials.type !== 'service_account' || !('client_email' in credentials) || typeof credentials.client_email !== 'string' || !credentials.client_email.trim() || !('private_key' in credentials) || typeof credentials.private_key !== 'string' || !credentials.private_key.trim()) throw new Error();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || defaultSpreadsheet;
    const prefix = process.env.SHEETS_TAB_PREFIX || 'Laiora_';
    if (!/^[A-Za-z0-9_-]{10,150}$/.test(spreadsheetId) || !/^[A-Za-z][A-Za-z0-9_-]{2,35}_$/.test(prefix)) throw new Error();
    return { config: { url: url!, key: key!, credentials: credentials as GoogleCredentials, spreadsheetId, prefix }, missing: [], invalid: false };
  } catch { return { config: null, missing: [], invalid: true }; }
}

async function accessFailure() {
  const access = await accountAccess();
  return access.status === 'authorized' ? null : NextResponse.json({ error: 'Silakan login menggunakan akun Laiora yang diizinkan.' }, {
    status: access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503, headers,
  });
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || url.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.slice(0, -1);
    return ['http', 'https'].includes(protocol) && new URL(origin).origin === `${protocol}://${host}`;
  } catch { return false; }
}

async function queueStatus() {
  try {
    const client = await sessionClient();
    if (!client) return null;
    const { data, error } = await client.rpc('laiora_sync_status').abortSignal(AbortSignal.timeout(2000));
    if (error || !data) return null;
    return { pending: Number(data.pending ?? 0), failed: Number(data.failed ?? 0), lastCompleted: typeof data.lastCompleted === 'string' ? data.lastCompleted : null };
  } catch { return null; }
}

// Read-only readiness. This endpoint never acquires a lease or writes Google.
export async function GET() {
  const rejected = await accessFailure(); if (rejected) return rejected;
  const ready = configuration();
  return NextResponse.json({ configured: !!ready.config, missing: ready.missing, invalid: ready.invalid, ...(await queueStatus()) }, { headers });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Asal permintaan tidak diizinkan.' }, { status: 403, headers });
  const rejected = await accessFailure(); if (rejected) return rejected;
  const ready = configuration();
  if (!ready.config) return NextResponse.json({ configured: false, code: ready.invalid ? 'CONFIGURATION_INVALID' : 'CONFIGURATION_MISSING', missing: ready.missing,
    error: ready.invalid ? 'Konfigurasi Google Sheets belum valid. Periksa secret backend, JSON service account, dan target spreadsheet pada Vercel.' : 'Tambahkan konfigurasi Google Sheets pada Environment Variables Vercel, lalu deploy ulang.' }, { status: 503, headers });
  try {
    const config = ready.config;
    const owner = randomUUID();
    const deadline = AbortSignal.timeout(30000);
    const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
    const cleanupFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([AbortSignal.timeout(4000), init.signal]) : AbortSignal.timeout(4000) });
    const db = supabaseAdapter({ url: config.url, key: config.key, fetcher: boundedFetch });
    const cleanupDb = supabaseAdapter({ url: config.url, key: config.key, fetcher: cleanupFetch });
    const sheets = sheetsAdapter({ spreadsheetId: config.spreadsheetId, prefix: config.prefix,
      tokenProvider: googleTokenProvider(config.credentials, { fetcher: boundedFetch }), fetcher: boundedFetch,
      beforeRequest: async () => {
        deadline.throwIfAborted();
        if (!await db.rpc('laiora_sync_lease', { p_owner: owner, p_spreadsheet_id: config.spreadsheetId })) throw new Error('LEASE_LOST');
      },
    });
    const result = await runBoundedSync({ db, cleanupDb, sheets, owner, spreadsheetId: config.spreadsheetId, maxJobs: 5, budgetMs: 30000 });
    const status = await queueStatus();
    const message = result.busy ? 'Sinkronisasi lain sedang berjalan. Tunggu sebentar lalu coba lagi.'
      : result.timeLimited ? `${result.processed} data tersinkron. Batas waktu batch tercapai; klik lagi untuk melanjutkan antrean.`
      : result.failed ? `${result.processed} data tersinkron; sebagian antrean tertunda (${result.code}). Periksa izin Google/konfigurasi lalu coba ulang.`
      : result.idle ? `${result.processed} data tersinkron. Tidak ada antrean siap proses saat ini.`
      : `${result.processed} data tersinkron. Klik lagi jika antrean masih ada.`;
    return NextResponse.json({ ...result, pending: status?.pending ?? null, pendingFailures: status?.failed ?? null,
      configured: true, message }, { status: result.failed && !result.timeLimited ? 503 : result.busy ? 202 : 200, headers });
  } catch {
    return NextResponse.json({ configured: true, error: 'Sinkronisasi belum dapat dijalankan. Periksa konfigurasi Google, migrasi database, dan koneksi.', code: 'SYNC_UNAVAILABLE' }, { status: 503, headers });
  }
}
