'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ChatRefresh() {
  const router = useRouter();
  const [automatic, setAutomatic] = useState(true);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      if (document.hidden || !navigator.onLine || document.querySelector('form:focus-within')) return;
      startTransition(() => router.refresh());
    }, 15000);
    return () => clearInterval(timer);
  }, [automatic, router]);
  return <div className="chat-refresh">
    <button className="secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? 'Memperbarui…' : 'Perbarui chat & pipeline'}</button>
    <label className="check"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)}/>Perbarui otomatis setiap 15 detik</label>
    <small className="muted">Mirror mengikuti pesan yang berhasil direkam konektor. Pembaruan otomatis dijeda saat mengisi form.</small>
  </div>;
}
