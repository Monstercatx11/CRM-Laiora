// Only fixed, reviewed text reaches startup logs. Never serialize raw errors,
// environment values, URLs, dependency output, session files or HTTP bodies.
const settings = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'WHATSAPP_BRIDGE_TOKEN', 'WHATSAPP_SESSION_KEY', 'DATA_DIR'];
const messages = {
  ...Object.fromEntries(settings.map(name => [`MISSING_${name}`, `Missing required setting: ${name}. Set it in Render Environment.`])),
  SUPABASE_URL_INVALID: 'SUPABASE_URL must be an HTTPS project URL without credentials, query, hash or an extra path. Paste the URL value only.',
  SUPABASE_KEY_INVALID: 'SUPABASE_SECRET_KEY requires a backend secret or legacy service_role key, not a publishable/anon key. Paste the value only, without quotes or spaces.',
  BRIDGE_TOKEN_INVALID: 'WHATSAPP_BRIDGE_TOKEN must contain at least 32 characters. Paste the token value only, without its variable name, quotes or whitespace.',
  SESSION_KEY_INVALID: 'WHATSAPP_SESSION_KEY must be exactly 32 random bytes encoded as base64 (44 characters ending in =). Paste only the value. Keep the original key if an existing session is stored.',
  SESSION_LOCKED: 'Session is locked: another bridge may own this volume. Ensure only one instance is running. If the previous process has stopped, remove only DATA_DIR/.writer-lock; keep encrypted files and the original session key.',
  STORE_UNREADABLE: 'Encrypted session or queue is unreadable; refusing to reset. Inspect the persistent disk without deleting customer/session files.',
  SESSION_DECRYPTION_FAILED: 'Encrypted session or queue failed authentication. Restore the original WHATSAPP_SESSION_KEY and volume; do not generate a replacement key for existing encrypted data.',
  AUTH_STATE_INVALID: 'Stored session has an invalid structure. Inspect the original persistent volume; session files were not reset.',
  QUEUE_INVALID: 'Stored message queue has an invalid structure. Inspect the original persistent volume; queued messages were not reset.',
  STORAGE_PERMISSION_DENIED: 'Cannot access DATA_DIR. Check Render Disks mount /var/data and DATA_DIR=/var/data/laiora-whatsapp, plus directory ownership/write permissions.',
  STORAGE_FULL: 'Persistent disk is full. Inspect disk usage and retained files before restarting; do not delete queued messages or session files.',
  STORAGE_PATH_INVALID: 'DATA_DIR is not a usable directory. Check the persistent disk mount and directory setting.',
  PORT_INVALID: 'PORT must be an integer from 1 to 65535. Use the PORT supplied by Render.',
  PORT_IN_USE: 'Listening port is already in use. Stop the duplicate process and use one connector instance.',
  HOST_INVALID: 'Cannot bind the listening address. On Render use HOST=0.0.0.0 and the PORT supplied by Render.',
  PROXY_INVALID: 'Proxy configuration is invalid. Check the host HTTPS_PROXY/HTTP_PROXY settings without printing their values.',
  STARTUP_FAILED: 'WhatsApp bridge startup failed for an unclassified reason. Check runtime/dependency compatibility and persistent disk configuration. Raw error details are suppressed to protect secrets.',
};

export class BridgeStartupError extends Error {
  constructor(code) {
    super(messages[code] || messages.STARTUP_FAILED);
    this.code = Object.hasOwn(messages, code) ? code : 'STARTUP_FAILED';
  }
}

export function startupDiagnostic(error, phase = '') {
  let code = error instanceof BridgeStartupError ? error.code : 'STARTUP_FAILED';
  if (phase === 'storage') {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) code = 'STORAGE_PERMISSION_DENIED';
    if (['ENOSPC', 'EDQUOT'].includes(error?.code)) code = 'STORAGE_FULL';
    if (['ENOTDIR', 'EISDIR'].includes(error?.code)) code = 'STORAGE_PATH_INVALID';
  }
  if (phase === 'listen') {
    if (error?.code === 'EADDRINUSE') code = 'PORT_IN_USE';
    if (['EADDRNOTAVAIL', 'ENOTFOUND', 'EACCES'].includes(error?.code)) code = 'HOST_INVALID';
  }
  return `[${code}] ${messages[code]}`;
}

export function readBridgeConfig(environment) {
  function required(name) {
    const value = environment[name];
    if (!value) throw new BridgeStartupError(`MISSING_${name}`);
    return value;
  }
  let supabaseUrl;
  try {
    const raw = required('SUPABASE_URL');
    supabaseUrl = new URL(raw);
    if (raw !== raw.trim() || supabaseUrl.protocol !== 'https:' || supabaseUrl.username || supabaseUrl.password || supabaseUrl.search || supabaseUrl.hash || supabaseUrl.pathname !== '/') throw new Error();
  } catch (error) {
    if (error instanceof BridgeStartupError) throw error;
    throw new BridgeStartupError('SUPABASE_URL_INVALID');
  }
  const secret = required('SUPABASE_SECRET_KEY');
  if (secret.startsWith('sb_publishable_') || secret.startsWith('SUPABASE_SECRET_KEY=') || /\s|["']/.test(secret)) throw new BridgeStartupError('SUPABASE_KEY_INVALID');
  if (secret.split('.').length === 3) {
    try { if (JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString()).role === 'anon') throw new BridgeStartupError('SUPABASE_KEY_INVALID'); }
    catch (error) { if (error instanceof BridgeStartupError) throw error; }
  }
  const token = required('WHATSAPP_BRIDGE_TOKEN');
  if (token.length < 32 || /\s|["']/.test(token) || token.startsWith('WHATSAPP_BRIDGE_TOKEN=')) throw new BridgeStartupError('BRIDGE_TOKEN_INVALID');
  const sessionKey = required('WHATSAPP_SESSION_KEY');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(sessionKey) || Buffer.from(sessionKey, 'base64').length !== 32 || Buffer.from(sessionKey, 'base64').toString('base64') !== sessionKey) throw new BridgeStartupError('SESSION_KEY_INVALID');
  const dataDirectory = required('DATA_DIR');
  const port = Number(environment.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BridgeStartupError('PORT_INVALID');
  return { supabaseUrl, secret, token, sessionKey, dataDirectory, port };
}
