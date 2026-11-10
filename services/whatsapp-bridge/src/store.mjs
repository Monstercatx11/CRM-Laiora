import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, open, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeStartupError } from './startup-diagnostics.mjs';

const replacer = (_, value) => value instanceof Uint8Array ? { type: 'Buffer', data: [...value] } : value;
const reviver = (_, value) => value?.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data) : value;

/** Single writer, private permissions, authenticated encryption, atomic replace. */
export class EncryptedStore {
  constructor(directory, key) {
    this.directory = directory;
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== key) throw new BridgeStartupError('SESSION_KEY_INVALID');
    this.locked = false;
    this.writes = Promise.resolve();
  }
  async acquire() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      await mkdir(join(this.directory, '.writer-lock'), { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new BridgeStartupError('SESSION_LOCKED');
      throw error;
    }
    this.locked = true;
    try {
      await writeFile(join(this.directory, '.writer-lock', 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }), { mode: 0o600 });
    } catch (error) {
      // Only our freshly acquired lock is removed; never clear another writer's lock.
      await this.release().catch(() => {});
      throw error;
    }
  }
  async read(name, fallback) {
    if (!this.locked) throw new Error('Store is not locked');
    let envelope;
    try { envelope = JSON.parse(await readFile(join(this.directory, `${name}.enc`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw new BridgeStartupError('STORE_UNREADABLE'); }
    try {
      if (envelope.version !== 1) throw new Error('Version');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(`laiora:${name}:v1`));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'), reviver);
    } catch { throw new BridgeStartupError('SESSION_DECRYPTION_FAILED'); }
  }
  write(name, value) {
    // Serialize the snapshot immediately: later auth mutations cannot change this write.
    const serialized = JSON.stringify(value, replacer);
    const write = this.writes.then(async () => {
      if (!this.locked) throw new Error('Store is not locked');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(`laiora:${name}:v1`));
      const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
      const envelope = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
      const file = join(this.directory, `${name}.enc`);
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(envelope); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      // Windows cannot open/flush directory handles through Node's fs API.
      // The encrypted file was flushed above; retain directory fsync on POSIX.
      if (process.platform !== 'win32') {
        const directory = await open(this.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
  async release() {
    await this.writes;
    if (this.locked) { await rm(join(this.directory, '.writer-lock'), { recursive: true }); this.locked = false; }
  }
}
