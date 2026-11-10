import { requireAccount } from '@/lib/auth';
import { WorkspaceSidebar } from '@/components/workspace-sidebar';
import { headers } from 'next/headers';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAccount((await headers()).get('x-laiora-pathname') ?? '/dashboard');
  return <div className="workspace"><WorkspaceSidebar email={user.email ?? ''} /><div className="workspace-main"><header><span className="eyebrow">Ruang kerja operasional</span><span className="badge">Akses terlindungi</span></header>{children}</div></div>;
}
