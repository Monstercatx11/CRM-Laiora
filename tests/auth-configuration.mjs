import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// A separate production process proves missing deployment settings fail closed.
const repository = fileURLToPath(new URL('..', import.meta.url));
const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const environment = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' };
// Empty private runtime values override embedded/local public project settings.
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete environment[name];
let logs = '';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: repository, env: environment, stdio: ['ignore','pipe','pipe'] });
server.stdout.on('data', chunk => logs += chunk);
server.stderr.on('data', chunk => logs += chunk);
const origin = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Next exited before startup');
    try {
      if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready=true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready,'Production app did not start');
  const login = await (await fetch(`${origin}/login`)).text();
  assert(login.includes('Login belum dikonfigurasi.'));
  assert.match(login, /<button[^>]*disabled/);
  for (const path of ['/dashboard','/pesanan','/tracking-chat','/produksi','/pengiriman','/pembayaran','/integrasi']) {
    const response = await fetch(origin+path, { redirect:'manual' });
    assert.equal(response.status,307);
    const destination = new URL(response.headers.get('location'),origin);
    assert.equal(destination.pathname,'/login');
    assert.equal(destination.searchParams.get('error'),'configuration');
    assert.equal(destination.searchParams.get('next'),path);
  }
  const api = await fetch(`${origin}/api/session`);
  assert.equal(api.status,503);
  assert.match(api.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await api.json(),{error:'Access unavailable'});
  console.log('PASS missing hosted configuration: login disabled, all seven routes closed, API 503/no-store.');
} catch(error) {
  console.error(logs);
  throw error;
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null) {
    await Promise.race([once(server,'exit'),new Promise(resolve=>{const timeout=setTimeout(()=>{server.kill('SIGKILL');resolve()},3000);timeout.unref()})]);
  }
}
