import { MessageQueue } from './queue.mjs';
import { normalizeMessage } from './messages.mjs';
import { BridgeStartupError } from './startup-diagnostics.mjs';

/** Socket adapter is injected, so lifecycle can be tested without a WhatsApp account. */
export class BridgeController {
  constructor({ store, adapter, ingest, qr, accountRef = 'laiora-main', reconnectDelay = attempt => Math.min(30000, 1000 * 2 ** attempt), maxReconnects = 5 }) {
    this.store = store;
    this.adapter = adapter;
    this.qr = qr;
    this.accountRef = accountRef;
    this.reconnectDelay = reconnectDelay;
    this.maxReconnects = maxReconnects;
    this.queue = new MessageQueue(store, ingest);
    this.state = 'disconnected';
    this.error = null;
    this.generation = 0;
    this.attempts = 0;
    this.operations = Promise.resolve();
  }
  async initialize() {
    await this.store.acquire();
    try {
      this.auth = await this.store.read('auth', null);
      if (this.auth !== null && (typeof this.auth !== 'object' || !this.auth.creds || typeof this.auth.creds !== 'object' || !this.auth.keys || typeof this.auth.keys !== 'object')) throw new BridgeStartupError('AUTH_STATE_INVALID');
      await this.queue.initialize();
      void this.queue.flush();
      if (this.auth?.creds?.registered) await this.connect();
    } catch (error) { await this.queue.stop(); await this.store.release(); throw error; }
  }
  serial(action) {
    const result = this.operations.then(action);
    this.operations = result.catch(() => {});
    return result;
  }
  status() {
    return {
      configured: true,
      state: this.state,
      ...(this.qrDataUrl && this.qrUntil > Date.now() ? { qrDataUrl: this.qrDataUrl } : {}),
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}),
      backlog: this.queue.items.length,
      ...(this.error || this.queue.error ? { error: this.error || this.queue.error } : {}),
    };
  }
  connect() {
    return this.serial(async () => {
      if (['connecting', 'awaiting_qr', 'connected', 'reconnecting'].includes(this.state)) return;
      if (this.state === 'storage_error' || this.stopped) throw new Error('Bridge requires operator restart');
      this.attempts = 0;
      this.error = null;
      await this.open();
    });
  }
  async open() {
    clearTimeout(this.retryTimer);
    this.state = this.attempts ? 'reconnecting' : 'connecting';
    this.clearQr();
    const generation = ++this.generation;
    this.socket?.dispose();
    this.socket = null;
    try {
      this.socket = await this.adapter({
        auth: this.auth,
        saveAuth: async auth => {
          if (generation !== this.generation) return;
          try { await this.store.write('auth', auth); this.auth = auth; }
          catch { this.storageFailure(); throw new Error('Session persistence failed'); }
        },
        onUpdate: update => {
          void this.serial(async () => { if (generation === this.generation) await this.update(update); }).catch(() => this.storageFailure());
        },
        onMessages: events => {
          if (generation !== this.generation) return;
          const items = events.map(event => normalizeMessage(event, this.accountRef)).filter(Boolean);
          if (!items.length) return;
          void this.queue.enqueue(items).then(() => {
            this.lastMessageAt = new Date().toISOString();
          }).catch(() => this.storageFailure());
        },
      });
    } catch {
      if (this.state !== 'storage_error') this.retry();
    }
  }
  async update(update) {
    if (update.qr) {
      this.qrDataUrl = await this.qr(update.qr);
      this.qrUntil = Date.now() + 60000;
      this.state = 'awaiting_qr';
      clearTimeout(this.qrTimer);
      this.qrTimer = setTimeout(() => {
        this.clearQr();
        if (this.state === 'awaiting_qr') this.state = 'qr_expired';
      }, 60000);
      this.qrTimer.unref?.();
    }
    if (update.connection === 'open') {
      this.state = 'connected';
      this.error = null;
      this.attempts = 0;
      this.clearQr();
    }
    if (update.connection === 'close') {
      this.socket?.dispose();
      this.socket = null;
      this.clearQr();
      if (update.loggedOut) {
        ++this.generation;
        await this.store.write('auth', null);
        this.auth = null;
        this.state = 'disconnected';
        this.error = 'logged_out';
      } else this.retry();
    }
  }
  clearQr() { clearTimeout(this.qrTimer); this.qrDataUrl = null; this.qrUntil = 0; }
  retry() {
    this.socket?.dispose();
    this.socket = null;
    ++this.generation;
    this.clearQr();
    if (this.attempts >= this.maxReconnects) {
      this.state = 'disconnected';
      this.error = 'reconnect_exhausted';
      return;
    }
    this.state = 'reconnecting';
    const delay = this.reconnectDelay(this.attempts++);
    this.retryTimer = setTimeout(() => {
      void this.serial(() => this.open()).catch(() => this.storageFailure());
    }, delay);
    this.retryTimer.unref?.();
  }
  storageFailure() {
    clearTimeout(this.retryTimer);
    ++this.generation;
    this.clearQr();
    this.socket?.dispose();
    this.socket = null;
    this.state = 'storage_error';
    this.error = 'storage_error';
  }
  disconnect() {
    return this.serial(async () => {
      clearTimeout(this.retryTimer);
      ++this.generation;
      this.clearQr();
      const socket = this.socket;
      this.socket = null;
      try { await socket?.logout(); } catch { /* local credentials still revoked below */ }
      socket?.dispose();
      await this.store.write('auth', null);
      this.auth = null;
      this.state = 'disconnected';
      this.error = null;
    });
  }
  async stop() {
    this.stopped = true;
    await this.serial(async () => {
      clearTimeout(this.retryTimer);
      ++this.generation;
      this.clearQr();
      this.socket?.dispose();
      this.socket = null;
      await this.queue.stop();
      await this.store.release();
    });
  }
}
