# Menjalankan CRM Laiora dari GitHub

## Status aplikasi

Aplikasi Next.js saat ini menyediakan login email/password Supabase, logout, refresh sesi, pemeriksaan satu akun Laiora, dan sembilan halaman divisi/pengaturan yang terlindungi, CRUD order, katalog, pembayaran/bukti, produksi/pengiriman, tracking chat, dokumen, dan konektor opsional. Versi ini memerlukan [upgrade005–006](PANDUAN_OPERASIONAL.md) pada database existing. QR belum aktif tanpa service persisten; Sheets memerlukan identitas Google dan secret backend.

Pemilik melaporkan bahwa SQL setup berhasil, akun Auth sudah dibuat dan diikat, serta pendaftaran publik sudah dimatikan. Public Auth dan penutupan signup sudah terverifikasi, tetapi login/CRUD hosted sesudah upgrade belum diuji dengan akun nyata.

## Pilih tempat menjalankan

| Pilihan | Penggunaan |
|---|---|
| Komputer sendiri | Jalankan Node.js/Next.js secara lokal untuk mencoba login |
| GitHub Codespaces | Jalankan aplikasi pada environment development GitHub dan gunakan tab Ports untuk membukanya |
| Vercel atau host Next.js | Deploy dashboard untuk akses online dengan HTTPS |
| GitHub Pages | Hanya cocok untuk prototipe statis `design/index.html`; tidak menjalankan server actions, cookie server-side, API, dan protected routes aplikasi Next.js ini |

Tidak ada deployment publik atau konfigurasi Pages yang dibuat oleh commit ini.

## Komputer sendiri atau Codespaces

1. Instal Node.js 24 bila menjalankan di komputer sendiri. Pada Codespaces, periksa versi Node terlebih dahulu dan gunakan versi yang kompatibel.
2. Clone/open repositori `Monstercatx11/CRM-Laiora` dan buka terminal pada root repo.
3. Jalankan `npm ci`.
4. Salin `.env.example` menjadi `.env.local` **hanya jika file tersebut belum ada**.
5. Isi Project URL dan publishable key di file lokal tersebut. Jangan memasukkan password akun dashboard atau password database ke variabel ini.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://nhkzxncfbfejbrceuzyb.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=GANTI_DENGAN_PUBLISHABLE_KEY_PROYEK
```

Project URL bersifat publik. Nilai key proyek tidak disertakan dalam repo/paket ini; gunakan key yang sudah diperoleh dari dashboard Supabase. Jangan memakai secret/service_role key.

6. Jalankan `npm run dev`.
7. Di Codespaces, buka aplikasi melalui tab **Ports** untuk port 3000. Pada komputer sendiri, buka alamat yang ditampilkan Next.js di terminal lalu path `/login`.
8. Masuk dengan email/password akun Auth yang sudah dibuat. Uji masuk ke halaman Pesanan, refresh, logout, dan akses langsung halaman setelah logout.

Jangan membuat ulang akun atau menjalankan ulang SQL setup pada proyek yang sudah berhasil dikonfigurasi. Database yang sudah diisi harus dipertahankan.

## Deploy melalui Vercel

1. Hubungkan Vercel ke repo GitHub ini dan pilih framework Next.js.
2. Gunakan Node.js 24 yang kompatibel; root directory adalah root repo.
3. Isi dua environment variables di atas untuk environment deployment yang akan dipakai, sebelum build.
4. Jalankan deployment dan buka `/login` pada domain HTTPS yang diberikan host.
5. Login hanya memakai akun yang terikat pada `laiora_private.app_account`.

Tidak memerlukan service key untuk fitur login dan pembacaan sesi saat ini. Bila host meminta publishable key, jangan memasukkan password database. Perubahan nilai NEXT_PUBLIC umumnya memerlukan rebuild/deploy ulang.

## Jika login tidak berhasil

| Pesan/gejala | Periksa |
|---|---|
| Login belum dikonfigurasi | Dua environment variables telah diisi pada environment yang menjalankan app |
| Email atau password tidak sesuai | Gunakan akun aplikasi pada Supabase Auth, email tepat, password tepat, dan status konfirmasi email sesuai pengaturan |
| Akun ini tidak memiliki akses Laiora | UUID user pada binding `laiora_private.app_account` harus sama dengan akun yang login |
| Akses belum dapat diverifikasi | Koneksi dari host aplikasi ke proyek Supabase, keberadaan RPC `laiora_has_access`, dan migration/policy |
| Selalu kembali ke login | Cookie/sesi, domain HTTPS produksi, dan hasil validasi Auth; gunakan dev server untuk percobaan HTTP lokal |

Jangan mengirim password/token di chat. Error dapat dilaporkan tanpa menyertakan rahasia.

## Pengujian pengembang

```bash
npm run build
npm run typecheck
npm run test:auth
```

Tes auth memulai server Next dan Supabase tiruan lokal, dengan override konfigurasi runtime; tidak menghubungi proyek hosted. Browser Chromium diperlukan; lihat [AUTH_SETUP.md](AUTH_SETUP.md).

Tes fondasi database terpisah:

```bash
npm ci --prefix supabase/tests
npm run test:db
```

File `.env.local`, dependency `node_modules`, hasil build `.next`, dan cache tidak masuk Git. Petunjuk detail: [Auth](AUTH_SETUP.md), [database](../supabase/README.md), [rencana fitur](RENCANA_DASHBOARD_PO.md).
