import makeWASocket, { initAuthCreds, proto, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function createBaileysAdapter() {
  // Silent protocol logger prevents QR strings, message bodies and auth keys from logging.
  const logger = pino({ level: 'silent' });
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  return async ({ auth, saveAuth, onUpdate, onMessages }) => {
    const current = auth ?? { creds: initAuthCreds(), keys: {} };
    current.keys ??= {};
    const socket = makeWASocket({
      auth: {
        creds: current.creds,
        keys: {
          async get(type, ids) {
            const found = {};
            for (const id of ids) {
              let value = current.keys[`${type}:${id}`];
              if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              if (value) found[id] = value;
            }
            return found;
          },
          async set(data) {
            for (const [type, values] of Object.entries(data)) {
              for (const [id, value] of Object.entries(values)) {
                if (value == null) delete current.keys[`${type}:${id}`];
                else current.keys[`${type}:${id}`] = value;
              }
            }
            await saveAuth(current);
          },
        },
      },
      logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      ...(agent ? { agent, fetchAgent: agent } : {}),
    });
    const creds = updates => {
      Object.assign(current.creds, updates);
      void saveAuth(current).catch(() => socket.end(new Error('Session persistence failed')));
    };
    const update = event => onUpdate({
      ...event,
      loggedOut: event.lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut,
    });
    const messages = event => onMessages(event.messages ?? []);
    socket.ev.on('creds.update', creds);
    socket.ev.on('connection.update', update);
    socket.ev.on('messages.upsert', messages);
    // WhatsApp may offer only recent history after linking; never promise complete history.
    socket.ev.on('messaging-history.set', messages);
    await saveAuth(current);
    return {
      async logout() { await Promise.race([socket.logout(), new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('Logout timeout')), 5000); timeout.unref(); })]); },
      dispose() {
        socket.ev.off('creds.update', creds);
        socket.ev.off('connection.update', update);
        socket.ev.off('messages.upsert', messages);
        socket.ev.off('messaging-history.set', messages);
        socket.end(undefined);
      },
    };
  };
}
