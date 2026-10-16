import { requireAccount } from '@/lib/auth';
import { divisions } from '@/lib/navigation';
export async function DivisionPage({ path }: { path: string }) {
  // Every page checks authorization independently; layouts may persist during
  // client navigation and are not sufficient to guard future data access.
  await requireAccount(path);
  const division = divisions.find(d => d.path === path)!;
  return <main className="page-content"><span className="eyebrow">Laiora / {division.label}</span><h1>{division.label}</h1><p className="subtitle">{division.description}</p><section className="panel"><span className="badge">Fondasi aplikasi</span><h2>Ruang kerja {division.label.toLowerCase()}</h2><p>Halaman ini hanya dapat diakses oleh akun operasional Laiora yang terverifikasi.</p><p>Fitur operasional pada halaman ini masih dalam pengembangan. Belum ada data pelanggan, pesan WhatsApp, atau sinkronisasi Sheets yang ditampilkan.</p></section></main>;
}
