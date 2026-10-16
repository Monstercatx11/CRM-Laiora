import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfig } from '@/lib/supabase/config';

// Refresh transport cookies here; page/API guards independently verify both
// Auth and the database binding. This layer is not the authorization boundary.
export async function proxy(request: NextRequest) {
  function nextResponse() {
    const headers = new Headers(request.headers);
    headers.set('x-laiora-pathname', request.nextUrl.pathname);
    headers.set('cookie', request.cookies.toString());
    const next = NextResponse.next({ request: { headers } });
    next.headers.set('Cache-Control', 'private, no-store');
    return next;
  }
  let response = nextResponse();
  const config = supabaseConfig();
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        // Forward refreshed cookies to Server Components as well as the browser.
        response = nextResponse();
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    // Downstream guards fail closed when Auth cannot be verified.
  }
  return response;
}
export const config = {
  matcher: ['/login', '/dashboard/:path*', '/pesanan/:path*', '/tracking-chat/:path*', '/produksi/:path*', '/pengiriman/:path*', '/pembayaran/:path*', '/integrasi/:path*', '/api/:path*'],
};
