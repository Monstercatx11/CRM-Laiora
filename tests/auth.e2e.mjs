import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This suite talks only to its own fake Auth/Data API and production Next server.
// Private runtime settings isolate tests even when the build embeds public project settings.
const repository = fileURLToPath(new URL('..', import.meta.url));
const protectedPaths = ['/dashboard', '/pesanan', '/tracking-chat', '/produksi', '/pengiriman', '/pembayaran', '/katalog', '/pengaturan', '/integrasi'];
const allowedUser = { id: '11111111-1111-4111-8111-111111111111', email: 'allowed@example.test' };
const unboundUser = { id: '22222222-2222-4222-8222-222222222222', email: 'unbound@example.test' };
const password = 'example-password';
const tokens = new Map();
const refreshTokens = new Map();
const calls = [];
const unexpectedApiCalls = [];
const unexpectedBrowserRequests = [];
const pageErrors = [];
const consoleErrors = [];
let rpcUnavailable = false;
let fakeOrigin;
let app;
let browser;
let appLog = '';
let passed = 0;
let failure;

function jwt(user, expiration = Math.floor(Date.now() / 1000) + 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email,
    iat: Math.floor(Date.now() / 1000) - 5, exp: expiration, iss: `${fakeOrigin}/auth/v1`,
    session_id: randomUUID(), app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}, aal: 'aal1',
  })).toString('base64url');
  const signature = createHmac('sha256', 'local-test-signing-key').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function authUser(user) {
  return {
    ...user, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z', identities: [],
  };
}

function sessionFor(user, expired = false) {
  const expiresAt = Math.floor(Date.now() / 1000) + (expired ? -120 : 3600);
  const accessToken = jwt(user, expiresAt);
  const refreshToken = randomUUID();
  tokens.set(accessToken, { user, expiresAt });
  refreshTokens.set(refreshToken, user);
  return { access_token: accessToken, token_type: 'bearer', expires_in: expired ? -120 : 3600,
    expires_at: expiresAt, refresh_token: refreshToken, user: authUser(user) };
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

const fakeSupabase = createServer(async (request, response) => {
  const url = new URL(request.url, fakeOrigin);
  const record = { path: url.pathname, method: request.method, grant: url.searchParams.get('grant_type') };
  calls.push(record);
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { respond(response, 400, { message: 'Invalid JSON' }); return; }
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const authenticated = tokens.get(bearer);
  const valid = authenticated && authenticated.expiresAt > Math.floor(Date.now() / 1000);

  if (url.pathname === '/auth/v1/token' && record.grant === 'password') {
    const user = [allowedUser, unboundUser].find((candidate) => candidate.email === body.email);
    if (!user || body.password !== password) {
      respond(response, 400, { error: 'invalid_grant', error_code: 'invalid_credentials', error_description: 'Invalid login credentials', message: 'Invalid login credentials' });
      return;
    }
    respond(response, 200, sessionFor(user));
    return;
  }
  if (url.pathname === '/auth/v1/token' && record.grant === 'refresh_token') {
    const user = refreshTokens.get(body.refresh_token);
    if (!user) { respond(response, 400, { code: 'refresh_token_not_found', message: 'Invalid refresh token' }); return; }
    refreshTokens.delete(body.refresh_token);
    respond(response, 200, sessionFor(user));
    return;
  }
  if (url.pathname === '/auth/v1/user') {
    if (!valid) { respond(response, 401, { code: 'bad_jwt', message: 'Invalid JWT' }); return; }
    respond(response, 200, authUser(authenticated.user));
    return;
  }
  if (url.pathname === '/auth/v1/logout') {
    tokens.delete(bearer);
    if (authenticated) {
      for (const [token, user] of refreshTokens) if (user.id === authenticated.user.id) refreshTokens.delete(token);
    }
    respond(response, 204);
    return;
  }
  if (url.pathname === '/rest/v1/rpc/laiora_has_access') {
    if (rpcUnavailable) { respond(response, 503, { code: 'TEST_UNAVAILABLE', message: 'Synthetic database outage' }); return; }
    if (!valid) { respond(response, 401, { code: 'PGRST301', message: 'Invalid JWT' }); return; }
    respond(response, 200, authenticated.user.id === allowedUser.id);
    return;
  }
  // Explicit empty operational fixtures keep this suite focused on Auth while
  // retaining an allowlist: an unexpected table/RPC still fails the audit.
  const readTables = ['/rest/v1/orders', '/rest/v1/products', '/rest/v1/conversations'];
  const readRpcs = ['/rest/v1/rpc/laiora_get_sequence', '/rest/v1/rpc/laiora_sync_status'];
  if ((request.method === 'GET' && readTables.includes(url.pathname)) ||
      (request.method === 'POST' && readRpcs.includes(url.pathname)) ||
      (request.method === 'GET' && url.pathname === '/rest/v1/app_settings')) {
    if (!valid) { respond(response, 401, { code: 'PGRST301', message: 'Invalid JWT' }); return; }
    if (authenticated.user.id !== allowedUser.id) { respond(response, 403, { code: '42501', message: 'Access denied' }); return; }
    if (url.pathname === '/rest/v1/app_settings') {
      respond(response, 200, { singleton: true, business_name: 'Laiora test', timezone: 'Asia/Jakarta', whatsapp_phone: '', bank_name: '', bank_account: '', bank_holder: '', greeting_card_price: 5000, logo_path: null });
    } else if (url.pathname === '/rest/v1/rpc/laiora_sync_status') {
      respond(response, 200, { pending: 0, failed: 0, last_completed: null });
    } else {
      response.setHeader('Content-Range', '*/0');
      respond(response, 200, []);
    }
    return;
  }
  if (url.pathname === '/auth/v1/.well-known/jwks.json') {
    respond(response, 200, { keys: [] });
    return;
  }
  unexpectedApiCalls.push(record);
  respond(response, 404, { message: 'Unexpected fake Supabase endpoint' });
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function freePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForApp(origin) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Next exited before readiness (exit ${app.exitCode})`);
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) return;
    } catch { /* The process is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Production Next server did not become ready within 40 seconds.');
}

async function check(name, test) {
  await test();
  passed++;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

async function withPage(origin, callback) {
  const context = await browser.newContext({ baseURL: origin });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && ![origin, fakeOrigin].includes(url.origin)) {
      unexpectedBrowserRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try { await callback(page, context); }
  finally { await context.close(); }
}

async function login(page, email = allowedUser.email, next = '/dashboard', enteredPassword = password) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(enteredPassword);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}

async function waitForPath(page, path) {
  await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
}

// Chromium accepts Secure cookies on HTTP loopback origins; Playwright's
// standalone APIRequestContext intentionally follows stricter cookie matching.
// Use the actual browser transport to exercise the production cookie settings.
async function sessionResponse(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
  });
}

function decodeSession(value) {
  const decoded = decodeURIComponent(value);
  return JSON.parse(decoded.startsWith('base64-') ? Buffer.from(decoded.slice(7), 'base64url').toString('utf8') : decoded);
}

async function rewriteSession(context, mutate) {
  const cookies = await context.cookies();
  const authCookies = cookies.filter((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name));
  assert(authCookies.length, 'A successful login must set Supabase session cookies.');
  authCookies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const existing = decodeSession(authCookies.map((cookie) => cookie.value).join(''));
  const updated = mutate(existing);
  const base = authCookies[0].name.replace(/\.\d+$/, '');
  await context.clearCookies();
  const value = `base64-${Buffer.from(JSON.stringify(updated)).toString('base64url')}`;
  // Test sessions are deliberately small enough to fit in one cookie.
  assert(value.length < 3180, 'Synthetic session unexpectedly needs cookie chunking.');
  await context.addCookies([{ ...authCookies[0], name: base, value }]);
}

try {
  const fakePort = await listen(fakeSupabase);
  fakeOrigin = `http://127.0.0.1:${fakePort}`;
  const appPort = await freePort();
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const childEnvironment = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    SUPABASE_URL: fakeOrigin, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_auth_test',
    NEXT_PUBLIC_SUPABASE_URL: fakeOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_auth_test' };
  for (const key of Object.keys(childEnvironment)) if (/SUPABASE_(?:SECRET|SERVICE_ROLE|ACCESS_TOKEN)|DATABASE_URL|WHATSAPP_|GOOGLE_(?:SERVICE|SPREADSHEET)|CRON_SECRET/.test(key)) delete childEnvironment[key];
  Object.assign(childEnvironment, { SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ACCESS_TOKEN: '', DATABASE_URL: '', WHATSAPP_BRIDGE_URL: '', WHATSAPP_BRIDGE_TOKEN: '', GOOGLE_SERVICE_ACCOUNT_JSON: '', GOOGLE_SPREADSHEET_ID: '' });
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)],
    { cwd: repository, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  const rememberLog = (chunk) => { appLog = (appLog + chunk.toString()).slice(-16_000); };
  app.stdout.on('data', rememberLog);
  app.stderr.on('data', rememberLog);
  app.on('error', (error) => { appLog += error.message; });
  await waitForApp(appOrigin);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  await check('CRM root redirects to dashboard and anonymous visitors reach login', async () => {
    const root = await fetch(`${appOrigin}/`, { redirect: 'manual' });
    assert.equal(root.status, 307);
    assert.equal(root.headers.get('location'), '/dashboard');
    await withPage(appOrigin, async page => {
      await page.goto('/');
      await waitForPath(page, '/login');
      assert.equal(new URL(page.url()).searchParams.get('next'), '/dashboard');
      await page.getByLabel('Email', { exact: true }).waitFor();
    });
    assert.equal((await fetch(`${appOrigin}/index.html`)).status, 404);
  });

  await check('every division rejects unauthenticated direct navigation and preserves its destination', async () => {
    await withPage(appOrigin, async (page) => {
      for (const path of protectedPaths) {
        await page.goto(path);
        await waitForPath(page, '/login');
        assert.equal(new URL(page.url()).searchParams.get('next'), path);
        assert.equal(await page.getByLabel('Email', { exact: true }).count(), 1);
      }
    });
  });

  await check('session API rejects anonymous requests and is never cached', async () => {
    const response = await fetch(`${appOrigin}/api/session`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control') || '', /(?:^|[,\s])no-store(?:$|[,\s])/i);
    const body = await response.json();
    assert(!JSON.stringify(body).includes(allowedUser.email));
  });

  await check('integration and document APIs reject anonymous access without side effects', async () => {
    await withPage(appOrigin, async (page, context) => {
      for (const path of ['/api/whatsapp/status','/api/sync','/api/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/delivery-order','/api/payments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/proof']) {
        const response=await context.request.get(path);
        assert.equal(response.status(),401,path);assert.match(response.headers()['cache-control'],/no-store/);
      }
      const upload=await context.request.post('/api/branding/logo');assert.equal(upload.status(),401);
      const crossOrigin=await context.request.post('/api/sync',{headers:{Origin:'https://untrusted.example'}});assert.equal(crossOrigin.status(),403);
    });
  });
  await check('bad credentials return a generic error without setting a valid session', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page, allowedUser.email, '/pesanan', 'incorrect-password');
      await page.getByText('Email atau password tidak sesuai.', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      const response = await sessionResponse(page);
      assert.equal(response.status, 401);
    });
  });

  await check('an authenticated account outside the database binding cannot enter the app', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page, unboundUser.email);
      await page.getByText('Akun ini tidak memiliki akses Laiora.', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      const response = await sessionResponse(page);
      assert([401, 403].includes(response.status));
      await page.goto('/pengiriman');
      await waitForPath(page, '/login');
    });
  });

  await check('the bound account returns to the requested division and accesses all division pages', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page, allowedUser.email, '/pesanan');
      await waitForPath(page, '/pesanan');
      for (const path of protectedPaths) {
        await page.goto(path);
        await waitForPath(page, path);
        await page.getByRole('button', { name: 'Keluar', exact: true }).waitFor();
        assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
      }
      await page.goto('/');
      await waitForPath(page, '/dashboard');
      await page.getByRole('button', { name: 'Keluar', exact: true }).waitFor();
      const response = await sessionResponse(page);
      assert.equal(response.status, 200);
      assert.match(response.cacheControl || '', /no-store/i);
      assert.match(response.cacheControl || '', /private/i);
      const serialized = JSON.stringify(response.body);
      assert(serialized.includes(allowedUser.id), 'The API should identify the validated user.');
      assert(!serialized.includes('access_token') && !serialized.includes('refresh_token'));
    });
  });

  await check('external, protocol-relative, backslash and unlisted return paths fall back to dashboard', async () => {
    for (const target of ['https://outside.invalid/steal', '//outside.invalid/steal', '/\\outside.invalid/steal', '/api/session', '/dashboard?next=https://outside.invalid']) {
      await withPage(appOrigin, async (page) => {
        await login(page, allowedUser.email, target);
        await waitForPath(page, '/dashboard');
        assert.equal(new URL(page.url()).origin, appOrigin);
        assert.equal(new URL(page.url()).search, '');
      });
    }
  });

  await check('a forged but well-formed session cookie does not pass server verification', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page);
      await waitForPath(page, '/dashboard');
      await rewriteSession(context, (session) => ({ ...session, access_token: jwt(allowedUser) }));
      const response = await sessionResponse(page);
      assert.equal(response.status, 401);
      await page.goto('/pesanan');
      await waitForPath(page, '/login');
    });
  });

  await check('an expired access token refreshes and persists the refreshed session cookie', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page);
      await waitForPath(page, '/dashboard');
      const refreshCount = calls.filter((call) => call.grant === 'refresh_token').length;
      await rewriteSession(context, (session) => {
        const expiresAt = Math.floor(Date.now() / 1000) - 120;
        const accessToken = jwt(allowedUser, expiresAt);
        tokens.set(accessToken, { user: allowedUser, expiresAt });
        return { ...session, access_token: accessToken, expires_at: expiresAt, expires_in: -120 };
      });
      await page.goto('/produksi');
      await waitForPath(page, '/produksi');
      assert(calls.filter((call) => call.grant === 'refresh_token').length > refreshCount);
      const beforeSecondRequest = calls.filter((call) => call.grant === 'refresh_token').length;
      const response = await sessionResponse(page);
      assert.equal(response.status, 200);
      assert.equal(calls.filter((call) => call.grant === 'refresh_token').length, beforeSecondRequest,
        'The browser must retain the refreshed cookie rather than repeatedly use an expired refresh token.');
    });
  });

  await check('authorization database failures deny access even with a valid Auth session', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page);
      await waitForPath(page, '/dashboard');
      rpcUnavailable = true;
      try {
        const response = await sessionResponse(page);
        assert([401, 403, 503].includes(response.status));
        const body = JSON.stringify(response.body);
        assert(!body.includes(allowedUser.email));
        await page.goto('/pembayaran');
        await waitForPath(page, '/login');
      } finally { rpcUnavailable = false; }
    });
  });

  await check('logout posts a server action, removes the session and denies subsequent navigation', async () => {
    await withPage(appOrigin, async (page, context) => {
      await login(page);
      await waitForPath(page, '/dashboard');
      const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).origin === appOrigin);
      await page.getByRole('button', { name: 'Keluar', exact: true }).click();
      await requestPromise;
      await waitForPath(page, '/login');
      const response = await sessionResponse(page);
      assert.equal(response.status, 401);
      await page.goto('/integrasi');
      await waitForPath(page, '/login');
    });
  });

  await check('browser and fake API requests remain local without runtime errors', async () => {
    assert.deepEqual(unexpectedBrowserRequests, []);
    assert.deepEqual(unexpectedApiCalls, []);
    assert.deepEqual(pageErrors, []);
    const unexpectedErrors = consoleErrors.filter((message) => !/^Failed to load resource: the server responded with a status of (401|403|503)\b/.test(message));
    assert.deepEqual(unexpectedErrors, []);
    assert(calls.some((call) => call.path === '/auth/v1/user'), 'Sessions must be verified by the fake Auth server.');
    assert(calls.some((call) => call.path === '/rest/v1/rpc/laiora_has_access'));
  });
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    await Promise.race([once(app, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  await new Promise((resolve) => fakeSupabase.close(resolve));
}

if (failure) {
  console.error(failure);
  if (appLog) console.error(`Next server output:\n${appLog}`);
  process.exitCode = 1;
} else {
  process.stdout.write(`1..${passed}\n`);
}
