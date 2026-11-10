# Testing localhost di Windows

Dashboard dan konektor WhatsApp berjalan di komputer yang sama. Belum perlu Render, domain, port forwarding, atau membuka akses komputer ke internet. Koneksi internet tetap diperlukan untuk Supabase dan WhatsApp. Data uji disimpan di proyek Supabase yang dikonfigurasi, bukan database lokal terpisah. Jika menggunakan proyek operasional, gunakan percakapan/pesanan uji yang mudah dikenali.

## 1. Persiapan

Pasang Node.js 24 LTS dan Git for Windows, lalu buka ulang PowerShell. Periksa `node --version` dan `git --version`. Perintah menggunakan `npm.cmd` agar tidak bergantung pada izin eksekusi script PowerShell.

Jika belum punya checkout:

```powershell
git clone https://github.com/Monstercatx11/CRM-Laiora.git
cd CRM-Laiora
```

Jika sudah ada checkout, buka foldernya dan jalankan `git pull` setelah menyimpan perubahan lokal Anda. Lalu:

```powershell
npm.cmd ci
npm.cmd ci --prefix services/whatsapp-bridge
npm.cmd run setup:whatsapp
```

Setup membuat `.env.local` dan `services/whatsapp-bridge/.env` dengan token yang sama, kunci enkripsi sesi, dan folder data lokal `./data`. Setup mempertahankan nilai lama dan menolak konflik token/proyek; rerun tidak mereset kunci atau sesi yang sudah ada. Simpan file konfigurasi itu secara privat. Jika Node.js mengeluh versi atau modul util.parseEnv, pastikan terminal memakai Node.js 24.

## 2. Isi key di komputer sendiri

```powershell
notepad .env.local
notepad services/whatsapp-bridge/.env
```

- `.env.local`: isi `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dengan publishable key proyek. URL sudah diisi untuk proyek Laiora.
- `services/whatsapp-bridge/.env`: isi `SUPABASE_SECRET_KEY` dengan backend secret proyek Supabase atau legacy service-role key. Buka Supabase → Project Settings → API Keys untuk mengambil key yang sesuai.
- Token bridge dan kunci sesi sudah dibuat otomatis; jangan ganti dan jangan kirim nilainya ke chat/GitHub. Backend secret hanya dipakai konektor, tanpa awalan `NEXT_PUBLIC_`.
- Pastikan database sudah memiliki migrasi 001–006. Untuk tombol pemindahan tahap pipeline, jalankan migrasi `supabase/migrations/202611100007_chat_pipeline.sql` sekali melalui Supabase SQL Editor. Jika sebelumnya sudah dijalankan, tidak perlu mengulang setup database.

## 3. Jalankan dua terminal

**Terminal 1**, di folder `CRM-Laiora`:

```powershell
npm.cmd run dev:local
```

**Terminal 2**, juga di folder `CRM-Laiora`:

```powershell
npm.cmd run start:local --prefix services/whatsapp-bridge
```

Di browser komputer sendiri, buka alamat loopback yang ditampilkan Terminal 1, tambahkan `/login`, lalu masuk dengan akun operasional yang sama. Buka **Integrasi → Hubungkan WhatsApp**. Di ponsel buka WhatsApp Business → Perangkat tertaut → Tautkan perangkat → scan QR di layar komputer.

Alamat Vercel tidak bisa menghubungi konektor loopback di komputer Anda. Untuk tes ini, buka dashboard lokal dan jalankan kedua terminal. Tidak perlu mengubah environment Vercel atau konfigurasi production.

## 4. Uji mirror dan pipeline

1. Kirim pesan dari nomor lain ke nomor WhatsApp bisnis, lalu balas dari WhatsApp bisnis.
2. Buka **Tracking Chat → Percakapan**, klik **Perbarui chat & pipeline** atau tunggu polling 15 detik.
3. Periksa pesan masuk/keluar. Media dicatat sebagai keterangan/caption; riwayat penuh, edit/hapus pesan dan file lampiran belum dicerminkan.
4. Buka **Pipeline**, atur tahap peluang, lalu pilih label produk. Status Sudah PO membutuhkan order terkonfirmasi yang terhubung.
5. Hentikan kedua terminal dengan `Ctrl+C` setelah tes. Sesi dan antrean tetap tersimpan terenkripsi di `services/whatsapp-bridge/data`; jangan menghapusnya atau mengganti kunci sesi ketika masih ada antrean yang belum tersimpan.

Jika status **Server WhatsApp belum dipasang**, periksa URL/token pada `.env.local` lalu restart Terminal 1. Jika service gagal karena missing setting, isi key yang diminta di `.env` konektor. Jika **Server WhatsApp tidak dapat dijangkau**, periksa Terminal 2. Jangan menjalankan dua konektor dengan akun/data directory yang sama sekaligus.

Saat komputer/konektor berhenti, pencatatan tidak berjalan. Pengujian ini memakai library Linked Devices tidak resmi; riwayat yang tersedia dan kebutuhan scan ulang bergantung pada WhatsApp. Setelah tes berhasil, konfigurasi server online dapat dilanjutkan dengan panduan `WHATSAPP_MIRROR_PIPELINE.md`.

File sesi dienkripsi dan di-flush sebelum penggantian atomik. Directory fsync berjalan pada POSIX; Windows memakai file flush karena Node tidak menyediakan flush handle direktori Windows. Untuk pengujian konfigurasi: `npm.cmd run test:local-setup` dan `npm.cmd test --prefix services/whatsapp-bridge`. Pairing nyata dan penerimaan pesan harus diuji di komputer Anda.
