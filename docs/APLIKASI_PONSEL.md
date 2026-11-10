# Laiora di ponsel

CRM menggunakan tampilan responsif dan PWA, sehingga dapat dibuka dari browser atau dipasang sebagai ikon aplikasi. Gunakan alamat HTTPS deployment CRM, lalu buka `/dashboard` dan login.

- Android: Chrome → menu ⋮ → **Instal aplikasi** atau **Tambahkan ke layar utama**.
- iPhone/iPad: Safari → **Bagikan** → **Tambahkan ke Layar Utama**, lalu pilih buka sebagai aplikasi jika tersedia.
- Menu divisi di layar kecil dibuka melalui tombol **Menu**. Tabel dapat digeser mendatar di dalam panel. Form dan tombol simpan disusun untuk layar kecil.
- Ikon aplikasi menggunakan monogram L; ikon ini terpisah dari logo resmi untuk dokumen PDF.

Pesanan, login, pembayaran, dan chat memerlukan internet. Service worker hanya meneruskan navigasi ke jaringan dan menampilkan pemberitahuan ketika jaringan gagal; tidak menyediakan transaksi offline, antrean kirim ulang, atau cache data pelanggan. Setelah koneksi terputus saat menyimpan, periksa daftar pesanan sebelum mengirim ulang.

Pemasangan tersedia setelah deployment terbaru berstatus Ready. Dukungan dan nama menu pemasangan bergantung pada browser. Uji pemasangan nyata di Android/iOS setelah deploy; emulasi ukuran layar tidak menggantikan pengujian perangkat fisik.

Validasi pengembangan: `npm run build`, `npm run test:operations` (termasuk menu dan halaman pada lebar 360/390/768 piksel), `npm run test:auth`, dan `npm run test:pwa`. Tes PWA memeriksa manifest, dimensi ikon PNG, metadata iOS, registrasi service worker, halaman offline, pemulihan koneksi, dan tidak adanya cache data pelanggan.
