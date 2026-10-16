# Konsep visual dashboard Laiora

Artefak: [prototipe HTML](../design/index.html). Buka file tersebut menggunakan browser; tidak memerlukan instalasi dependency. Semua data sintetis dan tidak disimpan setelah reload. Prototipe ini belum merupakan aplikasi produksi.

## Arah visual

Krem hangat sebagai latar, biru gelap untuk navigasi dan aksi utama, kartu putih, judul serif, serta teks/tabel sans-serif. Nuansa bakery dipertahankan tanpa mengganggu keterbacaan operasional. Tulisan LAIORA pada sidebar adalah wordmark sementara, bukan pengganti logo asli untuk PDF.

Sidebar desktop menjadi navigasi horizontal pada layar kecil. Status memakai teks serta warna. Semua halaman menggunakan satu akun yang sama.

## Struktur halaman

| Halaman | Fokus |
|---|---|
| Ringkasan | Kirim hari ini, chat belum PO, siap diserahkan, dan kegagalan sinkron |
| Pesanan | Tabel, pencarian, filter pembayaran/tanggal, detail, dan contoh input draft |
| Tracking Chat | Daftar pelanggan, panel pesan, label produk, status PO, dan hubungan order |
| Produksi | Rekap unit fisik per produk/ukuran dan tanggal |
| Pengiriman | Penerima, jadwal, kurir, dan akses Delivery Order |
| Pembayaran | Tagihan dan status konfirmasi pembayaran |
| Integrasi | Status WhatsApp QR, Supabase, dan Sheets |

## Alur utama

Tracking Chat → tinjau minat produk → buat draft → lengkapi data → konfirmasi PO → nomor ditetapkan → produksi/pembayaran/pengiriman → selesai.

Label produk menunjukkan minat pelanggan. Belum PO berarti belum terhubung order terkonfirmasi; Sudah PO bukan berarti lunas. Satu kontak dapat memiliki beberapa peluang order; UI final perlu pemilih peluang sebelum menghubungkan order.

## Interaksi yang bisa ditinjau sekarang

- Pindah tujuh halaman melalui navigasi.
- Cari dan filter data contoh pada Pesanan.
- Filter Belum PO/Sudah PO dan cari nama/produk pada Tracking Chat.
- Pilih chat untuk melihat pesan dan ringkasan yang berbeda.
- Buka detail order atau simulasi form draft; input draft ditampilkan sebagai teks aman.
- Lihat feedback tombol integrasi/PDF yang belum dibangun.

Tombol koreksi label dan hubungkan order saat ini hanya menjelaskan interaksi final. Tidak ada QR aktif, nomor order nyata, pesan terkirim, PDF dibuat, atau koneksi database. Desain loading, error, pemilih peluang, riwayat, edit multi-label, serta review order lengkap dilanjutkan saat implementasi.

## Langkah berikutnya

Mulai dengan membuat proyek Supabase sesuai [panduan](PANDUAN_SUPABASE.md). Setelah konsep ditinjau dan proyek tersedia, lanjutkan fondasi aplikasi, schema/RLS, login tunggal, dan dashboard manual sebelum koneksi WhatsApp.
