# Menyiapkan Supabase untuk Laiora

Panduan tahap awal. Belum ada proyek Supabase yang dibuat atau dihubungkan oleh aplikasi. Nama menu dapat berubah; halaman dokumentasi Supabase tidak dapat diakses dari environment saat penyusunan panduan, sehingga urutan menu perlu dicocokkan dengan dashboard yang Anda lihat.

## 1. Buat proyek development

1. Buka https://supabase.com/dashboard lalu masuk atau buat akun.
2. Buat organization bila belum ada. Untuk mulai, pilih paket yang sesuai; paket gratis dapat dipakai eksplorasi tetapi batas, pause, dan backup harus diperiksa sebelum produksi.
3. Pilih **New project**. Nama usulan: `laiora-po-dev`.
4. Buat password database yang kuat dan simpan di password manager. Ini berbeda dari password login dashboard PO.
5. Pilih region dekat operasional. Singapore bisa dipertimbangkan bila tersedia dan sesuai lokasi bisnis.
6. Tunggu sampai proyek selesai dibuat. Gunakan proyek development ini untuk pengujian dengan data sintetis terlebih dahulu.

Yang boleh disampaikan di chat setelah selesai: nama proyek, region, dan status pembuatan. Tidak perlu mengirim password atau key rahasia.

## 2. Catat koneksi aplikasi

Cari bagian **Connect**, pengaturan API, atau API Keys pada dashboard proyek.

| Konfigurasi aplikasi | Sumber | Cara penggunaan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, biasanya `https://<project-ref>.supabase.co` | URL proyek; boleh digunakan frontend |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key; proyek lama mungkin menampilkan anon key | Untuk frontend, dengan RLS dan pemeriksaan akun yang benar |
| `SUPABASE_SECRET_KEY` | Secret key; proyek lama mungkin menggunakan service_role | Backend saja, dapat memiliki akses istimewa; jangan taruh pada variabel NEXT_PUBLIC |
| `DATABASE_URL` | Connection string dari Connect | Backend/migrasi saja; berisi kredensial database |

Nama variabel di atas adalah konvensi rancangan aplikasi, bukan variabel yang otomatis disediakan Supabase. Pilih key sesuai SDK saat implementasi; jangan memasukkan key anon ke kolom secret atau sebaliknya.

Simpan nilai rahasia di pengaturan environment/secret manager saat aplikasi disiapkan. Jangan kirim secret key, service_role, password, atau connection string ke chat, repo, screenshot, dan Sheets. File contoh konfigurasi hanya boleh berisi placeholder. Pemilihan direct connection atau pooler disesuaikan konektivitas host dan jenis pekerjaan migrasi/runtime, lalu diuji.

## 3. Siapkan satu akun aplikasi

1. Buka **Authentication** dan periksa pengaturan login/provider.
2. Aktifkan login email/password sesuai kebutuhan lalu nonaktifkan pendaftaran pengguna publik (**Allow new users to sign up** atau pengaturan setara).
3. Buat satu user aplikasi lewat fitur administrasi Users atau proses server-side yang aman. Gunakan email milik bisnis dan password tersendiri.
4. Catat UUID user tersebut; UUID digunakan aplikasi sebagai akun yang diizinkan.
5. Saat aplikasi tersedia, atur Site URL dan redirect URL secara spesifik untuk domain aplikasi. Jangan memakai wildcard luas di produksi.
6. Uji login akun tersebut, penolakan signup publik, logout, dan pemulihan password sebelum dipakai operasional.

Login ini berbeda dari akun pemilik Supabase Dashboard. Tim memakai akun aplikasi, bukan akses organization Supabase. Satu akun dapat membuka semua halaman divisi. Karena akun dibagi, audit tidak dapat memastikan identitas setiap orang.

## 4. Database: dibuat melalui migrasi, bukan tabel manual

Setelah proyek tersedia, implementasi akan menambahkan tabel melalui migrasi yang tersimpan di repo agar struktur dapat diulang. Jangan membuat tabel tebakan atau menjalankan SQL dari sumber yang belum ditinjau.

Kelompok tabel yang direncanakan:

- Katalog: products, product_prices, product_aliases.
- Transaksi: orders, order_items, payments, order_revisions, order_sequences.
- Chat: contacts, conversations, messages, chat_opportunities, opportunity_product_labels, opportunity_order_links.
- Operasional: audit_events, outbox_jobs, sync_records, document_records.

Nomor order dibuat dalam transaksi PostgreSQL; bukan dihitung browser atau mengambil nomor baris Sheets. Tanggal, nominal rupiah, nilai null ongkir, constraint, dan histori harga mengikuti SOP.

### RLS dan akses

- Aktifkan Row Level Security pada tabel yang diekspos melalui Data API.
- Tidak ada akses data pelanggan untuk role anon.
- Policy akun aplikasi harus memeriksa UUID akun Laiora yang ditentukan, bukan hanya membolehkan seluruh user authenticated tanpa batas.
- Backend tetap memverifikasi sesi untuk setiap tindakan. Secret/service_role dapat melewati RLS, sehingga pemeriksaan otorisasi backend wajib.
- Jangan membuka tabel sesi WhatsApp ke frontend. Kredensial Linked Devices disimpan terenkripsi di penyimpanan backend privat.
- Uji akses melalui API tanpa login, dengan login yang benar, dan dengan user lain bila dibuat untuk pengujian.

SQL policy dan migrasi final dibuat bersama implementasi, bukan dianggap telah terpasang oleh panduan ini.

## 5. Storage privat

Saat fitur dokumen dibangun, buat bucket privat untuk Delivery Order dan bukti pembayaran, misalnya `delivery-orders` serta `payment-proofs`. Atur batas ukuran dan MIME type sesuai fitur.

Unduh file melalui sesi yang sah atau signed URL berumur terbatas. Jangan membuat bucket publik untuk data pelanggan. Logo dapat dikelola sebagai aset aplikasi; kredensial WhatsApp tidak disimpan di bucket dokumen pelanggan.

## 6. Realtime dan Google Sheets

Realtime bersifat opsional untuk memperbarui listing di beberapa tab browser. Aktifkan hanya pada tabel yang dibutuhkan dan tetap gunakan RLS.

Supabase tidak otomatis menulis ke spreadsheet. Backend/worker akan menggunakan Google Sheets API dengan identitas Google yang diberi akses edit pada spreadsheet tujuan. Integrasi Google disiapkan terpisah, tanpa menaruh kredensialnya di browser. Perubahan order dan job sinkronisasi disimpan dalam transaksi yang sama; worker mengirim versi terbaru ke Sheets.

## 7. WhatsApp QR membutuhkan service terpisah

Supabase menyediakan database, Auth, dan Storage. Koneksi Linked Devices yang berlangsung terus tidak ditempatkan di fungsi Edge/serverless yang berumur terbatas. Siapkan service Node.js pada host yang selalu aktif, dengan penyimpanan sesi persisten terenkripsi, kunci di secret manager, dan indikator koneksi/reconnect.

Proyek Supabase siap tidak berarti WhatsApp atau Google Sheets sudah terhubung.

## Checklist sebelum integrasi development

- [ ] Proyek `laiora-po-dev` aktif dan region dicatat.
- [ ] Password database tersimpan aman.
- [ ] Project URL dan jenis key yang tersedia diketahui; secret belum dibagikan melalui chat.
- [ ] Satu akun aplikasi tersedia; signup publik dimatikan.
- [ ] UUID akun diizinkan sudah dicatat untuk konfigurasi aplikasi.
- [ ] Migrasi, RLS, login, dan Storage masih menunggu implementasi serta pengujian.
- [ ] Strategi backup/restore dan paket produksi belum dianggap selesai.

Referensi resmi untuk dicocokkan saat setup:

- https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/auth/general-configuration
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control

## Artefak setup yang sudah disiapkan

Migrasi database dan hasil verifikasi lokal kini tersedia di [supabase/README.md](../supabase/README.md). Empat migrasi telah diuji lokal dengan 28 pemeriksaan lulus. Penerapan online, pembuatan akun Auth, dan koneksi dashboard belum dilakukan karena akses proyek Supabase belum tersedia dalam sesi. Ikuti status terbaru pada dokumen tersebut; jangan menganggap seluruh prasyarat masih belum dibuat di repo.

## Implementasi Auth aplikasi

Login email/password, logout, refresh sesi, dan guard tujuh halaman kini tersedia pada aplikasi Next.js. Lihat [AUTH_SETUP.md](AUTH_SETUP.md) untuk cara menjalankan dan konfigurasi hosted. Proyek Supabase hosted dan akun nyata masih belum dikonfigurasi oleh sesi ini.

## Status setelah setup manual

Pemilik melaporkan setup SQL, akun Auth, binding satu UUID, serta penutupan signup sudah selesai. Lihat [STATUS_INTEGRASI.md](STATUS_INTEGRASI.md) dan [panduan menjalankan aplikasi](MENJALANKAN_APLIKASI.md) untuk langkah berikut; jangan mengulang setup hanya karena status lama pada bagian sebelumnya.
