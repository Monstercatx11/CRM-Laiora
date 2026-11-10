import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { BridgeStartupError, readBridgeConfig, startupDiagnostic } from '../src/startup-diagnostics.mjs';
import { EncryptedStore } from '../src/store.mjs';

const valid = () => ({ SUPABASE_URL: 'https://never-contacted.invalid', SUPABASE_SECRET_KEY: 'sb_secret_synthetic_test_only', WHATSAPP_BRIDGE_TOKEN: randomBytes(32).toString('hex'), WHATSAPP_SESSION_KEY: randomBytes(32).toString('base64'), DATA_DIR: '/unused', PORT: '3100' });
const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url));
function rejects(config, code) {
  assert.throws(() => readBridgeConfig(config), error => error instanceof BridgeStartupError && error.code === code);
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'laiora-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function child(config) {
  const processHandle = spawn(process.execPath, [entry], { env: { ...process.env, ...config }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  processHandle.stdout.on('data', data => output += data);
  processHandle.stderr.on('data', data => output += data);
  return { process: processHandle, output: () => output };
}
async function failed(config, code) {
  const app = child(config);
  const deadline = setTimeout(() => app.process.kill('SIGKILL'), 10000);
  try {
    const [exit] = await once(app.process, 'exit');
    assert.equal(exit, 1); assert.match(app.output(), new RegExp(`\\[${code}\\]`));
    for (const name of ['SUPABASE_SECRET_KEY', 'WHATSAPP_BRIDGE_TOKEN', 'WHATSAPP_SESSION_KEY']) {
      if (config[name]) assert(!app.output().includes(config[name]), `Startup log leaked ${name}`);
    }
  } finally { clearTimeout(deadline); }
}

test('valid configuration retains original credentials and checks all missing settings', () => {
  const config = valid(), parsed = readBridgeConfig(config);
  assert.equal(parsed.token, config.WHATSAPP_BRIDGE_TOKEN); assert.equal(parsed.sessionKey, config.WHATSAPP_SESSION_KEY);
  for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'WHATSAPP_BRIDGE_TOKEN', 'WHATSAPP_SESSION_KEY', 'DATA_DIR']) rejects({ ...config, [name]: '' }, `MISSING_${name}`);
});
test('configuration rejects common pasted-key mistakes before acquiring the disk', () => {
  const config = valid();
  for (const key of ['short', 'WHATSAPP_SESSION_KEY=' + config.WHATSAPP_SESSION_KEY, '"' + config.WHATSAPP_SESSION_KEY + '"', config.WHATSAPP_SESSION_KEY + '\n']) rejects({ ...config, WHATSAPP_SESSION_KEY: key }, 'SESSION_KEY_INVALID');
  for (const token of ['short', 'WHATSAPP_BRIDGE_TOKEN=' + config.WHATSAPP_BRIDGE_TOKEN, config.WHATSAPP_BRIDGE_TOKEN + ' ']) rejects({ ...config, WHATSAPP_BRIDGE_TOKEN: token }, 'BRIDGE_TOKEN_INVALID');
  for (const url of ['invalid', 'http://example.invalid', 'https://name:password@example.invalid', 'https://example.invalid/rest/v1', 'https://example.invalid/?secret=test']) rejects({ ...config, SUPABASE_URL: url }, 'SUPABASE_URL_INVALID');
  rejects({ ...config, SUPABASE_SECRET_KEY: 'sb_publishable_synthetic' }, 'SUPABASE_KEY_INVALID');
  rejects({ ...config, SUPABASE_SECRET_KEY: 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature' }, 'SUPABASE_KEY_INVALID');
  rejects({ ...config, PORT: '70000' }, 'PORT_INVALID');
});
test('diagnostics never serialize raw errors, paths, environment values or stacks', () => {
  const marker = 'DO_NOT_PRINT_SYNTHETIC_SECRET';
  const error = Object.assign(new Error(marker), { code: 'EACCES', path: marker, stack: marker });
  assert.match(startupDiagnostic(error, 'storage'), /STORAGE_PERMISSION_DENIED/);
  assert.match(startupDiagnostic(error, 'listen'), /HOST_INVALID/);
  assert.match(startupDiagnostic(error), /STARTUP_FAILED/);
  assert(!startupDiagnostic(error, 'storage').includes(marker));
  assert(!startupDiagnostic(error).includes(marker));
});
test('real process prints actionable invalid-key and invalid-token codes without creating a lock', async t => {
  const directory = await fixture(t), config = { ...valid(), DATA_DIR: join(directory, 'data') };
  await failed({ ...config, WHATSAPP_SESSION_KEY: 'WHATSAPP_SESSION_KEY=' + config.WHATSAPP_SESSION_KEY }, 'SESSION_KEY_INVALID');
  await failed({ ...config, WHATSAPP_BRIDGE_TOKEN: 'too-short' }, 'BRIDGE_TOKEN_INVALID');
  await failed({ ...config, PORT: '0' }, 'PORT_INVALID');
  await assert.rejects(access(join(config.DATA_DIR, '.writer-lock')), { code: 'ENOENT' });
});
test('real process identifies an existing writer without removing its lock', async t => {
  const directory = await fixture(t), config = { ...valid(), DATA_DIR: directory };
  const store = new EncryptedStore(directory, config.WHATSAPP_SESSION_KEY);
  await store.acquire();
  try { await failed(config, 'SESSION_LOCKED'); await access(join(directory, '.writer-lock')); }
  finally { await store.release(); }
});
test('real process identifies wrong encryption key without resetting the stored session', async t => {
  const directory = await fixture(t), config = { ...valid(), DATA_DIR: directory };
  const store = new EncryptedStore(directory, config.WHATSAPP_SESSION_KEY);
  await store.acquire(); await store.write('auth', { creds: { registered: false }, keys: {} }); await store.release();
  const before = await readFile(join(directory, 'auth.enc'));
  await failed({ ...config, WHATSAPP_SESSION_KEY: randomBytes(32).toString('base64') }, 'SESSION_DECRYPTION_FAILED');
  assert.deepEqual(await readFile(join(directory, 'auth.enc')), before);
  await assert.rejects(access(join(directory, '.writer-lock')), { code: 'ENOENT' });
});
test('real process identifies an invalid storage path', async t => {
  const directory = await fixture(t), file = join(directory, 'regular-file');
  await writeFile(file, 'test');
  await failed({ ...valid(), DATA_DIR: join(file, 'data') }, 'STORAGE_PATH_INVALID');
});
test('real process starts and serves authenticated status without pairing or network ingestion', async t => {
  const directory = await fixture(t), probe = createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = { ...valid(), DATA_DIR: directory, PORT: String(port), HOST: '127.0.0.1' };
  const app = child(config);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (app.process.exitCode !== null) throw new Error('Bridge unexpectedly exited during healthy startup');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`, { headers: { Authorization: `Bearer ${config.WHATSAPP_BRIDGE_TOKEN}` } });
        if (response.ok) { assert.equal((await response.json()).state, 'disconnected'); ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready); assert.match(app.output(), /Laiora WhatsApp bridge ready/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/status`)).status, 401);
    for (const name of ['SUPABASE_SECRET_KEY', 'WHATSAPP_BRIDGE_TOKEN', 'WHATSAPP_SESSION_KEY']) assert(!app.output().includes(config[name]));
  } finally {
    if (app.process.exitCode === null) { app.process.kill('SIGTERM'); await once(app.process, 'exit'); }
  }
});
