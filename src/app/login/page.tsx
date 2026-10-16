import { redirect } from 'next/navigation';
import { accountAccess } from '@/lib/auth';
import { safeDestination } from '@/lib/navigation';
import { supabaseConfig } from '@/lib/supabase/config';
import { LoginForm } from '@/components/login-form';
export const dynamic = 'force-dynamic';
const messages: Record<string, string> = {
  configuration: 'Login belum dikonfigurasi. Hubungi pengelola aplikasi.',
  forbidden: 'Akun ini tidak memiliki akses Laiora.',
  unavailable: 'Akses belum dapat diverifikasi. Coba lagi nanti.',
  logout: 'Keluar belum selesai. Coba kembali atau tutup sesi melalui pengelola akun.',
};
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeDestination(params.next);
  const access = await accountAccess();
  if (access.status === 'authorized' && params.error !== 'logout') redirect(next);
  const configured = !!supabaseConfig();
  const errorKey = typeof params.error === 'string' ? params.error : '';
  const message = messages[errorKey] || (access.status !== 'signed_out' && access.status !== 'authorized' ? messages[access.status] : '');
  return <main className="login-screen"><section className="login-intro"><div className="brand">LAIORA<small>BOULANGERIE · ORDER DESK</small></div><h1>Setiap pesanan,<br />tertata.</h1><p>Satu ruang kerja untuk pesanan, produksi,<br />dan momen manis pelanggan Anda.</p></section><section className="login-card"><span className="eyebrow">Ruang kerja Laiora</span><h2>Selamat datang kembali.</h2><p>Masuk dengan akun operasional Laiora.</p>{message && <p className="message" role="status">{message}</p>}<LoginForm next={next} configured={configured} /><p className="footnote">Satu akun untuk seluruh halaman divisi.<br />Hubungi pemilik bisnis untuk akses akun.</p></section></main>;
}
