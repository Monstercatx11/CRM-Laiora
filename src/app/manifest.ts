import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Laiora — Order Desk',
    short_name: 'Laiora',
    description: 'Kelola pesanan dan operasional Laiora Boulangerie.',
    lang: 'id',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f6f1',
    theme_color: '#203d50',
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
