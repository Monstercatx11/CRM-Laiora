# Google Sheets dari Vercel, tanpa VPS

Dashboard dapat menyinkronkan data melalui tombol **Integrasi → Sinkronkan sekarang**. Proses berjalan sebagai request Vercel: maksimal lima pekerjaan atau sekitar 30 detik per klik, lalu berhenti. Klik kembali untuk melanjutkan antrean yang masih tersisa. Tidak ada server tambahan atau langganan VPS yang diperlukan untuk mode ini.

Data utama tetap di Supabase. Fitur ini tidak otomatis berjalan sepanjang hari; tanpa klik, perubahan menunggu di antrean. Worker terpisah tetap tersedia sebagai opsi bila kelak diperlukan sinkronisasi terus-menerus.

## 1. Siapkan database

Terapkan migrasi aplikasi baru yang belum diterapkan, termasuk **005** dan **006**, melalui SQL Editor pada proyek Laiora. Jangan jalankan ulang fondasi 001–004 yang sudah berhasil. Migrasi 006 menambahkan antrean, lease singkat, pencatatan status, initialization/backfill, dan pelepasan lease setelah satu request selesai.

## 2. Beri akses Google ke spreadsheet

1. Buka [Google Cloud Console](https://console.cloud.google.com/) dan pilih/buat project khusus Laiora.
2. Buka **APIs & Services → Library**, cari **Google Sheets API**, lalu **Enable**.
3. Buka **IAM & Admin → Service Accounts → Create service account**. Nama misalnya `laiora-sheets`. Tidak perlu memberikan peran administrator Google Cloud.
4. Buka service account tersebut → **Keys → Add key → Create new key → JSON**. Simpan unduhan secara privat.
5. Salin alamat email service account dari halaman detailnya.
6. Buka [spreadsheet Laiora](https://docs.google.com/spreadsheets/d/1KTxNabq2oEw-kevJEBj2J4BZ7ZTd21fisIALeGkXMs0/edit), klik **Share**, lalu undang email service account dengan izin **Editor**.

Google Workspace dapat membatasi undangan akun eksternal atau pembuatan service-account key. Jika kebijakan organisasi menolak, mintalah administrator organisasi mengatur izin yang sesuai; jangan mematikan pengamanan organisasi secara luas.

## 3. Isi konfigurasi Vercel

Buka project **crm-laiora → Settings → Environment Variables**. Masukkan:

| Nama | Isi |
| --- | --- |
| `SUPABASE_SECRET_KEY` | Secret key backend proyek Supabase (`sb_secret_…`) atau JWT `service_role` lama dari pengaturan API Keys. Tidak memakai publishable key di sini. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Seluruh isi file JSON unduhan Google, sebagai satu nilai environment variable. Pertahankan karakter `\n` di dalam field private key. |
| `GOOGLE_SPREADSHEET_ID` | `1KTxNabq2oEw-kevJEBj2J4BZ7ZTd21fisIALeGkXMs0` (opsional karena sudah menjadi default) |

URL database menggunakan `SUPABASE_URL` atau `NEXT_PUBLIC_SUPABASE_URL` yang sudah ada. Publishable key aplikasi tetap digunakan untuk login; secret backend hanya digunakan oleh request server yang sudah memverifikasi akun Laiora.

Simpan secret lewat pengaturan Vercel, **jangan kirim nilainya ke chat atau commit ke GitHub**. Variabel backend tersebut tidak boleh diberi awalan `NEXT_PUBLIC_`. Jika hanya Production yang menggunakan spreadsheet asli, pilih environment **Production** untuk secret ini agar deployment Preview tidak menulis ke spreadsheet asli.

Setelah menyimpan, lakukan **Redeploy** pada deployment Production agar variabel baru dipakai.

## 4. Jalankan dari dashboard

1. Login ke dashboard Laiora, lalu buka **Integrasi**.
2. Jika konfigurasi belum lengkap, halaman menyebut nama variabel yang perlu ditambahkan, tanpa menampilkan nilainya.
3. Klik **Sinkronkan sekarang**. Pada klik pertama, data yang sudah ada di database juga dimasukkan ke antrean.
4. Tunggu hasil batch. Klik kembali selama antrean masih ada. Satu pesanan dapat mengubah beberapa tab sehingga jumlah pekerjaan berbeda dengan jumlah baris yang ditulis.
5. Jika muncul pekerjaan gagal, perbaiki akses/konfigurasi yang disebutkan, klik **Coba ulang sinkronisasi**, lalu **Sinkronkan sekarang**. Tombol retry mengantrekan ulang; tombol sinkronisasi menjalankan batch.

Request memerlukan login akun Laiora dan pemeriksaan origin. Endpoint GET hanya membaca kesiapan/status; tidak menulis Google. Tidak ada cron/scheduler yang ditambahkan otomatis dan tidak diperlukan paket Vercel berbayar untuk mengaktifkan jadwal.

## Data yang masuk

Tab dengan awalan **Laiora_** dibuat khusus oleh aplikasi: Orders, Order_Items, Production_Summary, Payments, Products, Price_History, Chat_Tracking, Settings, Revisions, dan Sync_Status. Tab lama tidak dihapus atau diganti. Jika nama tab sama tetapi header berbeda, sinkronisasi berhenti dengan `SHEET_HEADER_CONFLICT` agar data lama tidak tertimpa.

Isi chat mentah, raw form, secret, serta signed URL tidak disalin. Label produk/status PO dan informasi kontak operasional disalin ke Chat_Tracking. Referensi bukti pembayaran/dokumen mengarah ke aplikasi dan tetap memerlukan login.

Kolom dari A sampai header terakhir di setiap tab dikelola aplikasi. Catatan manual boleh ditambahkan di sebelah kanan kolom terakhir. Untuk laporan, filter **active = TRUE** supaya item revisi yang sudah dinonaktifkan tidak terhitung. Gunakan filter view ketika menyortir; hentikan sinkronisasi saat merombak struktur tab.

## Jika proses terhenti

Antrean tetap tersimpan di Supabase. Request normal melepas lease setelah selesai; jika request diputus paksa oleh hosting/jaringan, lease kedaluwarsa sekitar 90 detik dan pekerjaan dapat dilanjutkan. Sebagian tab mungkin sementara menunjukkan versi berbeda sampai batch berikutnya berhasil. Pembaruan memakai ID tetap dan versi sehingga retry tidak membuat order ganda.

Waktu **terakhir berhasil** menunjukkan satu pekerjaan terakhir yang berhasil selesai. Badge **sinkronisasi baru dijalankan** berasal dari heartbeat database, bukan sekadar adanya variabel lingkungan. Kesiapan konfigurasi tidak menjamin Google sudah menerima data; periksa waktu berhasil, antrean, dan tab spreadsheet setelah menjalankan batch.
