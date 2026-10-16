import 'server-only';
import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { sessionClient } from './supabase/server';
import { safeDestination } from './navigation';

type Access =
  | { status: 'authorized'; user: User }
  | { status: 'configuration' | 'signed_out' | 'forbidden' | 'unavailable' };

// React cache deduplicates within a render, not across users/requests.
export const accountAccess = cache(async (): Promise<Access> => {
  const supabase = await sessionClient();
  if (!supabase) return { status: 'configuration' };
  try {
    // getSession() alone would trust cookie data. getUser validates with Auth.
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      if (error && (!error.status || error.status >= 500 || error.status === 429)) return { status: 'unavailable' };
      return { status: 'signed_out' };
    }
    const { data: allowed, error: accessError } = await supabase.rpc('laiora_has_access');
    if (accessError) return { status: 'unavailable' };
    if (allowed !== true) return { status: 'forbidden' };
    return { status: 'authorized', user };
  } catch {
    return { status: 'unavailable' };
  }
});

export async function requireAccount(path = '/dashboard') {
  const access = await accountAccess();
  if (access.status === 'authorized') return access.user;
  const query = new URLSearchParams({ next: safeDestination(path) });
  if (access.status !== 'signed_out') query.set('error', access.status);
  redirect(`/login?${query}`);
}
