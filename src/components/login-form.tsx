'use client';
import { useActionState } from 'react';
import { signIn } from '@/app/login/actions';
export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState(signIn, { error: '' });
  return <form action={action}>
    <input type="hidden" name="next" value={next} />
    <label htmlFor="email">Email</label>
    <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={!configured} />
    <label htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={4096} disabled={!configured} />
    {state.error && <p className="message error" role="alert">{state.error}</p>}
    <button className="primary" type="submit" disabled={pending || !configured}>{pending ? 'Memeriksa…' : 'Masuk'}</button>
  </form>;
}
