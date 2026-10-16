# Operasional dashboard Laiora

## Aktivasi versi ini pada proyek yang sudah berjalan

Kode ini menambahkan CRUD order, katalog, pengaturan bisnis/counter, pembayaran dan bukti privat, status produksi/pengiriman, tracking chat, dokumen, serta konektor integrasi.

Proyek Supabase pemilik sudah menjalankan setup001–004 dan binding satu akun. Untuk versi ini:

1. Buka SQL Editor proyek yang sama.
2. Jalankan isi [UPGRADE_OPERASIONAL.sql](../supabase/UPGRADE_OPERASIONAL.sql) **satu kali** dengan akses admin/without RLS. File ini berisi migrasi005–006 dalam satu transaksi. Tabel/order/binding/counter existing dipertahankan.
3. Catat penerapan upgrade manual agar tidak diterapkan ulang melalui CLI. Jangan menjalankan ulang SETUP_LAIORA.sql pada database existing.
4. Pastikan deployment Vercel menggunakan commit versi terbaru pada main. URL dan publishable key yang sudah disimpan tetap digunakan.
5. Login lalu buka **Pengaturan**. Periksa profil bisnis, zona waktu, rekening, harga kartu, serta nomor WhatsApp bisnis.
6. Isi **tahun dan urutan order terakhir yang sudah diverifikasi**. Nomor di snapshot SOP bukan counter otomatis. Nilai existing tidak dapat diturunkan.

Jika UI menampilkan “Database perlu diperbarui”, periksa apakah upgrade005–006 sudah berhasil pada proyek yang sama dengan environment variables Vercel. Menyimpan key baru tidak menggantikan penerapan SQL.

## Membuat order

- Buka **Pesanan → Order baru**.
- Isi manual atau tempel Form Order WhatsApp lalu klik baca form. Hasil parser adalah usulan deterministik dari label form; periksa tanggal, produk, identitas, alamat, dan kartu sebelum menyimpan.
- **Simpan draft** tidak mengambil nomor. Data penting yang hilang tetap ditandai.
- **Konfirmasi PO** memerlukan tanggal dan minimal satu produk serta counter yang sudah diinisialisasi. Harga dan total dihitung ulang di database dari katalog; browser tidak menentukan harga otoritatif.
- Ongkir kosong berarti belum diketahui; isi0 untuk gratis. Subtotal+ongkir belum final tetap dibedakan dari total final.
- Greeting Card Ya dikenai biaya per kartu; Tidak membersihkan blok kartu; Belum dipilih tanpa isi kartu tidak ditagih.
- Teks konfirmasi WhatsApp bisa disalin atau dibuka ke wa.me. Pengiriman tetap dilakukan operator secara eksplisit.

## Revisi, pembatalan, dan pembayaran

- Revisi dari detail order mempertahankan nomor. Item yang sama mempertahankan harga snapshot; produk baru memakai harga aktif.
- Konflik versi akibat edit sesi lain akan ditolak; muat ulang dan bandingkan sebelum menyimpan kembali.
- Pembatalan memerlukan checkbox konfirmasi. Catatan dan pembayaran tetap tersimpan; pembatalan tidak otomatis mencatat refund.
- Status pembayaran dihitung dari pembayaran yang benar-benar dikonfirmasi. Produksi/pengiriman diubah terpisah; PDF tidak membuat pembayaran lunas.
- Pencatatan pembayaran menggunakan requestID untuk retry. Setelah sukses, tombol **Catat pembayaran lain** membuka transaksi baru dengan form kosong.
- Bukti PNG/JPEG/PDF disimpan privat; hanya akun yang diizinkan dapat mengunggah/membaca. Unggah langsung ke Storage dengan URL singkat untuk menghindari batas body Vercel; metadata tetap dilampirkan lewat RPC yang memeriksa kepemilikan path.

## Produksi dan pengiriman

- Produksi merangkum unit fisik per tanggal/produk/ukuran dan instruksi potong. Kartu terpisah dari quantity cake; order batal tidak masuk produksi aktif.
- Pengiriman menampilkan data penerima, alamat, metode, waktu, status, dan Delivery Order.
- Rekap dibatasi agar pembacaan tidak diam-diam terpotong. Jika data terlalu banyak, pilih tanggal untuk mempersempit.

## Dokumen

- Unggah file logo resmi asli di Pengaturan. File “Vintage Blue Boulangerie Emblem(2).png” dan master PDF visual belum diberikan di sesi ini; keduanya tidak direka ulang.
- Logo harus sesuai canvas/transparansi/geometri SOP. Original tersimpan tidak berubah; hitam-putih dibuat hanya untuk hasil cetak.
- PDF100×150mm hanya memuat field operasional yang diizinkan, tanpa harga/kartu/pemesan. Preflight layout menolak overflow/karakter font yang tidak didukung.
- Buka preview dokumen, periksa logo/outline/teks/alamat/notes, lalu setujui unduh. Gunakan contoh asli dan master SOP untuk acceptance visual pertama. Detail di [DELIVERY_ORDER.md](DELIVERY_ORDER.md).

## WhatsApp tanpa VPS

Pemilik belum berencana menyediakan server tambahan. Operasional saat ini menggunakan **link wa.me** dari nomor bisnis dan form/chat yang ditempel manual. Tracking Chat menampilkan pesan yang benar-benar pernah diterima konektor; tidak mengklaim chat masuk sudah direkam ketika service belum terhubung.

Konektor QR nyata telah disiapkan dalam [services/whatsapp-bridge](../services/whatsapp-bridge/README.md), tetapi memerlukan proses Node.js yang terus aktif dan penyimpanan sesi persisten. Vercel tidak menjalankan sesi tersebut secara permanen. Tidak ada QR palsu atau otomatisasi pengiriman pesan pelanggan.

Jika konektor diaktifkan kelak, scan dilakukan pemilik dari Integrasi. Sesi/queue terenkripsi, reconnect/dedup tersedia, grup/broadcast dikecualikan, dan histori lama tidak dijamin lengkap. Kredensial konektor dimasukkan ke hosting secara aman; jangan dikirim di chat/GitHub.

## Tracking Chat

- Pilih percakapan lalu buat/pilih peluang order. Satu pelanggan dapat mempunyai beberapa peluang; order lama tidak otomatis membuat peluang baru Sudah PO.
- Label produk dapat dipilih beberapa sekaligus dan dikoreksi operator.
- Draft tetap Belum PO. Peluang dengan order confirmed menjadi Sudah PO; pembatalan seluruh hubungan aktif membuatnya kembali Belum PO.
- Filter produk/status bekerja pada peluang yang tercatat. Daftar saat ini mencakup200 percakapan terbaru dan100 pesan terakhir per percakapan, dengan batas eksplisit.
- Buat draft dari peluang mengambil identitas/raw chat server-side; data pelanggan tidak ditempel pada query URL. Operator tetap memeriksa hasil parsing.

## Google Sheets tanpa VPS

Kode menyediakan sinkronisasi manual bounded melalui Vercel, serta worker kontinu opsional. Untuk mengaktifkan sinkronisasi live perlu:

1. Aktifkan Google Sheets API pada project Google dan buat service account khusus.
2. Beri alamat service account akses Editor pada spreadsheet tujuan Laiora.
3. Simpan `SUPABASE_SECRET_KEY` dan `GOOGLE_SERVICE_ACCOUNT_JSON` di environment **server Vercel**, bersama `GOOGLE_SPREADSHEET_ID`. Jangan gunakan awalan NEXT_PUBLIC untuk dua rahasia tersebut dan jangan mengirim nilainya di chat.
4. Deploy ulang lalu gunakan **Integrasi → Sinkronkan sekarang**. Setiap request memproses batch terbatas; ulangi sampai antrean kosong. Mode manual tidak menjanjikan sinkron otomatis ketika dashboard ditutup.

Kode hanya menulis tab terkelola berawalan Laiora_ dan memeriksa header, sehingga tab existing lain dipertahankan. Upsert memakai ID/versi, item hasil revisi diberi tombstone, kegagalan dapat dicoba ulang. Data mentah chat dan signedURL bukti tidak disalin ke Sheets.

Worker kontinu tersedia bila kelak diperlukan dan hosting disediakan. Panduan tanpa VPS tersedia di [GOOGLE_SHEETS_VERCEL.md](GOOGLE_SHEETS_VERCEL.md). Detail izin, tab, lease, retry, dan batas sorting bersamaan ada di [panduan Sheets](../services/sheets-worker/README.md).

## Status verifikasi

Database, browser, renderer dan service diuji lokal dengan data sintetis. Hasil hosted Supabase/Vercel, pairing QR asli, logo asli dan Google Sheets hanya boleh disebut berhasil setelah pengujian akun/layanan yang sebenarnya. Kredensial Google/bridge dan logo asli belum tersedia dalam sesi ini.

## Hasil pemeriksaan kode versi ini

- Production build dan TypeScript lulus.
- Database:28 fondasi,32 operasi,15 kontrak worker SQL; pengujian memakai PGlite, bukan sesi PostgreSQL hosted konkuren.
- Browser:12 Auth serta15 alur operasional lulus terhadap API tiruan lokal; mencakup pembuatan/revisi/pembayaran/pembatalan dan approval preview PDF200dpi.
- 24 pemeriksaan domain order;13 tes bridge;18 tes adapter/serverless Sheets; pemeriksaan PDF/raster200dpi dan validasi unggahan lulus.
- File upgrade gabungan diuji mempertahankan order/item/revisi, binding akun, counter, dan file privat existing pada database lokal.
- Endpoint public Auth hosted HTTP200 dan penutupan signup terverifikasi. Pairing QR, logo asli, Google credential, serta CRUD hosted setelah upgrade belum diverifikasi.
