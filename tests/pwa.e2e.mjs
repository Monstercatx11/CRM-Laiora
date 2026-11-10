import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const probe = createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, NODE_ENV: 'production', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser, output = '';
app.stdout.on('data', data => output += data); app.stderr.on('data', data => output += data);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(output);
    try { ready = (await fetch(`${origin}/login`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, output);
  const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, '/dashboard'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const response = await fetch(origin + icon.src); assert.equal(response.status, 200);
    const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    assert.equal(`${png.width}x${png.height}`, icon.sizes);
  }
  const worker = await fetch(`${origin}/sw.js`); assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('cache-control'), 'no-cache');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(`${origin}/login`);
  assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), '/manifest.webmanifest');
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'), 'yes');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  await context.setOffline(true);
  const response = await page.goto(`${origin}/dashboard`);
  assert.equal(response.status(), 503);
  await page.getByRole('heading', { name: 'Tidak ada koneksi' }).waitFor();
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  await context.setOffline(false); await page.getByRole('link', { name: 'Coba lagi' }).click();
  await page.waitForURL('**/login**');
  assert.deepEqual(await page.evaluate(() => caches.keys()), []);
  console.log('PASS manifest, PNG icons, iOS metadata, worker registration, offline fallback, reconnection and empty customer cache');
} finally {
  await browser?.close(); app.kill('SIGTERM');
  await Promise.race([once(app, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (app.exitCode === null) app.kill('SIGKILL');
}
