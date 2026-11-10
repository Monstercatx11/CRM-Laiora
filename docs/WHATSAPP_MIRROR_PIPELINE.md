# Mirror WhatsApp dan pipeline Laiora

Untuk mencoba tanpa server online terlebih dahulu, gunakan [panduan localhost Windows](LOCALHOST_WINDOWS.md).

## Alur penggunaan

Dashboard tetap berjalan di Vercel. Satu konektor Node.js di server online menjadi perangkat tertaut WhatsApp, lalu menyimpan pesan ke Supabase. Tracking Chat membaca pesan tersebut; tombol pembaruan atau polling 15 detik memperbarui tampilannya. Tidak ada WhatsApp Business API resmi dan tidak ada pengiriman pesan otomatis.

1. **Percakapan**: mirror pesan pribadi masuk dan keluar, maksimal 100 pesan terakhir per percakapan dan 200 percakapan terbaru. Balas melalui WhatsApp asli dari tautan yang tersedia. Media tampil sebagai keterangan/caption, bukan salinan file; edit/hapus pesan dan riwayat lengkap belum dicerminkan.
2. Tambahkan **peluang pemesanan** dari percakapan, pilih label produk, dan atur tindak lanjut.
3. **Pipeline**: Baru → Perlu ditinjau → Menunggu data → Selesai ditindaklanjuti. Tahap **Sudah PO** dihitung otomatis hanya jika ada order terkonfirmasi yang terhubung. Tidak wajib melewati semua tahap; selesai ditindaklanjuti tidak otomatis berarti order batal.
4. Gunakan **Ubah tahap** pada kartu, lalu **Pindahkan tahap**. Tombol memperbarui hanya tahap, tanpa menulis ulang label produk atau hubungan order. Kartu belum menggunakan drag-and-drop.
5. **Buat draft PO** membuat draft dari peluang, bukan mengonfirmasi harga/nomor secara otomatis. Satu pelanggan dapat mempunyai beberapa peluang yang berbeda.

Filter nama/nomor, label produk dan status PO berlaku pada pipeline. Pipeline mencakup peluang dari daftar percakapan terbaru tersebut, bukan seluruh arsip chat. Konektor membuat satu peluang awal “Percakapan baru” saat percakapan pertama kali tercatat. Pesan berikutnya tidak membuat kartu tambahan. Tambahkan peluang lain secara manual untuk pemesanan baru dari pelanggan yang sama. Pembaruan otomatis dijeda saat tab tersembunyi, offline atau sedang mengisi form.

## Aktivasi database

Jika migrasi 001–006 sudah terpasang, jalankan isi **`supabase/migrations/202611100007_chat_pipeline.sql`** di Supabase SQL Editor. Migrasi 007 menambahkan fungsi khusus pemindahan tahap dan audit; tidak menghapus atau mengatur ulang data. Aman dijalankan ulang. Jangan mengulang setup awal atau upgrade 005–006 yang sudah terpasang.

## Server online: contoh Render

Server harus terus berjalan dan mempunyai disk permanen. Paket yang tidur atau memakai disk sementara tidak cocok untuk sesi WhatsApp. File **`render.whatsapp.yaml`** adalah blueprint opsional untuk satu web service Node dan disk 1 GB. Ini dapat menimbulkan biaya paket Starter dan disk; periksa harga di Render sebelum membuat resource. Menambahkan file ini ke GitHub tidak membuat atau membeli server.

Jika membuat service secara manual:

- Repository: `Monstercatx11/CRM-Laiora`, branch `main`.
- Root Directory: `services/whatsapp-bridge`.
- Runtime: Node.js 24; Build: `npm ci`; Start: `npm start`.
- Satu instance saja; tidak memakai autoscaling atau deployment dua instance bersamaan.
- Pasang persistent disk `/var/data`; `DATA_DIR=/var/data/laiora-whatsapp`.
- `HOST=0.0.0.0`; gunakan `PORT` yang diberikan platform.
- Atur `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `WHATSAPP_BRIDGE_TOKEN`, `WHATSAPP_SESSION_KEY` pada **Environment/Secrets** service. Cara membuat token dan kunci enkripsi ada di README konektor. Jangan masukkan nilainya ke GitHub atau chat.

Token bridge minimal 32 karakter; kunci sesi harus 32 byte acak dalam base64, dan harus dipertahankan saat restart/deploy. Gunakan backend secret Supabase hanya pada server konektor. Rincian enkripsi antrean, retry, volume lock dan pemulihan: `services/whatsapp-bridge/README.md`.

Setelah server aktif dan memiliki URL HTTPS:

1. Vercel → proyek `crm-laiora` → Environment Variables: `WHATSAPP_BRIDGE_URL` = URL HTTPS server tanpa path; `WHATSAPP_BRIDGE_TOKEN` = token yang sama dengan server. Keduanya server-only, tanpa awalan `NEXT_PUBLIC_`. Redeploy.
2. CRM → Integrasi → Hubungkan WhatsApp.
3. WhatsApp Business di ponsel → Perangkat tertaut → Tautkan perangkat → scan QR.
4. Kirim pesan uji dari nomor lain dan balas dari WhatsApp bisnis. Periksa kedua arah pesan di Tracking Chat, tunggu maksimal interval pembaruan setelah pesan tercatat.
5. Tambahkan peluang, pindahkan tahap, beri label, lalu hubungkan draft/PO. Pastikan hanya PO terkonfirmasi masuk kolom Sudah PO.

Koneksi QR memakai library tidak resmi, sehingga dapat terputus atau perlu scan ulang. History yang diberikan WhatsApp tidak dijamin lengkap. Sinkronisasi sungguhan baru dapat dinyatakan aktif setelah server tersedia, secret terpasang dan pemilik memindai QR; tes lokal memakai adapter dan database uji.
