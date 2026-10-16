# Delivery Order dan logo resmi

Delivery Order dibuat dari PO yang sudah dikonfirmasi. Buka detail PO atau halaman Pengiriman, lalu pilih **Unduh Delivery Order**. PDF dihasilkan menggunakan sesi pengguna terautentikasi dan tidak disimpan di URL publik.

Setiap dokumen dirender di browser pada canvas **200 dpi** sebelum tombol unduh akhir tersedia. Periksa logo, jarak 3 mm, outline, wrapping, dan pembatasan isi; lalu centang **Saya sudah memeriksa logo, jarak, outline, dan isi dokumen** dan pilih **Unduh PDF setelah diperiksa**. Gunakan **Perbesar pratinjau** untuk melihat pixel hasil render. PDF yang diunduh adalah file yang sama dengan pratinjau. Jika render gagal atau dialog ditutup, file tidak diunduh.

PDF.js dan worker dimuat dari aplikasi sendiri (`/pdf.worker.min.mjs`), tanpa CDN. Worker disalin dari dependensi terpasang oleh skrip build. Saat dialog ditutup, proses fetch/render dihentikan dan sumber daya dokumen dibersihkan.

## Prasyarat logo

File sumber resmi belum disertakan di repositori. Pada halaman **Pengaturan**, unggah **Vintage Blue Boulangerie Emblem(2).png** yang asli:

- Format PNG, maksimum 2 MiB.
- Canvas asli 1536 × 1024 px dengan latar transparan; tidak di-crop atau di-stretch.
- Bounding box tinta setelah threshold alpha: `(38, 73, 1499, 976)` dalam pixel, batas kanan/bawah eksklusif, sesuai README §10.

File asli disimpan tanpa perubahan di bucket privat `branding`, path `logos/<uuid>.png`. Migrasi operasional menyediakan bucket, policy akun tunggal, dan `app_settings.logo_path`. Tidak ada pengganti/logo buatan di aplikasi. Perbedaan canvas atau posisi tinta ditolak supaya jarak 3 mm pada template tetap benar.

Saat mencetak, sistem membuat salinan dalam memori: alpha ≥ 128 menjadi hitam opak, alpha < 128 menjadi transparan. Canvas dan skala 3:2 dipertahankan seluruhnya.

## Isi dan batas halaman

Template mengikuti README §10: 100 × 150 mm, outline tetap, Helvetica, titik awal teks dan logo tetap, isi body 9.5 pt dengan leading 12 pt. PDF hanya mengambil penerima, nomor HP, produk/jumlah, tanggal, alamat, serta instruksi pengiriman. Data pemesan, pembayaran, harga, ongkir nominal, dan isi kartu tidak diambil.

Alamat dan instruksi di-wrap. Isi melebihi satu halaman ditolak dengan pesan agar admin meringkas atau memisahkan pengiriman; sistem tidak mengecilkan font, memotong data, atau menambah halaman dengan template yang berbeda. Karakter yang tidak tersedia dalam Helvetica (misalnya emoji) juga ditolak tanpa menghapusnya diam-diam.

Instruksi yang berisi nominal uang atau label kartu perlu dipindahkan ke kolom administrasi/kartu sebelum membuat PDF. Untuk Pick Up/Drop Off, alamat kosong menggunakan nama metode; alamat yang secara eksplisit diisi tetap dipakai.

## Validasi

Jalankan `node --import tsx tests/documents.test.mjs`. Tes memeriksa geometri, gap tinta 3 mm, threshold alpha, CRC PNG, wrapping, overflow, pembatasan isi, dan halaman PDF sebenarnya. Jika `pdftoppm` tersedia, PDF juga dirender 200 dpi serta diperiksa warna dan batas ink-nya. `pdftotext`, jika tersedia, memeriksa teks dari PDF sebenarnya.

Fixture tes merupakan gambar sintetis khusus pengujian, bukan logo resmi. Untuk menyimpan hasil tes di luar checkout:

```sh
LAIORA_PDF_QA_DIR=/tmp/laiora-pdf-qa node --import tsx tests/documents.test.mjs
```

Setelah file resmi diunggah, unduh satu PDF order yang representatif dan render minimal 180–200 dpi untuk verifikasi visual logo, gap, wrapping, dan outline sebelum digunakan operasional. Verifikasi menggunakan file resmi masih memerlukan unggahan sumber tersebut.
