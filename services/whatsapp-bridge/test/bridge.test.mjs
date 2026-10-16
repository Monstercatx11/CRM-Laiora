import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { EncryptedStore } from '../src/store.mjs';
import { MessageQueue } from '../src/queue.mjs';
import { BridgeController } from '../src/controller.mjs';
import { createBridgeServer } from '../src/server.mjs';
import { normalizeMessage } from '../src/messages.mjs';

const key = () => randomBytes(32).toString('base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'laiora-bridge-'));
  const secret = key();
  const store = new EncryptedStore(path, secret);
  t.after(async () => { await store.release(); await rm(path, { recursive: true, force: true }); });
  return { path, secret, store };
}
const event = (id = 'message-1', extra = {}) => ({ key: { id, remoteJid: '628123@s.whatsapp.net' }, pushName: 'Pelanggan', messageTimestamp: 1750000000, message: { conversation: 'Pesan produk Laiora' }, ...extra });
const payload = id => normalizeMessage(event(id), 'laiora-main');

test('encrypted store round-trips buffers and never leaves auth or customer plaintext on disk', async t => {
  const { store, path } = await fixture(t);
  await store.acquire();
  const auth = { name: 'sensitive customer', binary: Buffer.from('auth secret'), bytes: Uint8Array.from([1, 2]) };
  await store.write('auth', auth);
  const bytes = await readFile(join(path, 'auth.enc'), 'utf8');
  assert.ok(!bytes.includes('sensitive customer'));
  assert.ok(!bytes.includes('auth secret'));
  assert.deepEqual(await store.read('auth', null), { ...auth, bytes: Buffer.from([1, 2]) });
});

test('second writer is refused while the persistent volume is locked', async t => {
  const { store, path, secret } = await fixture(t);
  await store.acquire();
  await assert.rejects(new EncryptedStore(path, secret).acquire(), /locked/);
});

test('wrong encryption key and tampered data fail closed', async t => {
  const { store, path } = await fixture(t);
  await store.acquire();
  await store.write('auth', { token: 'never reset silently' });
  await store.release();
  const wrong = new EncryptedStore(path, key());
  await wrong.acquire();
  await assert.rejects(wrong.read('auth', null), /failed authentication/);
  await wrong.release();
  await store.acquire();
  await writeFile(join(path, 'auth.enc'), '{bad json');
  await assert.rejects(store.read('auth', null), /refusing to reset/);
});

test('messages ignore groups, broadcasts and protocol changes; personal outbound messages are normalized', () => {
  assert.equal(normalizeMessage(event('x', { key: { id: 'x', remoteJid: 'group@g.us' } }), 'a'), null);
  assert.equal(normalizeMessage(event('x', { key: { id: 'x', remoteJid: 'status@broadcast' } }), 'a'), null);
  assert.equal(normalizeMessage(event('x', { message: { protocolMessage: { type: 0 } } }), 'a'), null);
  const outgoing = normalizeMessage(event('out', { key: { id: 'out', remoteJid: '628123@s.whatsapp.net', fromMe: true } }), 'a');
  assert.equal(outgoing.p_direction, 'outbound');
  assert.equal(outgoing.p_phone, '628123');
  assert.equal(outgoing.p_name, null);
});

test('message unwrap handles ephemeral media captions and does not invent LID phone numbers', () => {
  const value = normalizeMessage(event('media', { key: { id: 'media', remoteJid: 'opaque@lid' }, message: { ephemeralMessage: { message: { imageMessage: { caption: 'Pesan 10 unit' } } } } }), 'a');
  assert.equal(value.p_body, 'Pesan 10 unit');
  assert.equal(value.p_type, 'image');
  assert.equal(value.p_phone, null);
});

test('database outage retains encrypted queue across restart and duplicate events enqueue once', async t => {
  const { store, path } = await fixture(t);
  await store.acquire();
  const queue = new MessageQueue(store, async () => { throw new Error('offline'); });
  await queue.initialize();
  await queue.enqueue([payload('a'), payload('a'), payload('b')]);
  await queue.flush();
  assert.equal(queue.items.length, 2);
  assert.equal(queue.error, 'database_unavailable');
  assert.ok(!(await readFile(join(path, 'messages.enc'), 'utf8')).includes('Pesan produk'));
  await queue.stop();
  const sent = [];
  const restored = new MessageQueue(store, async item => { sent.push(item.p_message_id); });
  await restored.initialize();
  await restored.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(restored.items.length, 0);
  assert.deepEqual(await store.read('messages', null), []);
  await restored.stop();
});

test('queue can persist a second message during a slow in-flight database request', async t => {
  const { store } = await fixture(t);
  await store.acquire();
  let complete;
  const held = new Promise(resolve => { complete = resolve; });
  const queue = new MessageQueue(store, async () => { await held; });
  await queue.initialize();
  await queue.enqueue([payload('one')]);
  await tick();
  await queue.enqueue([payload('two')]);
  assert.equal((await store.read('messages', [])).length, 2);
  complete();
  await queue.flush();
  assert.equal(queue.items.length, 0);
  await queue.stop();
});

async function controllerFixture(t, overrides = {}) {
  const fixtureData = await fixture(t);
  const adapters = [];
  const controller = new BridgeController({
    store: fixtureData.store,
    ingest: async () => {},
    qr: async input => `data:image/png;base64,${Buffer.from(input).toString('base64')}`,
    adapter: async callbacks => {
      const adapter = { ...callbacks, disposed: false, loggedOut: false, dispose() { this.disposed = true; }, async logout() { this.loggedOut = true; } };
      adapters.push(adapter);
      return adapter;
    },
    ...overrides,
  });
  await controller.initialize();
  t.after(() => controller.stop());
  return { ...fixtureData, controller, adapters };
}

test('QR, connected and explicit disconnect lifecycle clears credentials and QR', async t => {
  const { controller, adapters, store } = await controllerFixture(t);
  await controller.connect();
  assert.equal(adapters.length, 1);
  await controller.connect();
  assert.equal(adapters.length, 1);
  adapters[0].onUpdate({ qr: 'private QR' });
  await controller.operations;
  assert.equal(controller.status().state, 'awaiting_qr');
  assert.ok(controller.status().qrDataUrl);
  adapters[0].onUpdate({ connection: 'open' });
  await controller.operations;
  assert.equal(controller.status().state, 'connected');
  assert.equal(controller.status().qrDataUrl, undefined);
  await controller.disconnect();
  assert.equal(adapters[0].loggedOut, true);
  assert.equal(adapters[0].disposed, true);
  assert.equal(controller.status().state, 'disconnected');
  assert.equal(await store.read('auth', 'missing'), null);
});

test('WhatsApp logout clears stored auth and stale callbacks cannot revive a closed session', async t => {
  const { controller, adapters, store } = await controllerFixture(t);
  await controller.connect();
  await adapters[0].saveAuth({ creds: { registered: true }, keys: {} });
  adapters[0].onUpdate({ connection: 'close', loggedOut: true });
  await controller.operations;
  assert.equal(controller.status().error, 'logged_out');
  assert.equal(await store.read('auth', 'missing'), null);
  adapters[0].onUpdate({ connection: 'open', qr: 'stale' });
  await controller.operations;
  assert.equal(controller.status().state, 'disconnected');
  assert.equal(controller.status().qrDataUrl, undefined);
});

test('connection failures stop after bounded reconnect attempts', async t => {
  let attempts = 0;
  const { controller } = await controllerFixture(t, {
    reconnectDelay: () => 1,
    maxReconnects: 2,
    adapter: async () => { attempts++; throw new Error('offline'); },
  });
  await controller.connect();
  for (let i = 0; i < 30 && controller.status().state !== 'disconnected'; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(attempts, 3);
  assert.equal(controller.status().error, 'reconnect_exhausted');
});

test('expired QR reconnect closes the old socket first', async t => {
  const { controller, adapters } = await controllerFixture(t);
  await controller.connect();
  controller.state = 'qr_expired';
  await controller.connect();
  assert.equal(adapters.length, 2);
  assert.equal(adapters[0].disposed, true);
});

test('storage failure stops the socket and does not silently reconnect', async t => {
  const { controller, adapters, store } = await controllerFixture(t);
  await controller.connect();
  const original = store.write.bind(store);
  store.write = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(adapters[0].saveAuth({ creds: {} }), /persistence/);
  assert.equal(controller.status().state, 'storage_error');
  assert.equal(adapters[0].disposed, true);
  await assert.rejects(controller.connect(), /restart/);
  store.write = original;
});

test('HTTP endpoints require bearer auth, reject browsers and mutation GET, and do not expose secrets', async t => {
  const { controller } = await controllerFixture(t);
  const token = 'a'.repeat(48);
  const server = createBridgeServer(controller, token);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/status`)).status, 401);
  assert.equal((await fetch(`${url}/status`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${url}/status`, { headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(`${url}/connect`, { headers })).status, 405);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers })).status, 404);
  const result = await fetch(`${url}/connect`, { method: 'POST', headers });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).state, 'connecting');
  const status = await fetch(`${url}/status`, { headers });
  assert.equal(status.headers.get('access-control-allow-origin'), null);
  assert.match(status.headers.get('cache-control'), /no-store/);
  assert.ok(!(await status.text()).includes(token));
  assert.equal((await fetch(`${url}/disconnect`, { method: 'POST', headers })).status, 200);
});
