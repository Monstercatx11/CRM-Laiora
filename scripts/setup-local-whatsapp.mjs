import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function setupLocalWhatsApp(root) {
  const dashboardPath = new URL('.env.local', root);
  const bridgePath = new URL('services/whatsapp-bridge/.env', root);
  async function read(path) {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  let dashboard = await read(dashboardPath), bridge = await read(bridgePath);
  const app = parseEnv(dashboard), service = parseEnv(bridge);
  const localUrl = 'http://127.0.0.1:3100';
  if (app.WHATSAPP_BRIDGE_URL && ![localUrl, localUrl + '/', 'http://localhost:3100', 'http://localhost:3100/'].includes(app.WHATSAPP_BRIDGE_URL)) {
    throw new Error('Konfigurasi dashboard menunjuk server lain. Cadangkan .env.local dan ubah WHATSAPP_BRIDGE_URL ke http://127.0.0.1:3100 untuk testing lokal.');
  }
  if (app.WHATSAPP_BRIDGE_TOKEN && service.WHATSAPP_BRIDGE_TOKEN && app.WHATSAPP_BRIDGE_TOKEN !== service.WHATSAPP_BRIDGE_TOKEN) {
    throw new Error('Token pada kedua file berbeda. Samakan WHATSAPP_BRIDGE_TOKEN di file lokal sebelum melanjutkan; setup tidak mengganti token lama.');
  }
  const token = service.WHATSAPP_BRIDGE_TOKEN || app.WHATSAPP_BRIDGE_TOKEN || randomBytes(32).toString('hex');
  const key = service.WHATSAPP_SESSION_KEY || randomBytes(32).toString('base64');
  if (token.length < 32 || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32) {
    throw new Error('Token/kunci sesi yang sudah ada tidak valid. Periksa file lokal; setup tidak mengganti kunci sesi lama.');
  }
  const url = service.SUPABASE_URL || app.SUPABASE_URL || app.NEXT_PUBLIC_SUPABASE_URL || 'https://nhkzxncfbfejbrceuzyb.supabase.co';
  if ([app.SUPABASE_URL, app.NEXT_PUBLIC_SUPABASE_URL, service.SUPABASE_URL].some(value => value && value !== url)) {
    throw new Error('Dashboard dan konektor menunjuk proyek Supabase berbeda. Samakan URL proyek pada file lokal terlebih dahulu.');
  }
  if ((service.PORT && service.PORT !== '3100') || (service.HOST && !['127.0.0.1', 'localhost'].includes(service.HOST))) {
    throw new Error('Testing lokal memakai HOST=127.0.0.1 dan PORT=3100. Periksa file konektor; konfigurasi lama dipertahankan.');
  }
  function fill(source, values) {
    const previous = parseEnv(source);
    for (const [name, value] of Object.entries(values)) {
      if (previous[name]) continue;
      const expression = new RegExp(`^${name}\\s*=.*$`, 'm');
      const line = `${name}=${JSON.stringify(value)}`;
      source = expression.test(source) ? source.replace(expression, () => line) : source.trimEnd() + '\n' + line + '\n';
    }
    return source;
  }
  dashboard = fill(dashboard, {
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
    WHATSAPP_BRIDGE_URL: localUrl, WHATSAPP_BRIDGE_TOKEN: token,
  });
  bridge = fill(bridge, {
    HOST: '127.0.0.1', PORT: '3100', DATA_DIR: './data', WHATSAPP_ACCOUNT_REF: 'laiora-main',
    SUPABASE_URL: url, SUPABASE_SECRET_KEY: '', WHATSAPP_BRIDGE_TOKEN: token, WHATSAPP_SESSION_KEY: key,
  });
  await writeFile(dashboardPath, dashboard, { mode: 0o600 });
  await writeFile(bridgePath, bridge, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupLocalWhatsApp(new URL('../', import.meta.url)).then(() => {
    console.log('Konfigurasi lokal siap. Token dan kunci sesi tersimpan di file .env yang diabaikan Git.');
    console.log('Isi NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY di .env.local dan SUPABASE_SECRET_KEY di services/whatsapp-bridge/.env.');
    console.log('Jangan kirim nilai secret atau kunci sesi ke chat. Panduan: docs/LOCALHOST_WINDOWS.md');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
