# Laiora WhatsApp Linked Devices bridge

Proses Node.js terpisah yang menjaga satu koneksi WhatsApp Business lewat QR,
menulis pesan ke Supabase, dan menyediakan status/QR kepada dashboard yang sudah
login. Tidak ada endpoint pengiriman pesan, CORS publik, akses ke grup/status,
atau unduhan lampiran. Pesan teks dan caption dicatat; media tanpa caption mendapat
penanda jenis media. Balas pelanggan melalui aplikasi WhatsApp Business di ponsel.

Dashboard Next.js tetap di Vercel. **Bridge ini harus berjalan pada server yang
terus hidup dan memiliki disk permanen**, misalnya VPS atau web service dengan
persistent disk. Vercel Functions dan GitHub Pages tidak menjaga sesi ini.

## Sebelum pemasangan

1. Terapkan migrasi database `202610160005_operations.sql` beserta migrasi sebelumnya.
   RPC `laiora_ingest_message` hanya boleh dipanggil oleh `service_role`.
2. Siapkan host Linux dengan Node.js 22/24 LTS, akses HTTPS/WebSocket keluar ke
   WhatsApp dan HTTPS ke domain Supabase proyek. Untuk host yang memakai proxy,
   `HTTPS_PROXY`/`HTTP_PROXY` didukung dan CA/TLS tetap diverifikasi. Ikuti kebijakan
   jaringan host; jangan mematikan TLS atau melewati proxy yang diwajibkan.
3. Buat secret hanya di pengaturan environment server. Jangan memasukkannya ke
   GitHub, browser, log, atau chat.
4. Baileys merupakan integrasi tidak resmi, dapat memerlukan scan ulang atau
   perubahan kompatibilitas dan berisiko akun dibatasi. Histori penuh tidak dijamin.

## Environment bridge

| Variabel | Isi |
|---|---|
| `SUPABASE_URL` | URL proyek HTTPS |
| `SUPABASE_SECRET_KEY` | Secret backend Supabase atau legacy service-role key; bukan publishable key |
| `WHATSAPP_BRIDGE_TOKEN` | Token acak minimal 32 karakter, sama dengan token pada Vercel |
| `WHATSAPP_SESSION_KEY` | Tepat 32 byte acak dalam base64; simpan tetap setelah restart |
| `DATA_DIR` | Path disk permanen privat, misalnya `/var/lib/laiora-whatsapp` |
| `WHATSAPP_ACCOUNT_REF` | Identitas tetap untuk deduplikasi, default `laiora-main`; jangan diganti setelah digunakan |
| `HOST` | Default `127.0.0.1`; gunakan `0.0.0.0` pada managed web service yang memakai ingress HTTPS |
| `PORT` | Default `3100`, atau port yang diberikan platform |

Buat token/key melalui password manager atau `node:crypto` pada host tujuan.
Perintah berikut membuat pasangan baru, hanya untuk disalin ke secret settings
Anda; jangan kirim hasilnya kepada pihak lain:

```bash
node -e "const c = require('node:crypto'); console.log('BRIDGE_TOKEN=' + c.randomBytes(32).toString('hex')); console.log('SESSION_KEY=' + c.randomBytes(32).toString('base64'))"
```

Enkripsi melindungi `auth.enc` dan `messages.enc` di disk dengan AES-256-GCM,
nonce acak dan authenticated associated data. File privat dan penggantian file
atomik disertai fsync. Cadangkan **volume dan kunci asli** dengan kontrol akses;
kunci yang berbeda tidak dapat membuka sesi atau antrean lama. Kehilangan key
memerlukan sesi baru dan dapat membuat antrean lama tidak dapat dipulihkan.

## Install dan jalankan

Dari checkout existing repositori (cloud task sudah terisolasi; tidak perlu Git
worktree baru):

```bash
npm ci --prefix services/whatsapp-bridge
npm test --prefix services/whatsapp-bridge
npm start --prefix services/whatsapp-bridge
```

Atur working directory ke `services/whatsapp-bridge` bila platform memakai root
service. Build command `npm ci`; start command `npm start`; mount persistent disk
ke `DATA_DIR`. Jalankan **satu replika saja**, tanpa autoscaling.

Gunakan process manager/platform restart policy. Pada VPS, jalankan sebagai user
layanan tanpa hak root, dengan direktori data yang dapat ditulis user tersebut.
Buka endpoint melalui HTTPS ingress/reverse proxy. Batasi akses masuk ke dashboard
server bila platform mendukungnya; token bearer tetap wajib pada semua endpoint.
Reverse proxy harus mempertahankan header `Authorization`. Jangan menambah CORS.

Baileys dipin ke `6.7.24`. Paket `libsignal` dipin lewat npm override ke paket resmi
`6.0.0`: `gitHead` publiknya sama dengan commit upstream yang semula di-resolve
Baileys (`bcea72df9ec34d9d9140ab30619cf479c7c144c7`). Ini memakai tarball registry
beserta integrity lockfile dan tidak memerlukan akses Git SSH saat install.

## Environment dashboard Vercel

Tambahkan dua variabel **server-only** berikut lalu redeploy dashboard:

```text
WHATSAPP_BRIDGE_URL=https://domain-bridge-anda.example
WHATSAPP_BRIDGE_TOKEN=<token yang sama dengan bridge>
```

Jangan menambahkan awalan `NEXT_PUBLIC_` pada variabel bridge. URL tidak bisa diisi
pengguna lewat halaman aplikasi. Dashboard hanya menghubungi URL administrator
dan menolak redirect agar token tidak diteruskan ke host lain. HTTP hanya diizinkan
untuk localhost saat pengembangan; deployment harus HTTPS.

## Hubungkan perangkat

1. Login dashboard Laiora → **Integrasi → WhatsApp Business**.
2. Klik **Hubungkan WhatsApp**. QR asli muncul setelah server terhubung.
3. Pada ponsel: WhatsApp Business → Perangkat tertaut → Tautkan perangkat → scan QR.
4. Status berubah menjadi **WhatsApp terhubung**. Kirim satu pesan uji dari nomor
   lain ke nomor bisnis, kemudian buka Tracking Chat dan periksa pencatatannya.
5. Beri label produk/status PO secara manual di dashboard. Bridge tidak membuat
   order, menetapkan harga, mengonfirmasi PO, atau mengirim pesan otomatis.

QR sementara hanya dikirim lewat API dashboard yang memeriksa login/izin akun;
log proses sengaja disaring untuk mencegah library mencetak sesi atau QR. Jangan
menambahkan access logging yang mencatat body/status respons, token, atau QR.

## Antrean dan pemulihan

- Pesan disimpan ke antrean terenkripsi sebelum dicoba ke database. RPC idempoten
  dan deduplikasi account/chat/message ID mencegah pesan ganda saat retry/history.
- Bila Supabase gagal, antrean tetap ada setelah restart dan dicoba tiap 5 detik.
  Dashboard menampilkan jumlah backlog. Pantau disk, backup, dan penurunan backlog.
- Koneksi WhatsApp otomatis dicoba ulang maksimal 5 kali dengan backoff sampai
  30 detik. Setelah itu operator dapat klik Hubungkan lagi.
- Logout dari WhatsApp menghapus kredensial lokal (antrean pencatatan tetap ada).
  Tombol **Putuskan perangkat** juga mencoba logout lalu menghapus sesi lokal.
  Jika host sedang offline saat pemutusan, hapus perangkat dari ponsel juga.
- **QR kedaluwarsa**: tunggu pembaruan QR atau putuskan sesi lalu hubungkan lagi.
- **database_unavailable**: pastikan migrasi, secret backend dan koneksi HTTPS benar.
  Jangan mengganti publishable key menjadi secret pada frontend.
- **storage_error** atau gagal autentikasi enkripsi: proses berhenti memakai socket.
  Periksa disk/key asli. Jangan menghapus data atau membuat key baru secara acak.
- `.writer-lock` mencegah dua proses menulis satu volume. Setelah crash, proses
  gagal tertutup. Pastikan semua proses lama sudah berhenti dan hanya satu replika
  aktif, lalu hapus **hanya direktori `.writer-lock`** sebelum start. Jangan hapus
  `auth.enc`/`messages.enc`. Deploy rolling dengan dua replika harus dinonaktifkan.
- Stop dengan SIGTERM/SIGINT menutup socket tanpa logout, menunggu penulisan,
  melepas lock, dan menyimpan kredensial agar restart dapat tersambung ulang.

Tests menggunakan adapter palsu dan HTTP lokal, tanpa akun pribadi, QR pairing,
WhatsApp API resmi, atau pengiriman pesan pelanggan. Pairing nyata dan verifikasi
ujung ke ujung memerlukan host aktif dan tindakan scan oleh pemilik akun.
