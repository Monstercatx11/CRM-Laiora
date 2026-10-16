# Fondasi Supabase CRM Laiora

Status: UI login, server client Supabase, logout, dan protected routes kini tersedia; lihat [panduan Auth](../docs/AUTH_SETUP.md). Pemilik melaporkan setup SQL/Auth hosted telah dijalankan; verifikasi login hosted belum dilakukan oleh sesi ini (lihat [status integrasi](../docs/STATUS_INTEGRASI.md)). Empat migrasi disiapkan dan dijalankan pada PostgreSQL WASM lokal (PGlite). SQL setup hosted kini dilaporkan berhasil oleh pemilik; sesi ini belum memverifikasi hosted. Belum ada koneksi WhatsApp atau worker Sheets.

## Isi yang siap diterapkan ke proyek development baru

1. `migrations/202610160001_foundation.sql`: tabel katalog, harga, order/item, pembayaran, histori, kontak/chat/peluang/label, outbox; RLS satu akun; view Tracking Chat.
2. `migrations/202610160002_order_transactions.sql`: locking parent order pada perubahan item, perhitungan ulang agregat, snapshot revisi termasuk item, job order satu transaksi, dan RPC konfirmasi nomor.
3. `migrations/202610160003_sop_catalog.sql`: 16 varian harga aktif dari SOP, tanpa promo historis atau pelanggan contoh.
4. `migrations/202610160004_private_documents.sql`: dua bucket privat dengan batas ukuran/MIME dan policy baca satu akun.

Tidak ada nomor order awal yang ditetapkan otomatis. Nilai 26-0380 pada README adalah snapshot historis, bukan izin memulai counter pada nilai tersebut.

## Prasyarat penerapan online

- Akses plugin Supabase ke proyek development yang tepat, atau administrator proyek yang dapat menjalankan migrasi.
- Periksa tabel, policy, function, bucket existing dan migration history terlebih dahulu. Nama tabel menggunakan schema public; jangan jalankan membabi buta pada proyek yang sudah memiliki tabel senama. Migrasi sengaja gagal pada konflik, bukan menimpa objek existing.
- Proyek menyediakan schema Auth/Storage, role anon/authenticated/service_role, dan PostgreSQL yang mendukung security_invoker views.
- Konfirmasi bahwa perubahan hanya pada proyek development; tidak membuat proyek berbayar atau mengubah proyek produksi tanpa menentukan target.

Migrasi dijalankan berurutan dan dicatat melalui workflow migrasi Supabase. Jika menggunakan SQL Editor secara manual, jalankan isi setiap file berurutan satu kali dan catat penerapannya; jangan kemudian menjalankan ulang file yang sama lewat CLI tanpa merekonsiliasi history. Setiap file memakai transaksi. Jangan memasukkan schema Auth/Storage tiruan dari file tes ke Supabase.

## Mengaktifkan satu akun

1. Buat satu akun aplikasi melalui administrasi Supabase Auth, dengan email bisnis dan password yang dibuat/disampaikan secara aman. Password tidak disimpan di repo atau chat.
2. Nonaktifkan signup publik melalui pengaturan Auth; SQL ini tidak mengubah pengaturan Auth project.
3. Setelah UUID akun dipastikan benar, administrator database mengikat akun dengan SQL berikut, mengganti placeholder terlebih dahulu:

```sql
insert into laiora_private.app_account (user_id)
values ('GANTI_DENGAN_UUID_USER_AUTH');
```

Placeholder sengaja bukan UUID valid. Tanpa pengikatan, semua user aplikasi ditolak oleh policy baca. Primary key singleton membatasi tabel pengikatan menjadi satu baris. Akun Auth tambahan tidak mendapatkan akses walaupun bisa login.

Frontend boleh SELECT dengan publishable/anon key dan sesi akun yang diizinkan. Semua mutasi dilakukan backend dengan verifikasi sesi/UUID sebelum memakai service key. Authenticated tidak mendapat izin INSERT/UPDATE/DELETE maupun RPC penomoran. Jangan menaruh service key di frontend.

## Mengaktifkan sequence

Setelah nomor order terakhir dan aturan tahun telah diverifikasi, administrator mengisi counter. Contoh template (ganti placeholder, bukan SQL siap jalan):

```sql
insert into laiora_private.order_sequences (year, last_value)
values (TAHUN_EMPAT_DIGIT, NOMOR_URUT_TERAKHIR_TERVERIFIKASI);
```

Ganti kedua placeholder dengan integer yang benar. Jangan menjalankan `upsert` yang bisa menurunkan counter existing. Tahun belum diinisialisasi atau sequence sudah 9999 membuat konfirmasi gagal. Aplikasi harus menentukan tahun berdasarkan kebijakan/zona waktu bisnis, bukan membebaskannya kepada input browser.

Backend membuat draft dan item dalam transaksi, lalu memanggil `public.confirm_laiora_order(order_id, year)` menggunakan service role setelah memverifikasi pengguna. Pengulangan konfirmasi pada order terkonfirmasi mengembalikan nomor sama. Pembatalan tidak mengembalikan nomor untuk dipakai ulang.

## Model data dan batas fondasi

- Amount berupa integer rupiah; ongkir null menghasilkan grand_total null, sedangkan 0 memberi total final.
- Quantity/total produk dihitung ulang dari item. Harga satuan snapshot tidak berubah ketika katalog berubah.
- Biaya kartu hanya dikenakan ketika pilihan yes; pilihan lain wajib quantity kartu 0.
- Setiap perubahan order/item memperbarui revision_no dan outbox order dalam transaksi yang sama. Snapshot item disimpan dalam histori.
- View `chat_tracking` memakai security_invoker dan menghitung Sudah PO bila peluang punya order confirmed. Draft/batal tidak dihitung sebagai PO aktif.
- Nomor pesan unik dalam percakapan mencegah penyimpanan event berulang. Consumer harus menangani konflik duplikat sebagai no-op, bukan membuat pesan baru.
- Bucket dokumen privat; service backend saja yang mengunggah. Pembacaan oleh akun terikat melalui policy.
- `outbox_jobs` hanya dapat diakses service backend; kredensial WhatsApp tidak memiliki tabel publik.

**Belum diimplementasikan:** CRUD/validasi API bisnis dan normalisasi produk, pemilihan harga aktif/snapshot saat input, audit aktor backend yang terautentikasi, agregasi pembayaran, pemroses job/lease/retry Sheets, antrean perubahan pembayaran/katalog/chat, pencatatan lifecycle dokumen, QR service, serta renderer PDF. Fondasi outbox saat ini untuk perubahan order/item; belum menyatakan seluruh data operasional sudah tersinkron.

Audit order mengandung data pelanggan dan harus mengikuti kebijakan retensi. Penggunaan akun bersama membatasi penelusuran identitas individu. Service role tetap akses istimewa: pengamanan endpoint backend wajib sebelum penggunaan nyata.

## Menjalankan pemeriksaan lokal

```bash
cd /workspace/CRM-Laiora/supabase/tests
npm ci
npm test
```

Jika direktori cache default tidak dapat ditulis pada environment terbatas, gunakan `npm ci --cache /tmp/laiora-npm-cache`.

Tes memakai fixture Auth/Storage minimal, dua akun sintetis, dan nomor sintetis hanya di database in-memory. Memvalidasi SQL, constraint, role/RLS, generated totals, revisi, nomor, dedup pesan, PO status, dan policy metadata dokumen. Tidak memakai akun pelanggan atau koneksi eksternal.

Hasil saat penyusunan: **28 pemeriksaan lulus**. Ini bukan pengujian Supabase Auth/Storage hosted, konkurensi banyak koneksi, failover, koneksi API, atau deploy. Pengujian tersebut dilakukan pada proyek development setelah akses tersedia.

## Langkah setelah akses proyek tersedia

1. Daftar proyek melalui plugin dan pilih target yang sesuai; inspeksi schema/migrasi existing.
2. Terapkan migrasi yang kompatibel, periksa RLS, fungsi, katalog, bucket, dan hasil advisor jika tersedia.
3. Buat/bind akun aplikasi dengan mekanisme kredensial aman; matikan signup publik.
4. Verifikasi nomor terakhir lalu inisialisasi sequence.
5. Uji login, akses tanpa login/user lain, konfirmasi dua sesi, rollback, Storage privat, dan repeat RPC pada hosted development.
6. Bangun backend dan dashboard manual, lalu worker Sheets dan service WhatsApp QR sesuai task list.
