import 'server-only';

export type WhatsAppStatus = {
  configured: boolean;
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'awaiting_qr' | 'qr_expired' | 'connected' | 'reconnecting' | 'storage_error' | 'unavailable';
  qrDataUrl?: string;
  lastMessageAt?: string;
  backlog?: number;
  error?: string;
};
const states = new Set(['disconnected', 'connecting', 'awaiting_qr', 'qr_expired', 'connected', 'reconnecting', 'storage_error']);
const errors = new Set(['logged_out', 'reconnect_exhausted', 'storage_error', 'database_unavailable']);

function bridgeConfig() {
  const address = process.env.WHATSAPP_BRIDGE_URL;
  const token = process.env.WHATSAPP_BRIDGE_TOKEN;
  if (!address || !token || token.length < 32) return null;
  try {
    const url = new URL(address);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return { url, token };
  } catch { return null; }
}

/** Bridge URL is administrator-controlled environment config, never request input. */
export async function whatsappRequest(action: 'status' | 'connect' | 'disconnect'): Promise<WhatsAppStatus> {
  const config = bridgeConfig();
  if (!config) return { configured: false, state: 'unconfigured' };
  try {
    const response = await fetch(new URL(`/${action}`, config.url), {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { configured: true, state: 'unavailable', error: 'bridge_unavailable' };
    const content = await response.text();
    if (content.length > 100000) throw new Error('Invalid bridge response');
    const data = JSON.parse(content);
    if (!states.has(data.state)) throw new Error('Invalid bridge status');
    return {
      configured: true,
      state: data.state,
      ...(typeof data.qrDataUrl === 'string' && data.qrDataUrl.length < 50000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qrDataUrl) && data.state === 'awaiting_qr' ? { qrDataUrl: data.qrDataUrl } : {}),
      ...(typeof data.lastMessageAt === 'string' && Number.isFinite(Date.parse(data.lastMessageAt)) ? { lastMessageAt: data.lastMessageAt } : {}),
      ...(Number.isSafeInteger(data.backlog) && data.backlog >= 0 ? { backlog: data.backlog } : {}),
      ...(errors.has(data.error) ? { error: data.error } : {}),
    };
  } catch { return { configured: true, state: 'unavailable', error: 'bridge_unavailable' }; }
}
