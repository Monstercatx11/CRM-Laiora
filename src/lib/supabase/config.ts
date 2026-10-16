export function supabaseConfig() {
  // Server-only runtime settings take precedence; NEXT_PUBLIC values remain
  // compatible with existing deployments that configure them at build time.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    // Plain HTTP is only appropriate for a local Supabase or test instance.
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return null;
    return { url, key };
  } catch {
    return null;
  }
}
