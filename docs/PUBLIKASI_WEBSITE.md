# Publikasi website Laiora Boulangerie

## Halaman publik dan CRM

- `/` menampilkan `public/index.html`, salinan persis HTML yang diunggah pemilik pada 17 Oktober 2026. Gambar tertanam, tautan WhatsApp/marketplace/media sosial, font, dan Meta Pixel dari file asli dipertahankan.
- `/index.html` juga tersedia sebagai alamat langsung file tersebut.
- `/dashboard` tetap menjadi pintu masuk CRM yang memerlukan login.
- Rewrite di `next.config.ts` menyajikan HTML pada `/` tanpa mengubah alamat pengunjung. Halaman pengalihan Next.js lama hanya menjadi fallback jika rewrite dihapus.

Repositori: https://github.com/Monstercatx11/CRM-Laiora, branch `main`.
Proyek Vercel yang sebelumnya dipasang: `crm-laiora`.
Alamat Vercel: https://crm-laiora.vercel.app/.

Push ke `main` memicu deployment otomatis jika integrasi Git Vercel tersebut masih aktif. Periksa **Vercel → crm-laiora → Deployments** dan tunggu status **Ready** untuk commit terbaru. Push Git yang berhasil tidak dengan sendirinya membuktikan deployment berhasil.

## Domain `laioraboulangerie.com`

Domain khusus perlu didaftarkan dan dikelola oleh pemilik. Mengubah file HTML atau nama repositori tidak mengaktifkan domain.

1. Jika belum memiliki domain, daftarkan `laioraboulangerie.com` melalui penyedia domain pilihan setelah memastikan ketersediaan dan biaya.
2. Buka **Vercel → crm-laiora → Settings → Domains → Add Domain**.
3. Masukkan `laioraboulangerie.com` dan hubungkan ke lingkungan **Production**. Tambahkan `www.laioraboulangerie.com` jika ingin menyediakan alamat `www`; pilih pengalihan menuju domain utama.
4. Di pengaturan DNS penyedia domain, buat/perbarui record yang **ditampilkan Vercel untuk proyek ini**. Salin tipe, nama, dan nilainya persis; jangan menebak alamat IP/CNAME. Jika diminta verifikasi kepemilikan, tambahkan TXT yang diberikan Vercel.
5. Pertahankan record email (MX dan TXT email) yang sudah ada. Selesaikan konflik record website hanya untuk hostname yang dihubungkan.
6. Tunggu Vercel menunjukkan **Valid Configuration** dan sertifikat HTTPS aktif. Uji halaman utama serta `/dashboard` pada domain baru.

Sampai domain ditambahkan, DNS diverifikasi, dan HTTPS aktif, gunakan alamat Vercel. Tidak ada domain yang dibeli atau konfigurasi DNS yang diubah oleh penambahan file di repositori ini.

## Verifikasi lokal

Gunakan Node.js 24, jalankan `npm ci`, `npm run build`, lalu `npm start`. Pastikan `/` memberikan HTTP 200 dengan judul `Laiora Boulangerie`, keempat tautan tampil, dan `/dashboard` tetap mengarahkan pengunjung tanpa sesi ke halaman login.
