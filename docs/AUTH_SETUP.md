# Supabase Auth dan protected routes Laiora

## Status saat ini

Aplikasi Next.js sudah memiliki login email/password melalui Supabase, logout, refresh cookie server-side, tujuh halaman divisi terlindungi, dan API sesi yang juga memeriksa otorisasi. Style mengikuti konsep krem/biru Laiora. Halaman divisi masih berupa fondasi; CRUD order, chat WhatsApp, dan sinkronisasi Sheets belum dibangun.

Pemilik kini melaporkan setup SQL, akun Auth, binding UUID, dan penutupan signup telah selesai melalui dashboard Supabase. Sesi pengembangan belum memverifikasi login hosted karena kendala jaringan; lihat [status integrasi](STATUS_INTEGRASI.md). Keberhasilan tes lokal dibedakan dari verifikasi hosted.

## Menjalankan aplikasi

Prasyarat Node.js 20.9+ yang kompatibel Next.js (diverifikasi pada Node.js 24). Gunakan Node.js 24 untuk hasil yang sama dengan environment ini.

```bash
cd /workspace/CRM-Laiora
npm ci
cp .env.example .env.local
# Isi .env.local secara lokal atau lewat environment settings yang aman.
npm run dev
```

Jangan menimpa `.env.local` existing; salin template hanya jika file belum ada. Jika cache npm default tidak dapat ditulis, gunakan `npm ci --cache /tmp/laiora-npm-cache`.

Variabel yang diperlukan:

| Nama | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (legacy anon key juga didukung) |

Aplikasi juga menerima `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` sebagai konfigurasi server runtime yang memiliki prioritas di atas dua variabel NEXT_PUBLIC. Jika salah satu variabel runtime diisi string kosong, konfigurasi dianggap belum lengkap; jangan mendefinisikannya kosong bila ingin memakai fallback NEXT_PUBLIC.

Tidak diperlukan secret/service_role key untuk login dan pemeriksaan halaman. Jangan menaruh service_role key pada variabel berawalan NEXT_PUBLIC. Supabase URL HTTPS diperlukan untuk hosted; HTTP hanya diterima untuk host loopback lokal.

Untuk deployment, konfigurasikan dua variabel tersebut **sebelum build** dan pada runtime. Next.js dapat menyertakan variabel NEXT_PUBLIC pada build; perubahan nilai memerlukan rebuild. Gunakan HTTPS untuk deployment karena cookie produksi memakai Secure.

Bila konfigurasi belum ada, halaman login menjelaskan bahwa login belum dikonfigurasi, tombol login dinonaktifkan, route divisi redirect ke login, dan API sesi mengembalikan 503. Aplikasi tidak menggunakan data contoh atau bypass login sebagai fallback.

## Setup proyek Supabase hosted

1. Pilih proyek development yang tepat dan inspeksi schema, history migrasi, serta bucket existing.
2. Terapkan empat migrasi berurutan di `supabase/migrations`, menggunakan panduan [fondasi database](../supabase/README.md). Jangan jalankan fixture Auth/Storage dari tes pada hosted project.
3. Buat satu user aplikasi melalui administrasi Auth dengan email bisnis dan pengelolaan password aman. Jangan membagikan password di repo/chat. Pastikan user siap login sesuai konfigurasi konfirmasi email proyek.
4. Nonaktifkan pendaftaran publik di pengaturan Auth. Aplikasi tidak menyediakan form signup; pengaturan proyek tetap harus dimatikan agar API Auth publik juga tidak mengizinkannya.
5. Bind UUID user tersebut ke singleton `laiora_private.app_account` sebagaimana panduan fondasi. Hanya administrator DB yang melakukan binding. Jangan menggantinya dengan UUID tebakan atau sekadar mengizinkan semua user authenticated.
6. Isi Project URL dan publishable key ke environment aplikasi lalu build/run kembali.
7. Uji sign-in akun terikat, sign-in akun lain ditolak, akses langsung tanpa sesi, refresh, dan logout pada proyek development yang sebenarnya.

Password recovery, magic link, OAuth callback, dan signup belum diimplementasikan. Pemulihan akun sementara dikelola administrator melalui jalur Supabase yang didukung. Site/redirect URL dikonfigurasi jika fitur email redirect ditambahkan kelak.

## Route dan aturan akses

| Path | Kebutuhan |
|---|---|
| `/` | Redirect ke `/dashboard` |
| `/login` | Publik; akun terotorisasi yang sudah login diarahkan ke tujuan internal |
| `/dashboard` | Ringkasan, akun terikat |
| `/pesanan` | Pesanan, akun terikat |
| `/tracking-chat` | Tracking Chat, akun terikat |
| `/produksi` | Produksi, akun terikat |
| `/pengiriman` | Pengiriman, akun terikat |
| `/pembayaran` | Pembayaran, akun terikat |
| `/integrasi` | Integrasi, akun terikat |
| `/api/session` | JSON user minimal untuk akun terikat; 401/403/503 bila tidak memenuhi syarat |

Tidak ada role per divisi. Akun bersama dapat membuka seluruh halaman. Identitas orang yang menggunakan akun bersama tidak dapat dibedakan oleh audit.

Setiap page dan endpoint data memanggil guard server-side, selain pemeriksaan di layout. Tambahan server action/API untuk bisnis di masa depan wajib memanggil guard sendiri; menyembunyikan menu atau bergantung pada layout saja tidak cukup.

## Cara pemeriksaan bekerja

1. `src/proxy.ts` memakai `@supabase/ssr` untuk refresh sesi dan meneruskan cookie yang diperbarui ke server rendering serta browser.
2. `accountAccess()` di `src/lib/auth.ts` memanggil `auth.getUser()` untuk memvalidasi sesi melalui Auth. Cookie/salinan user dari `getSession()` tidak dipakai sebagai bukti identitas.
3. Dengan sesi user itu, aplikasi memanggil RPC `public.laiora_has_access()`. Hasil harus boolean true; error/koneksi gagal ditolak.
4. `requireAccount()` dipanggil di layout dan masing-masing page. `/api/session` melakukan guard independen dengan status HTTP yang sesuai.
5. Login memakai Server Action POST, bukan menaruh password pada URL. Setelah password berhasil, RPC diperiksa sebelum pengguna masuk workspace. Akun tidak terikat dibersihkan sesinya.
6. Redirect `next` hanya menerima tujuh path divisi yang telah ditentukan; URL eksternal, encoded URL, dan route lain jatuh ke `/dashboard`.
7. Cookie sesi HttpOnly, SameSite=Lax, Secure pada produksi. Aplikasi menggunakan server actions/server clients; jangan menambahkan browser Supabase session client tanpa meninjau desain cookie ini.
8. Respons halaman sesi bersifat private/no-store dan guard memakai cache per render React, bukan cache bersama antaruser.
9. Logout adalah Server Action POST, meminta sign-out scope local lalu membersihkan cookie proyek bahkan jika Auth tidak terjangkau. Pemutusan ini untuk sesi/perangkat saat ini; bukan logout global semua perangkat. Access token yang sudah dicuri tidak otomatis kehilangan validitas sebelum expiry/provider menolaknya.

## Pemeriksaan lokal

```bash
cd /workspace/CRM-Laiora
npm run build
npm run typecheck
npm run test:auth
```

Tes auth memasang URL/key server tiruan lewat override server runtime pada proses Next yang diluncurkannya. Override ini tetap berlaku jika build atau .env.local berisi Project URL asli. Pemeriksaan konfigurasi kosong mengisi override runtime dengan string kosong agar gagal tertutup tanpa mengakses proyek. Suite tidak memakai atau mengubah akun/proyek Supabase hosted.

Browser suite membutuhkan Chromium. Jika bukan `/usr/bin/chromium`, sediakan path melalui `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` atau instal browser Playwright sesuai environment.

Hasil terverifikasi:

- Production build dan TypeScript lulus.
- Pemeriksaan konfigurasi kosong: login nonaktif, seluruh tujuh route tertutup, API 503/no-store.
- 11 skenario browser terhadap server Auth/Data API tiruan: semua route anonymous, API anonymous, password salah, akun tidak terikat, akun terikat di tujuh divisi, redirect berbahaya, cookie palsu, refresh sesi kedaluwarsa, kegagalan RPC, logout, serta pemeriksaan request/runtime.
- Tidak ada request browser eksternal atau error runtime browser yang tidak diharapkan pada suite tersebut.

Tes ini memverifikasi integrasi aplikasi dengan bentuk respons Auth/RPC yang ditiru secara lokal. Tetap diperlukan pengujian hosted login, RLS, jaringan, pengaturan signup, dan cookie HTTPS pada deployment sebenarnya.

## Alternatif SQL Editor untuk proyek development baru

File [SETUP_LAIORA.sql](../supabase/SETUP_LAIORA.sql) menggabungkan empat migrasi dalam satu transaksi, tanpa akun Auth atau counter live. Bila belum ada schema/bucket Laiora, administrator dapat menjalankan file ini satu kali melalui SQL Editor. Periksa objek existing terlebih dahulu. Jangan menjalankan file gabungan dan empat migrasi sumber dua kali; catat penerapan manual dan rekonsiliasi migration history sebelum memakai CLI. File gabungan telah menjalani 28 pemeriksaan database lokal yang sama dengan migrasi terpisah.
