import { NextResponse } from 'next/server';
import { accountAccess } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await accountAccess();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (access.status !== 'authorized') {
    const status = access.status === 'signed_out' ? 401 : access.status === 'forbidden' ? 403 : 503;
    return NextResponse.json({ error: 'Access unavailable' }, { status, headers });
  }
  return NextResponse.json({ user: { id: access.user.id, email: access.user.email } }, { headers });
}
