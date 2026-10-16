export type SyncStats = {
  pending: number;
  failed: number;
  lastCompleted: string | null;
  configured: boolean;
  error?: string;
};

export function SyncStatus({ stats, retryAction }: {
  stats: SyncStats;
  retryAction?: (formData: FormData) => void | Promise<void>;
}) {
  const completed = stats.lastCompleted ? new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(stats.lastCompleted)) : 'Belum ada';
  return <div aria-label="Status sinkronisasi Google Sheets">
    <span className="badge">{stats.configured ? 'Sinkronisasi baru dijalankan' : 'Belum ada sinkronisasi baru'}</span>
    <p>Database Supabase tetap menyimpan pesanan selama sinkronisasi tertunda. Spreadsheet menerima salinan operasional saat sinkronisasi dijalankan.</p>
    <dl className="sync-stats">
      <dt>Menunggu / diproses</dt><dd>{stats.pending}</dd>
      <dt>Perlu dicoba ulang</dt><dd>{stats.failed}</dd>
      <dt>Terakhir berhasil (WIB)</dt><dd>{completed}</dd>
    </dl>
    {stats.error && <p className="message error" role="status">Sinkronisasi tertunda ({stats.error}). Periksa koneksi dan izin Google Sheets.</p>}
    {retryAction && <form action={retryAction}><button type="submit" disabled={stats.failed === 0}>Coba ulang sinkronisasi ({stats.failed})</button></form>}
    <p className="footnote">Tab dengan awalan Laiora_ dikelola otomatis. Gunakan filter active = TRUE untuk mengabaikan item revisi yang dinonaktifkan.</p>
  </div>;
}
