import { BridgeStartupError } from './startup-diagnostics.mjs';
/** Durable, encrypted outbox: acknowledge only after the idempotent RPC succeeds. */
export class MessageQueue {
  constructor(store, ingest, onChange = () => {}) {
    this.store = store;
    this.ingest = ingest;
    this.onChange = onChange;
    this.items = [];
    this.serial = Promise.resolve();
    this.draining = null;
    this.closed = false;
    this.error = null;
  }
  async initialize() {
    this.items = await this.store.read('messages', []);
    if (!Array.isArray(this.items) || this.items.some(item => !item?.p_message_id || !item?.p_chat_id)) throw new BridgeStartupError('QUEUE_INVALID');
    this.timer = setInterval(() => void this.flush(), 5000);
    this.timer.unref();
  }
  mutation(action) {
    const result = this.serial.then(action);
    this.serial = result.catch(() => {});
    return result;
  }
  async enqueue(items) {
    await this.mutation(async () => {
      const existing = new Set(this.items.map(key));
      const additions = items.filter(item => { const id = key(item); if (existing.has(id)) return false; existing.add(id); return true; });
      if (!additions.length) return;
      const next = [...this.items, ...additions];
      await this.store.write('messages', next);
      this.items = next;
      this.onChange();
    });
    void this.flush();
  }
  flush() {
    if (this.draining || this.closed) return this.draining ?? Promise.resolve();
    this.draining = this.drain().finally(() => { this.draining = null; });
    return this.draining;
  }
  async drain() {
    while (this.items.length && !this.closed) {
      const item = this.items[0];
      try {
        await this.ingest(item);
        await this.mutation(async () => {
          const next = this.items.filter(value => key(value) !== key(item));
          await this.store.write('messages', next);
          this.items = next;
          this.error = null;
          this.onChange();
        });
      } catch {
        this.error = 'database_unavailable';
        this.onChange();
        return;
      }
    }
  }
  async stop() {
    this.closed = true;
    clearInterval(this.timer);
    await this.draining;
    await this.serial;
  }
}
const key = item => JSON.stringify([item.p_account_ref, item.p_chat_id, item.p_message_id]);
