import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { setupLocalWhatsApp } from '../scripts/setup-local-whatsapp.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'laiora-local-'));
  await mkdir(join(directory, 'services/whatsapp-bridge'), { recursive: true });
  try { await run(pathToFileURL(directory + '/')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const appPath = root => new URL('.env.local', root);
const servicePath = root => new URL('services/whatsapp-bridge/.env', root);
const contents = path => readFile(path, 'utf8');

test('new local setup shares a private token, generates a valid session key and preserves both on rerun', () => fixture(async root => {
  await setupLocalWhatsApp(root);
  const app = parseEnv(await contents(appPath(root))), service = parseEnv(await contents(servicePath(root)));
  assert.equal(app.WHATSAPP_BRIDGE_URL, 'http://127.0.0.1:3100');
  assert.equal(service.HOST, '127.0.0.1'); assert.equal(service.PORT, '3100'); assert.equal(service.DATA_DIR, './data');
  assert.equal(app.WHATSAPP_BRIDGE_TOKEN, service.WHATSAPP_BRIDGE_TOKEN);
  assert.equal(app.WHATSAPP_BRIDGE_TOKEN.length, 64);
  assert.equal(Buffer.from(service.WHATSAPP_SESSION_KEY, 'base64').length, 32);
  assert.equal(service.SUPABASE_SECRET_KEY, '');
  const before = [await contents(appPath(root)), await contents(servicePath(root))];
  await setupLocalWhatsApp(root);
  assert.deepEqual([await contents(appPath(root)), await contents(servicePath(root))], before);
}));
test('existing project settings, keys and custom variables are preserved', () => fixture(async root => {
  await writeFile(appPath(root), '# Existing config\nNEXT_PUBLIC_SUPABASE_URL="https://test.supabase.co"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="local-test-key"\nCUSTOM_OPTION="keep-me"\n');
  await setupLocalWhatsApp(root);
  const app = parseEnv(await contents(appPath(root))), service = parseEnv(await contents(servicePath(root)));
  assert.equal(app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'local-test-key');
  assert.equal(app.CUSTOM_OPTION, 'keep-me'); assert.equal(service.SUPABASE_URL, app.NEXT_PUBLIC_SUPABASE_URL);
}));
test('mismatched tokens are rejected without touching either file', () => fixture(async root => {
  await setupLocalWhatsApp(root);
  await writeFile(servicePath(root), (await contents(servicePath(root))).replace(/WHATSAPP_BRIDGE_TOKEN=.*$/m, 'WHATSAPP_BRIDGE_TOKEN="' + 'b'.repeat(64) + '"'));
  const before = [await contents(appPath(root)), await contents(servicePath(root))];
  await assert.rejects(setupLocalWhatsApp(root), /Token pada kedua file berbeda/);
  assert.deepEqual([await contents(appPath(root)), await contents(servicePath(root))], before);
}));
test('online server configuration is not replaced by a local connection', () => fixture(async root => {
  const existing = 'WHATSAPP_BRIDGE_URL="https://example.invalid"\n';
  await writeFile(appPath(root), existing);
  await assert.rejects(setupLocalWhatsApp(root), /menunjuk server lain/);
  assert.equal(await contents(appPath(root)), existing);
}));
test('invalid encryption keys and mismatched projects are rejected', () => fixture(async root => {
  await setupLocalWhatsApp(root);
  const original = await contents(servicePath(root));
  await writeFile(servicePath(root), original.replace(/WHATSAPP_SESSION_KEY=.*$/m, 'WHATSAPP_SESSION_KEY="invalid"'));
  await assert.rejects(setupLocalWhatsApp(root), /kunci sesi yang sudah ada tidak valid/);
  await writeFile(servicePath(root), original.replace(/SUPABASE_URL=.*$/m, 'SUPABASE_URL="https://other.supabase.co"'));
  await assert.rejects(setupLocalWhatsApp(root), /proyek Supabase berbeda/);
}));
