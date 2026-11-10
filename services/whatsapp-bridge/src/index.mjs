import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { fetch, ProxyAgent } from 'undici';
import { EncryptedStore } from './store.mjs';
import { BridgeController } from './controller.mjs';
import { createBaileysAdapter } from './baileys-adapter.mjs';
import { createBridgeServer } from './server.mjs';
import { readBridgeConfig, startupDiagnostic, BridgeStartupError } from './startup-diagnostics.mjs';
// libsignal uses console directly for session objects. Suppress dependency output
// in this dedicated process; only the sanitized operational lines below are emitted.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'dir']) console[method] = () => {};

let startupPhase = 'config';
async function main() {
  const { supabaseUrl, secret, token, sessionKey, dataDirectory, port } = readBridgeConfig(process.env);
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  let dispatcher;
  try { dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined; }
  catch { throw new BridgeStartupError('PROXY_INVALID'); }
  const store = new EncryptedStore(resolve(dataDirectory), sessionKey);
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
  startupPhase = 'storage';
  await controller.initialize();
  startupPhase = 'listen';
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
main().catch(error => { process.stderr.write(startupDiagnostic(error, startupPhase) + '\n'); process.exitCode = 1; });
