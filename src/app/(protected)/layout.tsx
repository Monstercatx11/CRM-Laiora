import { requireAccount } from '@/lib/auth';
import { divisions } from '@/lib/navigation';
import { signOut } from '@/app/login/actions';
import Link from 'next/link';
import { headers } from 'next/headers';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAccount((await headers()).get('x-laiora-pathname') ?? '/dashboard');
  return <div className="workspace"><aside><Link className="brand" href="/dashboard">LAIORA<small>BOULANGERIE · ORDER DESK</small></Link><nav aria-label="Navigasi divisi">{divisions.map(d => <Link key={d.path} href={d.path}>{d.label}</Link>)}</nav><div className="account"><span>Akun operasional Laiora</span><small>{user.email}</small><form action={signOut}><button type="submit" className="signout">Keluar</button></form></div></aside><div className="workspace-main"><header><span className="eyebrow">Ruang kerja operasional</span><span className="badge">Akses terlindungi</span></header>{children}</div></div>;
}
