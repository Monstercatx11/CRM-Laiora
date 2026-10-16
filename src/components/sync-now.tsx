'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Readiness = { configured: boolean; missing: string[]; invalid?: boolean };
export function SyncNow() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const router = useRouter();
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/sync', { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.configured === 'boolean' && !abort.signal.aborted) setReadiness({ configured: data.configured, missing: Array.isArray(data.missing) ? data.missing : [], invalid: data.invalid === true });
    }).catch(() => { if (!abort.signal.aborted) setNotice({ text: 'Konfigurasi belum dapat diperiksa. Muat ulang halaman atau coba sinkronisasi.', error: true }); });
    return () => abort.abort();
  }, []);
  async function sync() {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch('/api/sync', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(50000) });
      const result = await response.json().catch(() => null);
      if (result?.configured === false) setReadiness({ configured: false, missing: result.missing ?? [], invalid: result.code === 'CONFIGURATION_INVALID' });
      if (result?.configured === true) setReadiness({ configured: true, missing: [] });
      setNotice({ text: result?.message || result?.error || 'Sinkronisasi belum berhasil. Periksa koneksi dan login.', error: !response.ok });
      router.refresh();
    } catch { setNotice({ text: 'Permintaan terputus. Data tetap di Supabase; muat ulang status lalu coba lagi untuk melanjutkan antrean.', error: true }); }
    finally { setBusy(false); }
  }
  return <div className="stack" style={{ marginTop: 20 }}>
    <p>Sinkronkan langsung dari Vercel tanpa VPS. Satu klik memproses maksimal 5 pekerjaan selama sekitar 30 detik; lanjutkan dengan klik berikutnya jika antrean masih ada.</p>
    {readiness?.configured === false && <p className="message">{readiness.invalid ? 'Konfigurasi Google Sheets perlu diperbaiki pada Vercel.' : `Konfigurasi belum lengkap: ${readiness.missing.join(', ')}.`} Tambahkan melalui Environment Variables, lalu deploy ulang. Google Sheets belum menerima data.</p>}
    <button type="button" className="btn primary" style={{ width: 'auto' }} disabled={busy || readiness?.configured === false} onClick={() => void sync()}>{busy ? 'Menyinkronkan…' : 'Sinkronkan sekarang'}</button>
    {notice && <p className={notice.error ? 'message error' : 'message'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <p className="footnote">Sinkronisasi berjalan saat tombol ditekan. Tab Laiora_ dikelola aplikasi; tab lama spreadsheet tetap disimpan.</p>
  </div>;
}
