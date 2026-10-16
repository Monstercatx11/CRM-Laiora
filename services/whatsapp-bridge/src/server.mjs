import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest();

export function createBridgeServer(controller, token) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('WHATSAPP_BRIDGE_TOKEN must contain at least 32 characters');
  const expected = digest(`Bearer ${token}`);
  return createServer(async (request, response) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)); };
    // No CORS and no browser direct access. The authenticated Next.js server is the client.
    if (request.headers.origin) { reply(403, { error: 'forbidden' }); return; }
    const supplied = request.headers.authorization;
    if (typeof supplied !== 'string' || !timingSafeEqual(digest(supplied), expected)) { reply(401, { error: 'unauthorized' }); return; }
    const path = request.url?.split('?')[0];
    try {
      if (path === '/status' && request.method === 'GET') { reply(200, controller.status()); return; }
      if ((path === '/connect' || path === '/disconnect') && request.method === 'POST') {
        if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding']) { reply(400, { error: 'body_not_supported' }); return; }
        await controller[path.slice(1)]();
        reply(200, controller.status());
        return;
      }
      reply(['/connect', '/disconnect', '/status'].includes(path) ? 405 : 404, { error: 'unsupported_operation' });
    } catch { reply(503, { error: 'bridge_unavailable' }); }
  });
}
