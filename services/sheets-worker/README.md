# Sinkronisasi Google Sheets Laiora

Supabase adalah sumber data utama; Google Sheets menerima salinan operasional melalui outbox database. Pesanan tetap tersimpan bila Google sedang tidak tersedia. Belum ada koneksi Google yang diaktifkan oleh kode ini.

**Mode tanpa VPS tersedia di dashboard:** request Vercel `POST /api/sync` menjalankan maksimal lima pekerjaan/30 detik ketika admin menekan **Sinkronkan sekarang**, lalu melepas lease. GET hanya memeriksa kesiapan/status. Lihat [panduan Google Sheets Vercel](../../docs/GOOGLE_SHEETS_VERCEL.md). Shared adapters dan `src/serverless.mjs` menjalankan batch tanpa mengimpor loop proses.

Instruksi di bawah berlaku untuk **mode worker terus-menerus yang opsional**, bila kelak dibutuhkan sinkronisasi tanpa klik. Tidak perlu memasang worker terpisah untuk mode manual Vercel.

## Persiapan sekali

1. Terapkan migrasi database 001–006 berurutan. Jika 001–004 sudah diterapkan, jalankan hanya migrasi baru yang belum diterapkan. Jangan jalankan ulang skrip fondasi.
2. Di Google Cloud, pilih/buat project, aktifkan **Google Sheets API**, lalu buat **Service Account** khusus Laiora. Service account tidak memerlukan peran administrator Google Cloud.
3. Buat key JSON service account dan simpan melalui pengaturan secret hosting worker. Jangan masukkan isinya ke chat, GitHub, spreadsheet, atau konfigurasi `NEXT_PUBLIC_*`.
4. Buka spreadsheet Laiora, klik **Share**, dan beri service account (`client_email` dari pengaturan akun Google Cloud) akses **Editor** ke spreadsheet tersebut.
5. Untuk mode terus-menerus saja, siapkan Node.js 22+ pada server yang selalu berjalan, misalnya VPS/Railway. Loop `src/index.mjs` tidak dijalankan sebagai request atau function Vercel; mode Vercel memakai `src/serverless.mjs`.

## Konfigurasi worker

Gunakan `.env.example` sebagai daftar nama konfigurasi. Untuk menjalankan secara lokal, salin ke `.env.local` (diabaikan Git), isi dengan editor lokal, lalu gunakan opsi `--env-file` Node. Pada hosting, masukkan nilai melalui penyimpanan secret bawaan hosting.

| Nama | Kegunaan |
| --- | --- |
| `SUPABASE_URL` | URL proyek Laiora, `https://nhkzxncfbfejbrceuzyb.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret key backend Supabase (`sb_secret_…`) atau JWT `service_role` lama; khusus proses worker |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Seluruh JSON service account, sebagai satu nilai environment variable; ikuti format multiline/escaping hosting |
| `GOOGLE_SPREADSHEET_ID` | Default `1KTxNabq2oEw-kevJEBj2J4BZ7ZTd21fisIALeGkXMs0` |
| `SHEETS_TAB_PREFIX` | Default `Laiora_`; awalan 3–36 karakter ASCII, huruf pertama, berakhir `_` |
| `POLL_INTERVAL_MS` | Default `5000`, minimal `1000`, maksimal `60000` |

```bash
cd services/sheets-worker
node --env-file=.env.local src/index.mjs
```

Tidak ada paket runtime pihak ketiga yang harus di-install. `npm start` juga tersedia jika environment variables sudah diinjeksi oleh hosting. Sesuaikan restart policy hosting agar proses kembali berjalan setelah reboot.

Destinasi HTTPS yang diperlukan: domain proyek Supabase, `oauth2.googleapis.com`, dan `sheets.googleapis.com`. Pertahankan validasi TLS dan pengaturan proxy/CA resmi hosting.

Worker otomatis mengantrekan data yang sudah ada saat pertama berjalan dan sekali setiap pergantian hari pada zona waktu bisnis. Ini juga memperbarui harga katalog yang mulai berlaku hari tersebut. Untuk mengantrekan rekonsiliasi manual setelah konfigurasi pertama tanpa menjalankan loop:

```bash
node --env-file=.env.local src/index.mjs --backfill
```

Hentikan loop worker sebelum menjalankan backfill manual, atau tunggu lease worker sebelumnya berakhir (90 detik), karena hanya satu worker boleh memegang lease. Backfill tidak mengubah nomor/revisi pesanan atau membuat data pelanggan contoh.

## Tab yang dibuat

Worker hanya membuat dan mengelola tab berikut. Tab lama milik pengguna tetap disimpan.

| Tab | Isi / kolom yang dikelola |
| --- | --- |
| `Laiora_Orders` | ID, versi, active, nomor/status/revisi PO, pengirim/penerima, jadwal/alamat/pengiriman, kartu/ucapan, subtotal/total, produksi, fulfillment, catatan, waktu perubahan, referensi dashboard privat |
| `Laiora_Order_Items` | ID item, versi, active, ID/nomor order, produk/ukuran/jumlah/harga, catatan potong/item |
| `Laiora_Production_Summary` | ID item, versi, active, ID/nomor/status PO, jadwal/status produksi/pengiriman, produk/ukuran/jumlah/catatan |
| `Laiora_Payments` | ID pembayaran, versi, active, ID order, nominal/tanggal/reference/status verifikasi, referensi bukti privat |
| `Laiora_Products` | ID produk, versi, active, SKU/nama/ukuran, harga yang berlaku pada hari bisnis |
| `Laiora_Price_History` | ID harga, versi, active, ID produk, harga dan tanggal berlaku |
| `Laiora_Chat_Tracking` | ID opportunity, versi, active, nama/telepon kontak, follow-up, label PO/produk, ID order terkait, waktu pesan terakhir |
| `Laiora_Settings` | ID tetap, versi, active, nama bisnis, timezone, harga kartu, waktu perubahan |
| `Laiora_Revisions` | ID revisi, versi proyeksi, active, ID order, nomor revisi, ID akun pelaku, waktu, nama field yang berubah; tanpa seluruh isi snapshot |
| `Laiora_Sync_Status` | ID entity gabungan, versi, active, tipe/ID entity, status synced, waktu snapshot proyeksi; ditulis setelah tab lain selesai |

Daftar header persisnya ada di `src/projection.mjs` (`HEADERS`). Setiap tab dimulai dengan `id`, `source_version`, `active`. Seluruh kolom dari A hingga header terakhir dikelola worker dan diperbarui dari Supabase. Jika ingin menambahkan catatan pribadi, tambahkan kolom **di sebelah kanan** kolom terakhir; worker tidak mengubah kolom tambahan tersebut. Nilai manual di kolom yang dikelola akan diperbarui kembali dari Supabase.

Gunakan **active = TRUE** untuk laporan. Item yang dihapus/diganti ketika revisi PO diberi tombstone `active = FALSE` sehingga angka rekap tidak menghitung item lama. Untuk produksi, tambahkan filter `order_state = confirmed`; kolom status tetap tersedia untuk meninjau pembatalan. Harga historis tetap disimpan.

Jika tab bernama sama sudah ada tetapi header tidak cocok, worker berhenti untuk tab itu dengan `SHEET_HEADER_CONFLICT`. Rename tab lama agar worker dapat membuat tab baru, atau pilih awalan baru dan jalankan backfill. Worker tidak mengosongkan tab atau menganggap tab kosong sebagai tab miliknya.

Data chat mentah, raw form, secret, dan signed URL dokumen tidak disalin ke Sheets. Referensi bukti adalah path aplikasi yang memerlukan login; tidak membuat bukti menjadi publik.

`Laiora_Sync_Status` mencatat keberhasilan proyeksi terakhir per entity. Antrean/error yang sedang berjalan tetap dilihat di dashboard Integrasi karena saat Google tidak tersedia worker tidak dapat menulis kode kegagalan ke Google.

## Keandalan dan batas operasional

- Lease database tunggal untuk satu target spreadsheet, diperpanjang sebelum setiap request Google; request memiliki timeout 20 detik, lease 90 detik. Beberapa proses worker yang salah sengaja berjalan bersama akan menunggu lease yang sama.
- Job diklaim satu per satu dengan row lock, `SKIP LOCKED`, identitas pemilik, batas 12 percobaan, serta backoff berjitter maksimal satu jam. HTTP 429 menghormati `Retry-After`. Token Google diperbarui sebelum kedaluwarsa dan setelah 401 satu kali.
- Snapshot diambil dari data terbaru; versi monotonic disimpan sebagai teks agar bigint tidak kehilangan presisi. Versi spreadsheet yang lebih baru tidak ditimpa snapshot lama. Acknowledgement/retry hanya memengaruhi job yang diklaim, sehingga perubahan baru tidak hilang.
- Lookup ID dilakukan ulang sebelum setiap batch, tanpa menyimpan row index lintas job. Sorting yang sudah selesai sebelum batch berikutnya ditangani. Gunakan **Filter views** untuk menyortir saat worker aktif: Google Sheets tidak menyediakan compare-and-swap row, jadi sort/insert/delete manual yang terjadi tepat di antara lookup dan write tidak dapat dibuat atomik. Hentikan worker ketika merombak struktur tab, kemudian backfill.
- Beberapa tab tidak dapat disimpan dalam satu transaksi bersama database. Jika worker berhenti di tengah satu pesanan, sebagian tab dapat sementara berada pada versi berbeda; retry melengkapi proyeksi secara idempotent sebelum job dinyatakan sukses.
- Jangan memberi dua aplikasi/database berbeda hak menulis tab berawalan sama. Lease berlaku dalam satu database Laiora. Jangan menjalankan worker versi lama dengan konfigurasi target berbeda secara bersamaan.
- Header tab dan ID duplikat diperiksa sebelum write; konflik tampil sebagai kode error. Log hanya mencatat jenis entity dan kode operasional, tanpa isi request/response, chat, atau kredensial.
- Pertumbuhan spreadsheet mengikuti batas kapasitas Google Sheets. Outbox `done` adalah histori pekerjaan; tetapkan retensi server/database sesuai kebutuhan volume, jangan menghapus job pending/processing/failed.

Dashboard Integrasi menggunakan `laiora_sync_status()` dan tombol retry `laiora_retry_sync()`, hanya untuk akun operasional terikat. Badge sinkronisasi baru dijalankan berarti heartbeat diterima dalam 120 detik; `Terakhir berhasil` menunjukkan keberhasilan write job terakhir. Kesiapan konfigurasi serverless diperiksa terpisah melalui GET `/api/sync`; presence secret tidak dianggap bukti keberhasilan write. Tanpa Google credentials yang benar dan akses spreadsheet, antrean belum terkirim walaupun database sudah siap.

## Pengujian

```bash
npm test --prefix services/sheets-worker
```

Pengujian menggunakan adapter in-memory/fetch palsu untuk perubahan urutan baris, versi bigint, item dihapus/revisi, formula injection, header conflict, ID duplikat, future price, token expiry, 429, outage, dan kehilangan lease. Tidak menulis ke Google atau Supabase online.

Tes SQL worker tambahan menggunakan PGlite dari `supabase/tests`:

```bash
npm ci --prefix supabase/tests
node services/sheets-worker/test/database.mjs
```

PGlite adalah PostgreSQL lokal untuk kontrak SQL/izin/lease. Sebelum produksi, lakukan uji integrasi dengan service account dan spreadsheet yang dimaksud: buat satu draft lalu revisi itemnya, konfirmasikan PO, verifikasi pembayaran, dan pastikan semua tab menunjukkan versi terbaru dan item lama tidak aktif.
