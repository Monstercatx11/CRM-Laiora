export const divisions = [
  { path: '/dashboard', label: 'Ringkasan', description: 'Ruang kerja operasional Laiora.' },
  { path: '/pesanan', label: 'Pesanan', description: 'Daftar PO dan riwayat revisi.' },
  { path: '/tracking-chat', label: 'Tracking Chat', description: 'Percakapan, label produk, dan status PO.' },
  { path: '/produksi', label: 'Produksi', description: 'Kebutuhan produk dan progres dapur.' },
  { path: '/pengiriman', label: 'Pengiriman', description: 'Penerima, jadwal, dan Delivery Order.' },
  { path: '/pembayaran', label: 'Pembayaran', description: 'Tagihan dan pembayaran terkonfirmasi.' },
  { path: '/integrasi', label: 'Integrasi', description: 'Koneksi ruang kerja Laiora.' },
] as const;

// Exact allowlist: never pass an arbitrary URL to a post-login redirect.
export function safeDestination(value: unknown): string {
  return divisions.some((division) => division.path === value) ? value as string : '/dashboard';
}
