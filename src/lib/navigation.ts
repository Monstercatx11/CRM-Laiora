export const divisions = [
  { path: '/dashboard', label: 'Ringkasan', description: 'Ruang kerja operasional Laiora.' },
  { path: '/pesanan', label: 'Pesanan', description: 'Daftar PO dan riwayat revisi.' },
  { path: '/tracking-chat', label: 'Tracking Chat', description: 'Percakapan, label produk, dan status PO.' },
  { path: '/produksi', label: 'Produksi', description: 'Kebutuhan produk dan progres dapur.' },
  { path: '/pengiriman', label: 'Pengiriman', description: 'Penerima, jadwal, dan Delivery Order.' },
  { path: '/pembayaran', label: 'Pembayaran', description: 'Tagihan dan pembayaran terkonfirmasi.' },
  { path: '/katalog', label: 'Produk & Harga', description: 'Katalog dan harga aktif.' },
  { path: '/pengaturan', label: 'Pengaturan', description: 'Bisnis, penomoran, dan dokumen.' },
  { path: '/integrasi', label: 'Integrasi', description: 'Koneksi ruang kerja Laiora.' },
] as const;

// Exact allowlist: never pass an arbitrary URL to a post-login redirect.
export function safeDestination(value: unknown): string {
  if (divisions.some((division) => division.path === value)) return value as string;
  if (typeof value === 'string' && /^\/pesanan\/baru\?opportunity_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  if (typeof value === 'string' && /^\/pesanan\/(?:baru|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/edit)?)$/i.test(value)) return value;
  return '/dashboard';
}
