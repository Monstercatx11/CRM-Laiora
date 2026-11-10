import type { Metadata, Viewport } from 'next';
import { PwaRegistration } from '@/components/pwa-registration';
import './globals.css';
export const metadata: Metadata = { title: 'Laiora — Order Desk', description: 'Ruang kerja PO Laiora Boulangerie', robots: { index: false, follow: false }, manifest: '/manifest.webmanifest', other: { 'apple-mobile-web-app-capable': 'yes' }, appleWebApp: { capable: true, title: 'Laiora', statusBarStyle: 'default' }, icons: { apple: '/icons/apple-touch-icon.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#203d50' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body><PwaRegistration />{children}</body></html>;
}
