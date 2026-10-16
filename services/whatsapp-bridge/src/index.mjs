import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { fetch, ProxyAgent } from 'undici';
import { EncryptedStore } from './store.mjs';
import { BridgeController } from './controller.mjs';
import { createBaileysAdapter } from './baileys-adapter.mjs';
import { createBridgeServer } from './server.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}
// libsignal uses console directly for session objects. Suppress dependency output
// in this dedicated process; only the sanitized operational lines below are emitted.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'dir']) console[method] = () => {};

async function main() {
  const supabaseUrl = new URL(required('SUPABASE_URL'));
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.username || supabaseUrl.password) throw new Error('SUPABASE_URL must be an HTTPS project URL');
  const secret = required('SUPABASE_SECRET_KEY');
  if (secret.startsWith('sb_publishable_')) throw new Error('SUPABASE_SECRET_KEY requires a backend secret, not a publishable key');
  const token = required('WHATSAPP_BRIDGE_TOKEN');
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const store = new EncryptedStore(resolve(required('DATA_DIR')), required('WHATSAPP_SESSION_KEY'));
  const controller = new BridgeController({
    store,
    adapter: createBaileysAdapter(),
    accountRef: process.env.WHATSAPP_ACCOUNT_REF || 'laiora-main',
    qr: value => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', width: 320, margin: 3 }),
    async ingest(payload) {
      const response = await fetch(new URL('/rest/v1/rpc/laiora_ingest_message', supabaseUrl), {
        method: 'POST',
        headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
        ...(dispatcher ? { dispatcher } : {}),
      });
      // Do not log HTTP bodies: they can contain customer or database information.
      if (!response.ok) { await response.body?.cancel(); throw new Error('Database ingestion failed'); }
      await response.text();
    },
  });
  // Construct before acquiring the volume so invalid token configuration cannot leak a lock.
  const server = createBridgeServer(controller, token);
  await controller.initialize();
  const port = Number(process.env.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { await controller.stop(); throw new Error('Invalid PORT'); }
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, process.env.HOST || '127.0.0.1', resolveListen);
  }).catch(async error => { await controller.stop(); throw error; });
  process.stdout.write('Laiora WhatsApp bridge ready\n');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise(done => server.close(done));
    await controller.stop();
    await dispatcher?.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().catch(() => { process.exitCode = 1; }); });
}
main().catch(error => { process.stderr.write((error.message?.startsWith('Missing required setting:') ? error.message : 'WhatsApp bridge startup failed. Check environment settings, persistent volume lock and encryption key.') + '\n'); process.exitCode = 1; });
