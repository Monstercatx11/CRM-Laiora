import { NextRequest, NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
import { whatsappRequest } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ action: string }> };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const supplied = new URL(origin);
    const url = new URL(request.url);
    // Forwarded values come from the deployment's ingress; browsers cannot set
    // these on a simple cross-site request. Never accept wildcard origins.
    const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || url.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.slice(0, -1);
    return ['http', 'https'].includes(protocol) && supplied.origin === `${protocol}://${host}`;
  } catch { return false; }
}
async function handle(request: NextRequest, context: Context, mutation: boolean) {
  const { action } = await context.params;
  if (!(mutation ? ['connect', 'disconnect'].includes(action) : action === 'status')) return NextResponse.json({ error: 'Metode tidak tersedia.' }, { status: 405, headers });
  if (mutation && !sameOrigin(request)) return NextResponse.json({ error: 'Permintaan berasal dari halaman yang berbeda.' }, { status: 403, headers });
  const access = await accountAccess();
  if (access.status !== 'authorized') return NextResponse.json({ error: 'Akses tidak tersedia.' }, { status: access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503, headers });
  const status = await whatsappRequest(action as 'status' | 'connect' | 'disconnect');
  return NextResponse.json(status, { status: status.state === 'unavailable' ? 503 : !status.configured && mutation ? 503 : 200, headers });
}
export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);
