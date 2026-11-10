'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { divisions } from '@/lib/navigation';
import { signOut } from '@/app/login/actions';

export function WorkspaceSidebar({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return <aside>
    <div className="sidebar-heading">
      <Link className="brand" href="/dashboard" onClick={() => setOpen(false)}>LAIORA<small>BOULANGERIE · ORDER DESK</small></Link>
      <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>{open ? 'Tutup' : 'Menu'}</button>
    </div>
    <div id="workspace-navigation" className={`sidebar-content${open ? ' is-open' : ''}`}>
      <nav aria-label="Navigasi divisi">{divisions.map(d => <Link key={d.path} href={d.path} aria-current={pathname === d.path || pathname.startsWith(d.path + '/') ? 'page' : undefined} onClick={() => setOpen(false)}>{d.label}</Link>)}</nav>
      <div className="account"><span>Akun operasional Laiora</span><small>{email}</small>
        <details className="install-guide"><summary>Pasang di ponsel</summary><p>Android: buka di Chrome, pilih menu ⋮ → Tambahkan ke layar utama atau Instal aplikasi.</p><p>iPhone: buka di Safari, pilih Bagikan → Tambahkan ke Layar Utama.</p><p>Gunakan koneksi internet untuk mengelola pesanan.</p></details>
        <form action={signOut}><button type="submit" className="signout">Keluar</button></form>
      </div>
    </div>
  </aside>;
}
