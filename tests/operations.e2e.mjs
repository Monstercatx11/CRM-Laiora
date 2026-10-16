import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Browser contract tests use a deterministic local Auth/PostgREST fixture.
// This deliberately does NOT claim to test PostgreSQL, RLS, or real integrations;
// supabase/tests validates actual migrations/transactions separately.
const repository = fileURLToPath(new URL('..', import.meta.url));
const qaDirectory = process.env.LAIORA_OPERATIONS_QA_DIR || '/tmp/laiora-ops-qa';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'operations@example.test' };
const productId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const contactId = '55555555-5555-4555-8555-555555555555';
const tokens = new Map();
const refreshTokens = new Map();
const orders = new Map();
const rpcCalls = [];
const unexpectedApiCalls = [];
const unexpectedBrowserRequests = [];
const pageErrors = [];
const consoleErrors = [];
const products = [{ id: productId, sku: 'BROWNIES-ORI-REG', name: 'Brownies Original', size: 'Regular', active: true, product_prices: [{ id: randomUUID(), product_id: productId, unit_price: 105000, effective_from: '2026-01-01' }] }];
let settings = { singleton: true, business_name: 'Laiora Boulangerie', timezone: 'Asia/Jakarta', whatsapp_phone: '', bank_name: 'BCA', bank_account: '0000000000', bank_holder: 'Local Test', greeting_card_price: 5000, logo_path: null };
let opportunities = [];
let lastValue = 45;
let failOrders = false;
let failNextPayment = false;
let fakeOrigin;
let app;
let appLog = '';
let browser;
let passed = 0;
let failure;
let orderId;
const now = () => new Date().toISOString();
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const calendarPart = (type) => calendar.find(p => p.type === type).value;
const deliveryDate = `${calendarPart('year')}-${calendarPart('month')}-${calendarPart('day')}`;
const orderPrefix = calendarPart('year').slice(-2);
function respond(response, status, body, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  response.end(body === undefined ? '' : JSON.stringify(body));
}
function sessionFor() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, iat: Math.floor(Date.now() / 1000), exp: expiresAt, iss: `${fakeOrigin}/auth/v1`, session_id: randomUUID(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aal: 'aal1' })).toString('base64url');
  const signature = createHmac('sha256', 'operations-local-signing-key').update(`${header}.${payload}`).digest('base64url');
  const accessToken = `${header}.${payload}.${signature}`;
  const refreshToken = randomUUID();
  tokens.set(accessToken, expiresAt); refreshTokens.set(refreshToken, user);
  return { access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: authUser() };
}
function authUser() { return { ...user, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] }; }
function revision(order, before) {
  order.revision_no++;
  order.updated_at = now();
  const after = structuredClone({ ...order, order_revisions: undefined, payments: undefined });
  order.order_revisions.push({ id: randomUUID(), order_id: order.id, revision_no: order.revision_no, changed_at: now(), actor_id: user.id, before_data: before, after_data: after });
}
function requireCurrent(id, expected) {
  const order = orders.get(id);
  if (!order) throw Object.assign(new Error('Order not found'), { code: 'P0001' });
  if (expected !== order.revision_no) throw Object.assign(new Error('stale revision'), { code: '40001' });
  return order;
}
function recalculate(order) {
  order.product_quantity = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  order.product_total = order.order_items.reduce((sum, item) => sum + item.line_total, 0);
  order.card_total = order.greeting_card_choice === 'yes' ? order.greeting_card_qty * order.card_unit_price : 0;
  order.subtotal = order.product_total + order.card_total;
  order.grand_total = order.shipping_fee === null ? null : order.subtotal + order.shipping_fee;
  order.completeness = order.sender_name && order.sender_phone && order.recipient_name && order.recipient_phone && order.delivery_date && order.shipping_method && order.shipping_fee !== null && (order.address || order.shipping_method === 'Pick Up') ? 'complete' : 'incomplete';
}
function mockRpc(name, body) {
  rpcCalls.push({ name, body: structuredClone(body) });
  if (name === 'laiora_has_access') return true;
  if (name === 'laiora_get_sequence') return [{ year: Number(calendarPart('year')), last_value: lastValue }];
  if (name === 'laiora_sync_status') return { pending: 0, failed: 0, last_completed: null };
  if (name === 'laiora_save_order') {
    const existing = body.p_order_id ? requireCurrent(body.p_order_id, body.p_expected_revision) : null;
    if (existing?.state === 'cancelled') throw new Error('cancelled order cannot be edited');
    const previous = existing ? structuredClone(existing) : null;
    const order = existing ?? { id: randomUUID(), order_no: null, state: 'draft', revision_no: -1, created_at: now(), production_status: 'unscheduled', fulfillment_status: 'waiting', order_items: [], payments: [], order_revisions: [], card_unit_price: settings.greeting_card_price };
    const oldItems = order.order_items;
    Object.assign(order, body.p_order);
    order.order_items = body.p_items.map(input => {
      const product = products.find(item => item.id === input.product_id);
      if (!product) throw new Error('product not found');
      const retained = oldItems.find(item => item.id === input.id && item.product_id === input.product_id);
      const price = retained?.unit_price ?? product.product_prices.at(-1).unit_price;
      return { id: input.id ?? randomUUID(), order_id: order.id, product_id: product.id, product_name: product.name, size: product.size, quantity: input.quantity, unit_price: price, line_total: input.quantity * price, cutting_note: input.cutting_note || null, item_note: input.item_note || null };
    });
    if (body.p_confirm) {
      if (!order.delivery_date || !order.order_items.length) throw new Error('confirmed order requires date and product');
      order.state = 'confirmed';
      if (!order.order_no) order.order_no = `${orderPrefix}-${String(++lastValue).padStart(4, '0')}`;
    }
    recalculate(order); revision(order, previous); orders.set(order.id, order);
    return order.id;
  }
  if (name === 'laiora_set_status') {
    const order = requireCurrent(body.p_order_id, body.p_expected_revision), previous = structuredClone(order);
    if (body.p_cancel) order.state = 'cancelled';
    if (body.p_production) order.production_status = body.p_production;
    if (body.p_fulfillment) order.fulfillment_status = body.p_fulfillment;
    revision(order, previous); return order.id;
  }
  if (name === 'laiora_record_payment') {
    if (failNextPayment) { failNextPayment = false; throw Object.assign(new Error('Synthetic unavailable database'), { code: 'PGRST000' }); }
    const order = orders.get(body.p_order_id);
    if (!order || order.state !== 'confirmed') throw new Error('payment requires confirmed order');
    if (!order.payments.some(payment => payment.request_id === body.p_request_id)) {
      order.payments.push({ id: randomUUID(), request_id: body.p_request_id, order_id: order.id, amount: body.p_amount, paid_at: body.p_paid_at, reference: body.p_reference, verification_status: 'confirmed', verified_at: now(), verified_by: user.id, proof_path: null, created_at: now() });
    }
    return order.payments.at(-1).id;
  }
  if (name === 'laiora_update_settings') { settings = { ...settings, ...body.p_settings }; return true; }
  if (name === 'laiora_initialize_sequence') { lastValue = body.p_last_value; return true; }
  if (name === 'laiora_save_product') {
    const product = products.find(item => item.id === body.p_product_id) ?? { id: randomUUID(), product_prices: [] };
    Object.assign(product, { name: body.p_name, sku: body.p_sku, size: body.p_size, active: body.p_active });
    product.product_prices.push({ id: randomUUID(), product_id: product.id, unit_price: body.p_price, effective_from: body.p_effective_from });
    if (!products.includes(product)) products.push(product); return product.id;
  }
  if (name === 'laiora_manage_opportunity') {
    const opportunity = opportunities.find(item => item.id === body.p_opportunity_id) ?? { id: randomUUID(), conversation_id: body.p_conversation_id, created_at: now() };
    Object.assign(opportunity, { title: body.p_title, follow_up: body.p_follow_up, opportunity_product_labels: body.p_product_ids.map(product_id => ({ product_id, source: 'manual' })), opportunity_order_links: body.p_order_id ? [{ order_id: body.p_order_id, orders: orders.get(body.p_order_id) }] : [] });
    if (!opportunities.includes(opportunity)) opportunities.push(opportunity); return opportunity.id;
  }
  if (name === 'laiora_retry_sync') return 0;
  throw Object.assign(new Error(`Unexpected mock RPC ${name}`), { unexpected: true });
}
const fakeSupabase = createServer(async (request, response) => {
  const url = new URL(request.url, fakeOrigin);
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { respond(response, 400, { message: 'Invalid JSON' }); return; }
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const valid = (tokens.get(bearer) ?? 0) > Math.floor(Date.now() / 1000);
  if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if ((grant === 'password' && body.email === user.email && body.password === 'local-password') || (grant === 'refresh_token' && refreshTokens.has(body.refresh_token))) respond(response, 200, sessionFor());
    else respond(response, 400, { message: 'Invalid login credentials', error_code: 'invalid_credentials' });
    return;
  }
  if (url.pathname === '/auth/v1/user') { respond(response, valid ? 200 : 401, valid ? authUser() : { code: 'bad_jwt', message: 'Invalid JWT' }); return; }
  if (url.pathname === '/auth/v1/logout') { tokens.delete(bearer); respond(response, 204); return; }
  if (url.pathname === '/auth/v1/.well-known/jwks.json') { respond(response, 200, { keys: [] }); return; }
  if (!valid) { respond(response, 401, { code: 'PGRST301', message: 'Invalid JWT' }); return; }
  if (url.pathname.startsWith('/rest/v1/rpc/') && request.method === 'POST') {
    try { respond(response, 200, mockRpc(url.pathname.split('/').at(-1), body)); }
    catch (error) {
      if (error.unexpected) unexpectedApiCalls.push({ path: url.pathname, method: request.method });
      respond(response, 400, { code: error.code ?? 'P0001', message: error.message });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/orders') {
    if (failOrders) { respond(response, 400, { code: '42P01', message: 'orders table unavailable' }); return; }
    let rows = Array.from(orders.values());
    for (const key of ['id', 'state', 'delivery_date']) {
      const filter = url.searchParams.get(key); if (filter?.startsWith('eq.')) rows = rows.filter(row => row[key] === filter.slice(3));
    }
    const or = url.searchParams.get('or');
    if (or) { const q = or.match(/ilike\.%([^%]+)%/)?.[1]?.toLowerCase(); if (q) rows = rows.filter(row => [row.order_no, row.sender_name, row.recipient_name, row.sender_phone, row.recipient_phone].join(' ').toLowerCase().includes(q)); }
    const count = rows.length;
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000);
    rows = rows.slice(offset, offset + limit);
    const wantsOne = request.headers.accept?.includes('vnd.pgrst.object+json');
    respond(response, 200, wantsOne ? rows[0] ?? null : rows, { 'Content-Range': count ? `${offset}-${Math.max(offset, offset + rows.length - 1)}/${count}` : '*/0' }); return;
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/products') { respond(response, 200, products); return; }
  if (request.method === 'GET' && url.pathname === '/rest/v1/app_settings') { respond(response, 200, settings); return; }
  if (request.method === 'GET' && url.pathname === '/rest/v1/conversations') { respond(response, 200, [{ id: conversationId, contact_id: contactId, account_ref: 'local-test', external_chat_id: 'local-test-chat', last_message_at: now(), contacts: { id: contactId, display_name: 'Pelanggan Uji', phone: '081211112222' } }]); return; }
  if (request.method === 'GET' && url.pathname === '/rest/v1/messages') { respond(response, 200, [{ id: randomUUID(), conversation_id: conversationId, external_message_id: 'test-inbound', direction: 'inbound', message_type: 'text', body: 'Mau pesan Brownies Original Regular untuk hari ini.', sent_at: now(), received_at: now() }]); return; }
  if (request.method === 'GET' && url.pathname === '/rest/v1/chat_opportunities') { respond(response, 200, opportunities); return; }
  unexpectedApiCalls.push({ path: url.pathname, method: request.method }); respond(response, 404, { message: 'Unexpected mock endpoint' });
});
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function freePort() { const probe = createServer(); const port = await listen(probe); await new Promise(resolve => probe.close(resolve)); return port; }
async function waitForApp(origin) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Next exited before readiness (exit ${app.exitCode})`);
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Production Next server did not become ready.');
}
async function check(name, test) { await test(); process.stdout.write(`ok ${++passed} - ${name}\n`); }
async function waitForPath(page, path) { await page.waitForURL(url => url.pathname === path, { timeout: 15_000 }); }
async function see(page, text) { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 15_000 }); }
async function currentOrder() { assert(orderId && orders.has(orderId)); return orders.get(orderId); }
try {
  fakeOrigin = `http://127.0.0.1:${await listen(fakeSupabase)}`;
  const appPort = await freePort(), appOrigin = `http://127.0.0.1:${appPort}`;
  const environment = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', SUPABASE_URL: fakeOrigin, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_operations_test', NEXT_PUBLIC_SUPABASE_URL: fakeOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_operations_test' };
  for (const name of Object.keys(environment)) if (/SUPABASE_(?:SECRET|SERVICE_ROLE|ACCESS_TOKEN)|DATABASE_URL|WHATSAPP_|GOOGLE_(?:SERVICE|SPREADSHEET)|CRON_SECRET/.test(name)) delete environment[name];
  Object.assign(environment, { SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ACCESS_TOKEN: '', DATABASE_URL: '', WHATSAPP_BRIDGE_URL: '', WHATSAPP_BRIDGE_TOKEN: '', GOOGLE_SERVICE_ACCOUNT_JSON: '', GOOGLE_SPREADSHEET_ID: '' });
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: repository, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = chunk => { appLog = (appLog + chunk).slice(-12000); }; app.stdout.on('data', log); app.stderr.on('data', log);
  await waitForApp(appOrigin);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await mkdir(qaDirectory, { recursive: true });
  const context = await browser.newContext({ baseURL: appOrigin, viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && ![appOrigin, fakeOrigin].includes(url.origin)) { unexpectedBrowserRequests.push(url.origin + url.pathname); return route.abort(); } return route.continue(); });
  const page = await context.newPage(); page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(15000); page.on('pageerror', error => pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await check('bound account logs in and sees real empty operational state', async () => {
    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill('local-password'); await page.getByRole('button', { name: 'Masuk', exact: true }).click(); await waitForPath(page, '/dashboard');
    await see(page, 'Belum ada PO aktif dengan jadwal pengiriman. Mulai dari membuat draft lalu konfirmasi order.');
    await page.goto('/pesanan'); assert.equal(orders.size, 0); await page.getByRole('link', { name: '+ Pesanan baru', exact: true }).waitFor();
  });
  await check('create draft preserves physical quantity and does not allocate a PO number', async () => {
    await page.goto('/pesanan/baru');
    await page.getByLabel('Nama pemesan', { exact: true }).fill('PELANGGAN UJI');
    await page.getByLabel('Nomor HP pemesan', { exact: false }).fill('+6281211112222');
    await page.getByRole('button', { name: 'Samakan dengan pemesan', exact: true }).click();
    await page.getByRole('button', { name: '+ Tambah produk', exact: true }).click();
    await page.getByLabel('Produk 1', { exact: true }).selectOption(productId);
    await page.getByLabel('Jumlah produk 1', { exact: true }).fill('1');
    await page.getByLabel('Instruksi potong', { exact: true }).fill('Potong 9');
    await page.getByRole('button', { name: 'Simpan draft', exact: true }).click();
    await page.waitForURL(url => /^\/pesanan\/[0-9a-f-]{36}$/.test(url.pathname)); orderId = new URL(page.url()).pathname.split('/').at(-1);
    const order = await currentOrder(); assert.equal(order.state, 'draft'); assert.equal(order.order_no, null); assert.equal(order.product_quantity, 1); assert.equal(order.order_items[0].cutting_note, 'Potong 9'); assert.equal(order.sender_phone, '081211112222');
  });
  await check('confirm draft allocates number and leaves unknown shipping total unfinalized', async () => {
    await page.goto(`/pesanan/${orderId}/edit`); await page.getByLabel('Tanggal kirim / ambil', { exact: false }).fill(deliveryDate); await page.getByLabel('Metode pengiriman', { exact: true }).fill('Grab Instant'); await page.getByLabel('Alamat kirim lengkap', { exact: false }).fill('Jalan Uji No. 1, RT 01/RW 02'); await page.getByRole('button', { name: 'Konfirmasi PO', exact: true }).click(); await waitForPath(page, `/pesanan/${orderId}`);
    const order = await currentOrder(); assert.equal(order.state, 'confirmed'); assert.equal(order.order_no, `${orderPrefix}-0046`); assert.equal(order.shipping_fee, null); assert.equal(order.grand_total, null);
    await page.goto('/pembayaran?status=unknown'); await see(page, 'Tagihan belum final'); assert.equal(await page.locator('tbody .badge').filter({ hasText: /^Lunas$/ }).count(), 0);
  });
  await check('revise order keeps PO number, adds cards separately, and accepts explicitly free shipping', async () => {
    const previous = (await currentOrder()).revision_no;
    await page.goto(`/pesanan/${orderId}/edit`); await page.getByLabel('Jumlah produk 1', { exact: true }).fill('2'); await page.getByLabel('Ongkir (Rp)', { exact: false }).fill('0'); await page.getByLabel('Pilihan kartu', { exact: false }).selectOption('yes'); await page.getByLabel('Jumlah kartu', { exact: true }).fill('1'); await page.getByLabel('From', { exact: true }).fill('Pengirim'); await page.getByLabel('To', { exact: true }).fill('Penerima'); await page.getByLabel('Message', { exact: true }).fill('Selamat menikmati.'); await page.getByRole('button', { name: 'Simpan revisi', exact: true }).click(); await waitForPath(page, `/pesanan/${orderId}`);
    const order = await currentOrder(); assert.equal(order.order_no, `${orderPrefix}-0046`); assert.equal(order.product_quantity, 2); assert.equal(order.greeting_card_qty, 1); assert.equal(order.grand_total, 215000); assert(order.revision_no > previous); assert(order.order_revisions.length >= 3);
    await page.goto(`/produksi?date=${deliveryDate}&status=all`); await see(page, 'Brownies Original'); await see(page, 'Selamat menikmati.');
  });
  await check('production and shipping controls update only the selected status', async () => {
    await page.goto(`/produksi?date=${deliveryDate}&status=all`); await page.getByLabel('Status baru', { exact: true }).selectOption('in_progress'); await page.getByRole('button', { name: 'Simpan status', exact: true }).click(); await see(page, 'Status diperbarui.'); assert.equal((await currentOrder()).production_status, 'in_progress'); assert.equal((await currentOrder()).fulfillment_status, 'waiting');
    await page.goto(`/pengiriman?date=${deliveryDate}&status=all`); await page.getByLabel('Status baru', { exact: true }).selectOption('in_transit'); await page.getByRole('button', { name: 'Simpan status', exact: true }).click(); await see(page, 'Status diperbarui.'); assert.equal((await currentOrder()).fulfillment_status, 'in_transit'); assert.equal((await currentOrder()).production_status, 'in_progress'); assert.equal((await currentOrder()).payments.length, 0);
  });
  await check('payments distinguish DP and Lunas without duplicating a transaction', async () => {
    await page.goto(`/pesanan/${orderId}`); await page.waitForFunction(() => !!document.querySelector('input[name=request_id]')?.value); const initialRequestId = await page.locator('input[name=request_id]').inputValue(); failNextPayment = true; await page.getByLabel('Nominal diterima (Rp)', { exact: true }).fill('100000'); await page.getByLabel('Saya sudah memeriksa dan mengonfirmasi pembayaran ini.', { exact: true }).check(); await page.getByRole('button', { name: 'Catat pembayaran terkonfirmasi', exact: true }).click(); await see(page, 'Data belum dapat diproses. Periksa koneksi Supabase dan migrasi database.'); assert.equal(await page.locator('input[name=request_id]').inputValue(), initialRequestId); assert.equal((await currentOrder()).payments.length, 0); await page.getByLabel('Nominal diterima (Rp)', { exact: true }).fill('100000'); await page.getByLabel('Referensi / catatan bukti', { exact: true }).fill('TEST-DP'); await page.getByLabel('Saya sudah memeriksa dan mengonfirmasi pembayaran ini.', { exact: true }).check(); await page.getByRole('button', { name: 'Catat pembayaran terkonfirmasi', exact: true }).click(); await see(page, 'Pembayaran terkonfirmasi dicatat.'); await see(page, 'DP'); assert.equal((await currentOrder()).payments.length, 1);
    await page.getByRole('button', { name: 'Catat pembayaran lain', exact: true }).click(); await page.getByRole('button', { name: 'Catat pembayaran terkonfirmasi', exact: true }).waitFor(); assert.equal(await page.getByLabel('Nominal diterima (Rp)', { exact: true }).inputValue(), ''); assert.equal(await page.getByLabel('Referensi / catatan bukti', { exact: true }).inputValue(), ''); assert.equal(await page.getByLabel('Saya sudah memeriksa dan mengonfirmasi pembayaran ini.', { exact: true }).isChecked(), false); await page.waitForFunction(() => !!document.querySelector('input[name=request_id]')?.value); const nextRequestId = await page.locator('input[name=request_id]').inputValue(); assert.notEqual(nextRequestId, initialRequestId); await page.getByLabel('Nominal diterima (Rp)', { exact: true }).fill('115000'); await page.getByLabel('Referensi / catatan bukti', { exact: true }).fill('TEST-LUNAS'); await page.getByLabel('Saya sudah memeriksa dan mengonfirmasi pembayaran ini.', { exact: true }).check(); await page.getByRole('button', { name: 'Catat pembayaran terkonfirmasi', exact: true }).click(); await see(page, 'Pembayaran terkonfirmasi dicatat.'); await see(page, 'Lunas'); assert.equal((await currentOrder()).payments.length, 2); assert.equal((await currentOrder()).payments.reduce((sum, payment) => sum + payment.amount, 0), 215000);
    await page.screenshot({ path: `${qaDirectory}/order-detail-desktop.png`, fullPage: true });
    await page.goto('/pembayaran?status=paid'); await page.getByRole('link', { name: `${orderPrefix}-0046`, exact: true }).waitFor();
  });
  await check('stale revision is surfaced without overwriting another session', async () => {
    await page.goto(`/pesanan/${orderId}/edit`); const order = await currentOrder(); order.revision_no++;
    await page.getByLabel('Catatan operasional', { exact: true }).fill('This stale edit must not save'); await page.getByRole('button', { name: 'Simpan revisi', exact: true }).click(); await see(page, 'Order telah berubah di sesi lain. Muat ulang halaman sebelum menyimpan.'); assert.notEqual(order.operational_notes, 'This stale edit must not save');
  });
  await check('business settings save normalizes the WhatsApp number and exposes its link', async () => {
    await page.goto('/pengaturan'); await page.getByLabel('Nama bisnis', { exact: true }).fill('Laiora Uji Browser'); await page.getByLabel('Nomor WhatsApp bisnis', { exact: true }).fill('+6281233334444'); await page.getByRole('button', { name: 'Simpan pengaturan bisnis', exact: true }).click(); await see(page, 'Pengaturan bisnis disimpan.'); assert.equal(settings.business_name, 'Laiora Uji Browser'); assert.equal(settings.whatsapp_phone, '081233334444');
    await page.goto('/integrasi'); await page.getByRole('link', { name: 'Buka link WhatsApp bisnis ↗', exact: true }).waitFor(); assert.equal(await page.getByRole('link', { name: 'Buka link WhatsApp bisnis ↗', exact: true }).getAttribute('href'), 'https://wa.me/6281233334444'); await see(page, 'Server WhatsApp belum dipasang'); assert.equal(await page.getByRole('button', { name: 'Hubungkan WhatsApp', exact: true }).isDisabled(), true);
  });
  await check('catalog price changes apply to new orders and preserve stored item prices', async () => {
    await page.goto('/katalog'); const row = page.getByRole('row').filter({ has: page.getByText('Brownies Original', { exact: true }) }); await row.locator('summary').click(); await row.getByLabel('Harga satuan (Rp)', { exact: true }).fill('120000'); await row.getByRole('button', { name: 'Simpan produk / harga', exact: true }).click(); await see(page, 'Produk dan harga disimpan. Harga order lama tetap.'); assert.equal(products[0].product_prices.at(-1).unit_price, 120000); assert.equal((await currentOrder()).order_items[0].unit_price, 105000); assert.equal((await currentOrder()).grand_total, 215000);
  });
  await check('tracking chat labels a specific opportunity and links its confirmed PO', async () => {
    await page.goto('/tracking-chat'); await see(page, 'Mau pesan Brownies Original Regular untuk hari ini.'); await page.locator('summary').filter({ hasText: '＋ Tambah peluang baru' }).click(); await page.getByLabel('Nama peluang / keterangan', { exact: true }).fill('Brownies untuk pelanggan uji'); await page.getByLabel('Brownies Original (Regular)', { exact: true }).check(); await page.getByLabel('Hubungkan order tersimpan', { exact: false }).selectOption(orderId); await page.getByRole('button', { name: 'Buat peluang order', exact: true }).click(); await see(page, 'Peluang dan label diperbarui.'); await page.locator('.opportunity-card .badge').filter({ hasText: 'Sudah PO' }).waitFor(); assert.equal(opportunities.length, 1); assert.equal(opportunities[0].opportunity_product_labels[0].product_id, productId); assert.equal(opportunities[0].opportunity_order_links[0].order_id, orderId);
    await page.getByRole('link', { name: 'Buat draft PO untuk peluang ini', exact: true }).click(); await waitForPath(page, '/pesanan/baru'); assert.equal(await page.getByLabel('Nama pemesan', { exact: true }).inputValue(), 'Pelanggan Uji'); assert.match(await page.locator('textarea[name=raw_form]').inputValue(), /Mau pesan Brownies Original/); assert(!new URL(page.url()).searchParams.has('sender_phone'));
    await page.goto(`/tracking-chat?po=yes&product=${productId}`); await see(page, 'Brownies untuk pelanggan uji');
  });
  await check('desktop and mobile operational pages remain usable without document overflow', async () => {
    await page.goto('/dashboard'); await page.screenshot({ path: `${qaDirectory}/dashboard-desktop.png`, fullPage: true });
    await page.goto('/pengaturan'); await page.screenshot({ path: `${qaDirectory}/settings-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, name] of [['/pesanan/baru', 'new-order-mobile'], ['/tracking-chat', 'tracking-chat-mobile'], ['/produksi?status=all', 'production-mobile']]) {
      await page.goto(route); await page.screenshot({ path: `${qaDirectory}/${name}.png`, fullPage: true });
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth }));
      assert(dimensions.width <= dimensions.viewport + 1, `${route} overflows mobile viewport: ${JSON.stringify(dimensions)}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('Delivery Order renders 200dpi and requires visual approval before download', async () => {
    const fixture = await PDFDocument.create();
    const font = await fixture.embedFont(StandardFonts.Helvetica);
    fixture.addPage([283.4646,425.1969]).drawText('TEST ONLY - visual preview', {x:28,y:390,size:12,font});
    const pdfBytes = Buffer.from(await fixture.save());
    const route = `**/api/orders/${orderId}/delivery-order`;
    await page.route(route, intercepted => intercepted.fulfill({status:200,contentType:'application/pdf',body:pdfBytes}));
    let downloads=0; const countDownload=()=>downloads++;page.on('download',countDownload);
    try {
      await page.goto(`/pesanan/${orderId}`);
      await page.getByRole('button',{name:'Unduh Delivery Order',exact:true}).click();
      await page.getByText('Pratinjau 200 dpi siap diperiksa.',{exact:true}).waitFor({timeout:20000});
      const dimensions=await page.locator('dialog canvas').evaluate(canvas=>({width:canvas.width,height:canvas.height}));
      assert.deepEqual(dimensions,{width:788,height:1182});
      const approve=page.getByRole('button',{name:'Unduh PDF setelah diperiksa',exact:true});
      assert.equal(await approve.isDisabled(),true);assert.equal(downloads,0);
      await page.getByLabel('Saya sudah memeriksa logo, jarak, outline, dan isi dokumen.',{exact:true}).check();
      const downloaded=page.waitForEvent('download');await approve.click();const file=await downloaded;
      assert.equal(downloads,1);assert.match(file.suggestedFilename(),/Delivery_Order/);
      await file.saveAs(`${qaDirectory}/TEST_ONLY_preview.pdf`);
    } finally { page.off('download',countDownload);await page.unroute(route); }
  });
  await check('cancellation preserves payment history and removes active production work', async () => {
    await page.goto(`/pesanan/${orderId}`); await page.getByRole('button', { name: 'Batalkan pesanan', exact: true }).click(); await page.getByLabel('Saya mengonfirmasi pembatalan pesanan ini.', { exact: true }).check(); await page.getByRole('button', { name: 'Ya, batalkan pesanan', exact: true }).click(); await see(page, 'Pesanan dibatalkan. Data, nomor, riwayat, dan pembayaran tetap tersimpan untuk pemeriksaan.'); assert.equal((await currentOrder()).state, 'cancelled'); assert.equal((await currentOrder()).payments.length, 2); assert.equal((await currentOrder()).order_no, `${orderPrefix}-0046`);
    await page.goto('/produksi'); await page.getByRole('heading', { name: 'Belum ada order yang sesuai', exact: true }).waitFor();
    await page.goto('/pembayaran?status=cancelled'); await see(page, 'Order batal memiliki pembayaran. Penanganan pengembalian perlu diperiksa manual.');
  });
  await check('missing migration displays explicit error instead of empty statistics', async () => {
    failOrders = true; try { await page.goto('/dashboard'); await page.getByRole('alert').filter({ hasText: 'Database perlu diperbarui.' }).waitFor(); assert.equal(await page.locator('.stats').count(), 0); } finally { failOrders = false; }
  });
  await check('browser contract suite remains local with no unknown endpoints or runtime errors', async () => {
    assert.deepEqual(unexpectedApiCalls, []); assert.deepEqual(unexpectedBrowserRequests, []); assert.deepEqual(pageErrors, []);
    const unexpected = consoleErrors.filter(message => !/^Failed to load resource: the server responded with a status of (400|401|403|422|503)\b/.test(message)); assert.deepEqual(unexpected, []);
    for (const name of ['laiora_save_order', 'laiora_set_status', 'laiora_record_payment', 'laiora_update_settings', 'laiora_save_product', 'laiora_manage_opportunity']) assert(rpcCalls.some(call => call.name === name), `Missing actual server action RPC call ${name}`);
  });
  await context.close();
} catch (error) { failure = error; const active=browser?.contexts()[0]?.pages()[0];if(active){await active.screenshot({path:`${qaDirectory}/failure.png`,fullPage:true}).catch(()=>{});console.error('Failure route:',active.url());} }
finally {
  await browser?.close(); if (app && app.exitCode === null) { app.kill('SIGTERM'); await Promise.race([once(app, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]); if (app.exitCode === null) app.kill('SIGKILL'); }
  await new Promise(resolve => fakeSupabase.close(resolve));
}
if (failure) { console.error(failure); if (appLog) console.error(`Next server output:\n${appLog}`); console.error(`Unexpected API calls: ${JSON.stringify(unexpectedApiCalls)}`); process.exitCode = 1; }
else process.stdout.write(`1..${passed}\n`);
