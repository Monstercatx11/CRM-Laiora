'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseConfig } from '@/lib/supabase/config';
import { sessionClient } from '@/lib/supabase/server';
import { safeDestination } from '@/lib/navigation';
export type LoginState = { error: string };
export async function signIn(_previous: LoginState, form: FormData): Promise<LoginState> {
  const email = form.get('email');
  const password = form.get('password');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || email.length > 254 || password.length > 4096) {
    return { error: 'Isi email dan password Anda.' };
  }
  const supabase = await sessionClient(true);
  if (!supabase) return { error: 'Login belum dikonfigurasi. Hubungi pengelola aplikasi.' };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return { error: 'Email atau password tidak sesuai.' };
    const { data: allowed, error: accessError } = await supabase.rpc('laiora_has_access');
    if (accessError || allowed !== true) {
      await supabase.auth.signOut({ scope: 'local' });
      return { error: accessError ? 'Akses belum dapat diverifikasi. Coba lagi nanti.' : 'Akun ini tidak memiliki akses Laiora.' };
    }
  } catch {
    return { error: 'Login belum dapat diproses. Coba lagi nanti.' };
  }
  redirect(safeDestination(form.get('next')));
}

export async function signOut() {
  const supabase = await sessionClient(true);
  try {
    if (supabase) await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Local cookies are still removed below; no upstream error is exposed.
  } finally {
    // End this browser session even if refresh/revocation could not reach Auth.
    // Revocation of a stolen access token still depends on its expiry/provider.
    const config = supabaseConfig();
    if (config) {
      const cookieName = `sb-${new URL(config.url).hostname.split('.')[0]}-auth-token`;
      const store = await cookies();
      for (const cookie of store.getAll()) {
        if (cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`)) {
          store.set(cookie.name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        }
      }
    }
  }
  redirect('/login');
}
