# Publikasi CRM dan landing page Laiora

## CRM operasional

Repositori `Monstercatx11/CRM-Laiora`, branch `main`, diterbitkan melalui proyek Vercel `crm-laiora`.

- Alamat utama: https://crm-laiora.vercel.app/.
- `/` mengarahkan ke `/dashboard`; pengunjung tanpa sesi diarahkan ke login.
- `/dashboard` dan seluruh halaman operasional tetap memerlukan akun yang diizinkan.
- `/integrasi` adalah halaman pengaturan koneksi WhatsApp dan Google Sheets.
- Tidak ada rewrite halaman utama CRM menuju landing page.

Push ke `main` memicu deployment jika integrasi Git Vercel aktif. Periksa **Deployments → Production** dan pastikan commit terbaru berstatus **Ready/Current**. Push Git tidak membuktikan deployment sudah berhasil atau environment variable sudah benar. Environment Variables yang diubah memerlukan deployment baru.

## Landing page promosi

Landing page dipublikasikan dari repositori **Monstercatx11/LP-LAIORA**, melalui GitHub Pages:
https://monstercatx11.github.io/LP-LAIORA/.

Salinan HTML yang dahulu diunggah disimpan di `design/landing/index.html` sebagai arsip desain, di luar direktori `public` aplikasi CRM. Perubahan file arsip ini tidak menerbitkan ulang situs GitHub Pages. Lakukan perubahan landing page melalui repositori LP-LAIORA.

Jika menggunakan domain pemasaran `laioraboulangerie.com`, daftarkan dan atur domain tersebut pada hosting landing page yang dipilih. Domain harus dimiliki dan DNS-nya dikonfigurasi. Perubahan root CRM ini tidak mengubah domain atau DNS.

## Pemeriksaan

Dengan Node.js 24, jalankan `npm ci`, `npm run build`, dan `npm run test:auth`. Pengujian memastikan root mengarah ke dashboard, pengunjung tanpa sesi masuk melalui login, akun operasional dapat membuka dashboard dari root, dan landing page tidak disajikan dari `/index.html` pada deployment CRM.
