# CRM Laiora — Dashboard PO

Aplikasi Next.js dengan Supabase Auth, satu akun operasional, order/draft/revisi, katalog harga, pembayaran, produksi/pengiriman, tracking chat, pengaturan, dokumen privat, dan konektor integrasi. Aktivasi versi operasional memerlukan migrasi005–006; pairing WhatsApp dan Google Sheets memerlukan konfigurasi layanan yang sesuai.

- **Upgrade dan cara operasional:** [panduan operasional](docs/PANDUAN_OPERASIONAL.md).
- **Mulai menjalankan:** [panduan komputer sendiri, Codespaces, dan deployment](docs/MENJALANKAN_APLIKASI.md).
- **Auth dan konfigurasi:** [setup Supabase Auth](docs/AUTH_SETUP.md).
- **Status setup hosted:** [status integrasi](docs/STATUS_INTEGRASI.md).
- **Desain dan task list:** [rencana dashboard](docs/RENCANA_DASHBOARD_PO.md).

GitHub Pages hanya mendukung prototipe statis. Aplikasi dengan login server-side dijalankan lewat Node.js/Next.js, Codespaces, atau host seperti Vercel.

---

# MASTER SOP & SISTEM PO LAIORA BOULANGERIE

**Versi dokumen gabungan:** 1.0 — 16 Oktober 2026  
**Sumber aturan aktif:** MASTER SOP LAIORA ORDER v1.0, versi tersimpan 39  
**Revisi template Delivery Order:** 8 Oktober 2026  
**Berlaku mulai:** 7 Oktober 2026  
**Project:** Laiora Boulangerie  
**Fungsi:** Single Source of Truth untuk pengolahan Form Order WhatsApp, Order Confirmation, perhitungan harga, nomor order, dan Delivery Order PDF.

---

## 1. Tujuan

SOP ini menjadi acuan utama untuk semua order Laiora Boulangerie di Chat maupun Work. Tujuannya adalah menjaga format, harga, nomor order, normalisasi data, dan Delivery Order PDF tetap konsisten meskipun percakapan berpindah dari Chat ke Work atau order direvisi di kemudian hari.

### Urutan prioritas sumber data
1. Instruksi terbaru dan eksplisit dari user pada order/revisi yang sedang dikerjakan.
2. Koreksi eksplisit user terhadap order tersebut.
3. MASTER SOP LAIORA ORDER ini.
4. Data order sebelumnya di Project untuk order yang sama.
5. Inferensi hanya untuk normalisasi yang aman. Jangan mengarang data penting seperti alamat, nomor HP, biaya kirim, tanggal, atau pilihan kartu ucapan.

Jika ada konflik, gunakan data terbaru. Jika data lama yang ditempel user bertentangan dengan revisi yang sudah dikonfirmasi sebelumnya, pertahankan revisi terakhir kecuali user secara eksplisit membatalkannya.

---

## 2. Snapshot Operasional

- Format nomor order: `YY-####`.
- Order baru terakhir saat SOP v1.0 dibuat: `26-0345`.
- Nomor order baru berikutnya saat SOP v1.0 dibuat: `26-0346`.
- Snapshot per 16 Oktober 2026: order baru terakhir `26-0379`; nomor order baru berikutnya `26-0380`. Periksa ulang status terbaru sebelum digunakan pada hari berikutnya.
- Revisi layout order `26-0346` pada 8 Oktober 2026 tidak mengubah sequence tersebut.
- Revisi, reprint, atau permintaan PDF ulang TIDAK menaikkan nomor order.
- Logo Delivery Order resmi terbaru: gambar upload `Vintage Blue Boulangerie Emblem(2).png`.
- Logo baru tersebut menggantikan logo hasil ekstraksi/template lama untuk semua Delivery Order berikutnya.

> Catatan: setelah setiap order baru dibuat, nilai “nomor order berikutnya” harus ikut diperbarui secara operasional.

---

## 3. Alur Standar Setiap Order

1. Baca raw Form Order dari WhatsApp.
2. Normalisasi nama, nomor HP, produk, ukuran, jumlah, tanggal, alamat, metode kirim, dan catatan.
3. Tentukan apakah ini order baru atau revisi.
4. Tentukan nomor order.
5. Hitung harga produk, kartu ucapan jika terkonfirmasi, delivery, subtotal, dan grand total.
6. Tampilkan Normalized Form Order.
7. Tampilkan Order Confirmation.
8. Buat Delivery Order PDF dengan template terkunci.
9. Render/cek visual PDF sebelum diberikan.
10. Berikan link PDF.

Jika user hanya meminta revisi PDF/reprint/PDF saja, tidak perlu mengulang seluruh Form Order dan Order Confirmation kecuali diminta.

---

## 4. Aturan Nomor Order

### Order baru
- Format: `YY-####`.
- Naik satu angka dari order baru terakhir.
- Contoh setelah `26-0345`, order baru berikutnya adalah `26-0346`.

### Revisi / reprint
Nomor order harus tetap sama apabila user menyebut atau konteks jelas menunjukkan:
- revisi,
- perbaikan,
- ganti tanggal/alamat/nomor HP/produk,
- “order yang sama”,
- “buat ulang PDF”,
- “PDF saja”,
- “tolong perbaiki delivery order ini”.

### Order historis / nomor lama
Permintaan PDF untuk order lama atau nomor yang tidak berurutan tidak mengubah sequence order baru.

---

## 5. Normalisasi Form Order

Gunakan format berikut:

```text
[Form Order]

NAMA PEMESAN:
NO HP:
PRODUCT:
- @qty Product (Size)
QUANTITY:
DELIVERY DATE:

*******
Greeting Card: Ya / Tidak
(additional IDR 5,000/card)

From:
To:
Message:

*******

NAMA PENERIMA:
ALAMAT KIRIM:
No HP:
NOTES:
```

### 5.1 Greeting Card
- Jika eksplisit `Tidak`: hapus seluruh blok Greeting Card dari Form Order hasil normalisasi.
- Jika eksplisit `Ya`: tampilkan blok dan charge Rp5.000 per card. Jika tidak ada pilihan eksplisit tetapi From/To/Message jelas diisi, perlakukan sebagai kartu yang diminta. Pilihan eksplisit `Tidak` selalu mengalahkan isi From/To/Message lama.
- Jika masih `Ya / Tidak`, tidak dipilih, atau ambigu: tulis `Greeting Card: Belum dipilih`, jangan charge Rp5.000.
- Greeting Card tidak dihitung sebagai quantity produk.

### 5.2 Nama dan nomor HP
- Rapikan kapitalisasi nama.
- Nomor Indonesia default dinormalisasi ke format `0...` tanpa spasi atau tanda hubung.
- `+62` dapat dikonversi menjadi `0` untuk konsistensi internal.
- Jika penerima tertulis `sama`, gunakan nama pemesan dan nomor HP pemesan.
- Jika nomor pemesan kosong tetapi penerima jelas orang yang sama dan nomor penerima tersedia, boleh backfill nomor pemesan.
- Jika benar-benar tidak ada data: `Belum diisi`.

### 5.3 Tanggal
- Gunakan format: `Hari, D Bulan YYYY`.
- Cocokkan nama hari dengan kalender pada tahun order; jika user menulis hari yang salah, koreksi hari berdasarkan tanggal sebenarnya.
- Jika tanggal belum ada, minta tanggal sebelum menetapkan nomor order baru. Frasa relatif seperti `hari ini` mengacu pada tanggal lokal pengguna.
- Jika user menyebut siang/sore/pagi, pertahankan sebagai keterangan, contoh: `Jumat, 9 Oktober 2026 (Siang)`.
- Jangan mengubah bulan jika tidak ada dasar yang kuat; untuk typo kritis yang memengaruhi order, konfirmasi jika perlu.

### 5.4 Quantity
- Quantity = jumlah fisik seluruh produk.
- Jika quantity tertulis tidak sesuai dengan daftar produk, koreksi ke jumlah produk yang benar.
- Greeting Card tidak masuk quantity.

### 5.5 Penerima dan alamat
- `Sama` berarti gunakan data pemesan.
- Jika alamat/penerima/nomor tidak tersedia, gunakan `Belum diisi`, jangan mengarang.
- Rapikan alamat tanpa menghilangkan informasi penting seperti blok, nomor, RT/RW, tower, unit, landmark, lantai, lobby, dan instruksi driver.
- Landmark atau instruksi khusus diletakkan di NOTES.

### 5.6 Pengiriman
Normalisasi istilah:
- Grab instan -> `Grab Instant`
- Grab sameday -> `Grab Same Day`
- Paxel sameday -> `Paxel Same Day`
- Pick up / pick up sendiri / puck up -> `Pick Up`
- Drop off -> `Drop Off`
- Shopee -> `Pengiriman via Shopee`

Jika penerima memesan Grab sendiri, delivery = Rp0 dan notes: `Penerima yang memesan Grab`.

---

## 6. Normalisasi Nama Produk

### Brownies
- brownies ori / origin -> `Brownies Original`
- choco chips classic brownies -> `Brownies Choco Chips`
- ferero -> `Brownies Ferrero Rocher`
- ovo / ovalmatine / ovamaltine -> `Brownies Ovomaltine`
- ukuran 18x10 -> `Personal`
- jika ukuran tidak disebut, default `Regular`, kecuali konteks jelas menunjukkan Personal.

### Bolu Jadul
- bolu jadul mix / choco cheese / keju n meses / ceres n keju / coklat keju -> `Bolu Jadul Choco Cheese`
- bolu coklat -> `Bolu Jadul Full Choco` untuk Regular, atau `Bolu Jadul Choco` untuk Personal.
- full cheese -> `Bolu Jadul Full Cheese` untuk Regular.
- bolu cheese personal -> `Bolu Jadul Cheese (Personal)`.
- ukuran 9x9 -> `Personal`.
- ukuran 20x20 -> `Regular`.
- jika ukuran tidak disebut, default `Regular`.

### Potong
`Brownies Original (Potong 9)` berarti 1 cake regular yang dipotong menjadi 9, bukan quantity 9.

---

## 7. Pricelist Aktif

### Regular 20x20
| Produk | Harga |
|---|---:|
| Brownies Original | Rp130.000 |
| Brownies Choco Chips | Rp140.000 |
| Brownies Almond | Rp154.000 |
| Brownies Ferrero Rocher | Rp185.000 |
| Brownies Ovomaltine | Rp185.000 |
| Bolu Jadul Choco Cheese / Mix | Rp115.000 |
| Bolu Jadul Full Choco / Chocolate | Rp115.000 |
| Bolu Jadul Full Cheese / Cheese | Rp115.000 |
| Bolu Jadul Regular generic | Rp115.000 |

### Personal
| Produk | Harga |
|---|---:|
| Brownies Original | Rp65.000 |
| Brownies Choco Chips | Rp70.000 |
| Brownies Almond | Rp75.000 |
| Brownies Ferrero Rocher | Rp90.000 |
| Brownies Ovomaltine | Rp93.000 |
| Bolu Jadul Choco / Chocolate | Rp30.000 |
| Bolu Jadul Cheese | Rp30.000 |

### Tambahan
- Greeting Card: Rp5.000/card.
- `Small Hampers Bolu Cheese Isi 1 = Rp9.000/pcs` adalah harga historis khusus dan **bukan harga default**; gunakan hanya jika user secara eksplisit merujuk promo/order khusus tersebut.

### Mixed Brownies
Jika user meminta mixed brownies dalam satu box dan sudah ada ketentuan bahwa harga mengikuti komponen termahal:
- Mix Ovomaltine x Almond Regular = Rp185.000
- Mix Almond + Original Regular = Rp154.000
- Mix Almond x Choco Chips Regular = Rp154.000

---

## 8. Perhitungan Harga

### Subtotal
`Subtotal = total produk + Greeting Card yang sudah dikonfirmasi Ya`

### Delivery
- Tulis terpisah dari subtotal.
- Pick Up / Drop Off / free delivery / penerima memesan courier sendiri = Rp0 kecuali user menyebut fee lain.
- Jika delivery belum diketahui, tulis:
  - `Delivery price:` kosong, dan
  - `GRAND TOTAL= Rp[Subtotal] + Delivery price`.

### Grand Total
`Grand Total = Subtotal + Delivery price`

Selalu hitung ulang aritmetika. Jangan mengikuti total lama jika produk/harga/fee sudah direvisi.

---

## 9. Format Order Confirmation WhatsApp

Gunakan format berikut secara konsisten:

```text
*Order No. 26-xxxx*

Thank you for your order!

NAMA PEMESANAN:
NO HP:
PRODUCT:
- @qty Product = Rp...

_*Subtotal= Rp..._

QUANTITY:
DELIVERY DATE:

Delivery price: Rp...

*GRAND TOTAL= Rp...*

Kindly transfer to:
5390823845
BCA a/n Yohanes
(Mohon isi no. order di kolom berita)

We hope to create more sweet moments for you soon!


Laiora Boulangerie
#Magical in every bite#
```

### Aturan khusus
- Baris Order No. menggunakan literal asterisk bold WhatsApp.
- Subtotal: format persis `_*Subtotal= Rp..._`.
- Grand total: format persis `*GRAND TOTAL= Rp...*`.
- Bank default: BCA 5390823845 a/n Yohanes.
- Shopee-specific order boleh menggunakan `Order via Shopee` jika transaksi memang melalui Shopee dan tidak membutuhkan transfer bank.

---

## 10. Delivery Order PDF — TEMPLATE TERKUNCI

### 10.1 Ukuran halaman
- Portrait 100 x 150 mm.
- `PAGE_W = 283.4646 pt`
- `PAGE_H = 425.1969 pt`

### 10.2 Outline / border
- x = `14.17323`
- y = `14.17328`
- width = `255.11809`
- height = `396.8504`
- line width = `0.8 pt`

Outline tidak boleh bergeser antar order.

### 10.3 Logo resmi terbaru dan warna — revisi 8 Oktober 2026
Gunakan **gambar asli yang di-upload user**:
`Vintage Blue Boulangerie Emblem(2).png`.

Konfigurasi terbaru pada 8 Oktober 2026 mengikuti permintaan user agar logo diberi ruang yang lebih lega dari outline atas dan tulisan Delivery Order. Kedua jarak ditetapkan 3 mm pada revisi terbaru ini untuk seluruh Delivery Order berikutnya:
- Semua elemen PDF hanya hitam dan putih, termasuk logo, teks, dan outline.
- Logo diperbesar 10% dari ukuran pada template sebelumnya.
- Logo dan seluruh tulisan dipindahkan ke atas. Alignment horizontal, font, ukuran font, dan line spacing tetap mengikuti template.
- Jarak dari tepi dalam outline atas ke bagian logo yang terlihat: **3 mm**.
- Jarak dari bagian bawah logo yang terlihat ke bagian atas tulisan `[Delivery Order]` yang terlihat: **3 mm**.
- Ukuran halaman tetap 100 x 150 mm dan outline tetap mengikuti bagian 10.2.

**Aturan logo:**
- Pertahankan seluruh canvas asli 1536 x 1024 px, aspect ratio 3:2, tanpa crop atau stretch.
- Jangan menggambar ulang, mengganti logo, atau menggunakan AI untuk membuat ulang logo.
- File logo sumber tidak diubah. Khusus hasil cetak PDF, gunakan tinta hitam dan latar transparan; untuk keluaran hitam-putih gunakan alpha >= 128 sebagai tinta hitam opak dan alpha < 128 sebagai transparan.
- Bounding box tinta hitam hasil render di canvas asli: `(38, 73, 1499, 976)` px. Bounding box ini hanya untuk mengukur posisi, **bukan untuk crop gambar**.
- Seluruh logo yang terlihat harus berada di dalam outline, centered secara horizontal, dan tidak terpotong.

**Geometri aktif (ReportLab/PDF, origin kiri bawah):**
- Lebar canvas logo: `143.433081 pt`.
- Tinggi canvas logo: `95.622054 pt`.
- x canvas logo: `70.0157595 pt`.
- y canvas logo: `313.3144955761 pt`.
- Scale uniform: `143.433081 / 1536` pt per px.
- Jarak 3 mm = `8.5039370079 pt`.
- Perhitungan jarak outline memperhitungkan setengah stroke 0,8 pt = 0,4 pt.
- Bagian kosong/transparan canvas boleh melewati area outline; tidak ada bagian logo yang terlihat yang boleh melewati outline. Seluruh gambar tetap dimuat tanpa crop.

Master visual aktif: `Delivery_Order_26-0346_Yolanda_Leonard_jarak3mm.pdf` untuk order `26-0346` (Yolanda Leonard), hitam-putih, 8 Oktober 2026. Kedua jarak aktif adalah 3 mm (0,3 cm).

### 10.4 Posisi teks — revisi 8 Oktober 2026
- text x = `28.34646`.
- right boundary sekitar `255.1`.
- `[Delivery Order]`: Helvetica-Bold 12 pt, baseline `300.4008416743 pt` dari bawah halaman.
- `Order No.`: Helvetica-Bold 10.5 pt, baseline `286.8613416743 pt` dari bawah halaman.
- body mulai `272.1680416743 pt` dari bawah halaman.
- Seluruh baseline teks bergeser ke atas `29.4911416743 pt` dari template sebelumnya; jarak relatif antarteks dipertahankan.
- Bagian atas tinta header berada 3 mm di bawah tinta logo. Ascent tinta untuk string `[Delivery Order]` pada Helvetica-Bold 12 pt = `8.8920006752 pt`.
- label body: Helvetica-Bold 9.5 pt.
- value body: Helvetica 9.5 pt.
- line spacing body: 12 pt.
- alamat dan notes panjang wajib wrap sebelum right boundary.
- Teks dan isi order tetap mengikuti bagian 10.5-10.6; revisi layout tidak mengubah data order.

### 10.5 Isi Delivery Order
Hanya tampilkan:

```text
[Delivery Order]
Order No. 26-xxxx

NAMA PENERIMA:
NO HP:
PRODUCT:
- @qty Product (Size)
QUANTITY:
DELIVERY DATE:
ALAMAT KIRIM:
NOTES:
```

Jangan tampilkan:
- nama pemesan,
- Greeting Card,
- From/To/Message kartu,
- harga produk,
- subtotal,
- grand total,
- nominal delivery fee.

### 10.6 Notes pengiriman di PDF
Gunakan hanya metode/instruksi, tanpa harga:
- `- Pengiriman Grab Instant`
- `- Pengiriman Grab Same Day`
- `- Pengiriman Paxel Same Day`
- `- Pengiriman Grab`
- `- Pengiriman via Shopee`
- `- Penerima yang memesan Grab`
- `- Pick Up`
- `- Drop Off`
- Jika metode tidak ada: `- Detail pengiriman belum dicantumkan`

Untuk Pick Up/Drop Off, alamat PDF default dapat ditulis `Pick Up`/`Drop Off` jika tidak ada kebutuhan operasional untuk menampilkan alamat lain. Jika user secara eksplisit meminta alamat tetap dicantumkan, ikuti instruksi user.

### 10.7 Quality check wajib
Sebelum link PDF diberikan:
1. Generate PDF.
2. Render ke PNG minimal 180–200 dpi.
3. Cek visual:
   - logo tidak terpotong,
   - proporsi logo benar,
   - logo tetap center,
   - logo diperbesar 10%, seluruh desain hitam-putih,
   - kedua jarak (outline atas ke tinta logo dan tinta logo ke tinta header) 3 mm,
   - outline tidak bergeser,
   - teks tidak keluar garis,
   - alamat/notes wrap rapi,
   - ukuran halaman 100x150 mm,
   - tidak ada fee pengiriman di PDF.
4. Jika ada defect, perbaiki dan render ulang.
5. Baru berikan link file.

---

## 11. Aturan Revisi Order

Saat user merevisi order:
- Pertahankan Order No.
- Ubah hanya field yang direvisi.
- Pertahankan koreksi lama yang sudah dikonfirmasi, walaupun user menempel template lama yang masih berisi data sebelum revisi.
- Hitung ulang subtotal dan grand total jika produk/qty/card/delivery berubah.
- Regenerate PDF menggunakan Order No. yang sama.
- Nama file boleh diberi suffix `_revisi` jika membantu, tetapi nomor order di dokumen tidak berubah.

Jika user meminta `PDF saja`, balas singkat dengan link PDF.

---

## 12. Response Style di Chat / Work

### Default order baru
Tampilkan dalam urutan:
1. Normalized `[Form Order]` dalam code block.
2. `Order Confirmation` dalam code block.
3. Teks `Delivery Order PDF:` + link file.

### Gaya komunikasi
- Ringkas.
- Tidak perlu menjelaskan setiap normalisasi kecil.
- Jangan banyak bertanya jika data dapat dinormalisasi aman.
- Tanyakan konfirmasi hanya jika ambiguitas memengaruhi harga, tanggal penting, tujuan kirim, atau identitas penerima secara material.
- Jangan menambahkan plain-text Delivery Order di chat; Delivery Order diberikan sebagai PDF.

---

## 13. Aturan Penting untuk Work Mode

Saat membuat Work baru di Project Laiora Boulangerie, gunakan instruksi awal berikut:

```text
Gunakan MASTER SOP LAIORA ORDER sebagai Single Source of Truth untuk seluruh order Laiora Boulangerie. Lanjutkan sequence nomor order dari status terakhir di Project. Untuk setiap order baru: normalisasi Form Order, hitung harga sesuai pricelist, buat Order Confirmation WhatsApp, lalu generate Delivery Order PDF 100x150 mm memakai logo resmi terbaru yang di-upload user dengan aspect ratio dipertahankan. Revisi harus mempertahankan nomor order. Jangan mengarang data yang tidak tersedia. Sebelum memberikan PDF, lakukan render dan visual QA untuk memastikan logo, outline, posisi, ukuran, dan wrapping tetap sesuai template.
```

### Cara menjaga kontinuitas
- Jangan hapus chat order lama dari Project.
- Simpan SOP ini sebagai file Project.
- Semua update harga, logo, format, dan aturan baru harus ditambahkan ke SOP atau dijadikan instruksi eksplisit yang menggantikan bagian terkait.
- Untuk order lama/revisi, cari konteks order tersebut di Project sebelum membuat ulang file.

---

## 14. Checklist Cepat Sebelum Mengirim Hasil

- [ ] Order baru atau revisi sudah ditentukan.
- [ ] Nomor order benar dan tidak loncat karena reprint.
- [ ] Nama/HP/alamat dinormalisasi tanpa mengarang.
- [ ] Product naming dan size benar.
- [ ] Quantity sesuai jumlah produk fisik.
- [ ] Greeting Card rule benar.
- [ ] Harga produk sesuai pricelist.
- [ ] Subtotal benar.
- [ ] Delivery fee benar.
- [ ] Grand total benar.
- [ ] Hari/tanggal cocok kalender.
- [ ] Delivery Order tidak memuat harga/fee/card.
- [ ] Logo resmi terbaru digunakan.
- [ ] Logo tidak crop/stretch.
- [ ] PDF 100x150 mm.
- [ ] Outline dan posisi konsisten.
- [ ] Render QA selesai.
- [ ] Link file valid.

---

---

## 15. Konsep Sistem PO (Pre-Order)

PO dalam dokumen ini berarti **pre-order pelanggan**, dari form masuk sampai pesanan selesai diserahkan. Bagian 1–14 adalah aturan operasional yang sudah digunakan. Bagian 15–23 adalah rancangan sistem untuk menerapkan aturan tersebut secara terstruktur; dokumen ini tidak berarti aplikasi, notifikasi, atau integrasi pembayaran sudah dibangun.

### 15.1 Tujuan sistem

- Sekali input form, data dipakai kembali untuk konfirmasi, produksi, dan Delivery Order.
- Harga, quantity, ongkir, dan total dihitung dari data yang sama.
- Setiap order memiliki satu identitas dan riwayat revisi.
- Tim dapat melihat kebutuhan produksi berdasarkan tanggal kirim, produk, dan ukuran.
- Data pembayaran, produksi, serta pengiriman dapat dipantau terpisah.

### 15.2 Alur utama

1. **Form masuk:** simpan teks asli dan waktu penerimaan.
2. **Normalisasi:** rapikan data sesuai bagian 5–6.
3. **Validasi:** periksa tanggal, rincian produk, quantity, identitas, dan data yang masih kurang.
4. **Penomoran:** order baru memperoleh nomor berikutnya; revisi memakai nomor lama.
5. **Perhitungan:** ambil harga aktif dan simpan harga satuan yang dipakai pada order.
6. **Dokumen:** buat Form Order rapi, Order Confirmation, dan Delivery Order PDF.
7. **Pembayaran:** catat berdasarkan bukti atau konfirmasi nyata.
8. **Produksi:** masukkan produk ke rekap tanggal kirim, lalu catat progres.
9. **Packing dan serah terima:** cocokkan barang, penerima, kartu, serta instruksi kirim.
10. **Selesai:** catat waktu penyerahan dan simpan riwayat.

Tanyakan hanya data yang berpengaruh material. Data yang belum tersedia tetap ditandai; jangan mengarang untuk melengkapi tampilan.

---

## 16. Struktur Data Sistem

### 16.1 Data order

| Field | Isi / aturan |
|---|---|
| order_id | ID internal tetap; berbeda dari nomor order tampilan |
| order_no | Format YY-####; unik |
| revision_no | Dimulai dari 0, bertambah pada revisi yang tersimpan |
| created_at / updated_at | Waktu pencatatan dan pembaruan |
| raw_form | Form asli untuk penelusuran |
| channel | WhatsApp / Shopee / lainnya sesuai data |
| sender_name / sender_phone | Nama dan nomor pemesan |
| recipient_name / recipient_phone | Nama dan nomor penerima |
| delivery_date | Tanggal kalender pengiriman |
| delivery_time_note | Jam kirim, request tiba, atau keterangan secepatnya |
| address | Alamat lengkap; kosong jika secara eksplisit diminta |
| shipping_method | Grab Instant / Grab Same Day / Paxel Same Day / lainnya |
| shipping_fee | Angka rupiah; null jika belum diketahui, 0 jika gratis |
| operational_notes | Landmark dan instruksi tanpa menghilangkan detail |
| greeting_card_choice | Ya / Tidak / Belum dipilih |
| greeting_card_qty | Jumlah kartu yang dikonfirmasi |
| card_from / card_to / card_message | Isi kartu sesuai input |
| product_quantity | Jumlah unit fisik produk |
| subtotal / grand_total | Hasil perhitungan; grand_total belum final bila ongkir null |
| payment_status | Status pembayaran berdasarkan bukti |
| production_status | Status pengerjaan |
| fulfillment_status | Status pengiriman / pengambilan |
| missing_fields | Daftar data yang belum lengkap |
| confirmation_file / delivery_pdf | Referensi hasil dokumen |
| revision_history | Catatan perubahan, alasan, dan waktu |

### 16.2 Detail produk per order

| Field | Isi / aturan |
|---|---|
| product_name | Nama produk standar |
| size | Personal / Regular / ukuran eksplisit lain |
| quantity | Jumlah unit fisik |
| unit_price | Harga satuan yang berlaku pada saat dipakai |
| line_total | quantity × unit_price |
| cutting_note | Misalnya Potong 9; tidak mengubah quantity cake |
| item_note | Instruksi khusus untuk produk tersebut |

Harga satuan yang dipakai disimpan bersama order. Perubahan pricelist berikutnya tidak otomatis mengubah transaksi lama; koreksi harga pada order lama mengikuti instruksi eksplisit.

### 16.3 Pisahkan nilai kosong dan nol

- **Ongkir belum diketahui:** null; total ditulis subtotal + Delivery price.
- **Ongkir gratis:** 0; grand total dapat dihitung final.
- **Data belum diberikan:** tandai Belum diisi pada tampilan yang relevan.
- **Alamat sengaja dikosongkan:** tetap kosong dan simpan alasan instruksi.
- **Pembayaran belum dikonfirmasi:** jangan ditandai lunas.

---

## 17. Status Order yang Diusulkan

Gunakan status terpisah agar pembayaran tidak tercampur dengan pekerjaan dapur atau pengiriman.

| Kelompok | Status | Kapan digunakan |
|---|---|---|
| Kelengkapan | Perlu dilengkapi | Ada data penting yang belum tersedia |
| Kelengkapan | Lengkap | Data operasional sudah cukup |
| Pembayaran | Belum dikonfirmasi | Belum ada bukti / konfirmasi pembayaran |
| Pembayaran | DP | Pembayaran sebagian sudah terkonfirmasi |
| Pembayaran | Lunas | Seluruh tagihan sudah terkonfirmasi |
| Produksi | Belum dijadwalkan | Belum masuk jadwal dapur |
| Produksi | Terjadwal | Sudah masuk rencana produksi |
| Produksi | Diproduksi | Sedang dikerjakan |
| Produksi | Siap dikemas | Produk selesai dibuat |
| Produksi | Siap diserahkan | Packing dan pemeriksaan selesai |
| Pemenuhan | Menunggu | Belum diserahkan |
| Pemenuhan | Dalam pengiriman | Sudah diserahkan kepada kurir |
| Pemenuhan | Sudah diambil | Sudah diserahkan untuk Pick Up |
| Pemenuhan | Selesai | Penyelesaian sudah dicatat |
| Order | Dibatalkan | Ada instruksi pembatalan yang jelas |

Jangan menandai pembayaran, produksi, atau pengiriman selesai hanya karena PDF sudah dibuat. Batas DP, cutoff, kapasitas produksi, refund, serta syarat pembayaran perlu ditetapkan pemilik bila ingin dijadikan kebijakan; dokumen ini tidak menetapkan angka atau kebijakan baru.

---

## 18. Sistem Revisi dan Penomoran

### 18.1 Revisi

1. Temukan order berdasarkan nomor atau konteks yang jelas.
2. Baca versi terbaru order tersebut.
3. Terapkan hanya perubahan yang diminta.
4. Pertahankan field lain dan koreksi sebelumnya.
5. Hitung ulang harga bila produk, ukuran, jumlah, kartu, atau ongkir berubah.
6. Buat ulang dokumen yang terdampak dengan nomor order tetap.
7. Simpan ringkasan perubahan serta versi sebelumnya untuk penelusuran.
8. Jika perubahan menyentuh jadwal atau isi produksi, perbarui rekap dapur juga.

### 18.2 Nomor unik dan pencegahan duplikasi

- Nomor baru digunakan hanya untuk transaksi baru yang jelas.
- Permintaan ulang PDF tidak membuat order baru.
- Form yang sama dikirim ulang tidak otomatis dianggap transaksi baru.
- Nama dan tanggal yang sama masih mungkin merupakan order berbeda; gunakan konteks dan rincian produk.
- Jika sistem dipakai banyak admin, penetapan nomor harus dilakukan dalam satu transaksi terpusat agar dua admin tidak memperoleh nomor yang sama.
- Snapshot nomor pada dokumen ini bukan penghitung permanen; data order terbaru menjadi acuan.

### 18.3 Contoh revisi

> Order 26-0379: ukuran kedua brownies diubah dari Regular menjadi Personal. Nomor tetap 26-0379, quantity tetap 2, harga dihitung ulang. Nomor order baru berikutnya tetap 26-0380.

---

## 19. Rekap Operasional

### 19.1 Rekap harian order

Kolom minimum:

| Order No. | Tanggal kirim | Pemesan | Penerima | Produk / ukuran | Qty | Kurir | Jam / catatan | Pembayaran | Produksi | Pemenuhan |
|---|---|---|---|---|---:|---|---|---|---|---|
| YY-#### | Hari, tanggal | Nama | Nama | Daftar produk | 0 | Metode | Instruksi | Status | Status | Status |

Tabel di atas adalah struktur kosong, bukan order nyata.

### 19.2 Rekap produksi

Kelompokkan berdasarkan:

1. Tanggal kirim.
2. Produk.
3. Ukuran.
4. Total unit fisik.
5. Kebutuhan potong, kartu, dan packing khusus.

Contoh: satu Brownies Original Regular Potong 9 dihitung satu cake untuk produksi, dengan instruksi potong 9. Kartu tidak ditambahkan ke quantity cake.

Gunakan versi terbaru setiap order dan keluarkan order batal dari kebutuhan produksi aktif. Jangan menjumlahkan versi lama dan versi revisi.

### 19.3 Rekap pengiriman

Tampilkan nomor order, penerima, nomor HP, alamat, metode kirim, request waktu, dan instruksi driver. Nilai ongkir tetap berada pada rekap administrasi; Delivery Order PDF mengikuti larangan harga pada bagian 10.

### 19.4 Rekap pembayaran

Tampilkan subtotal, kartu, ongkir, total tagihan, pembayaran terkonfirmasi, dan sisa tagihan. Total yang ongkirnya belum diketahui ditandai belum final. Jangan menganggap nilai yang belum diisi sebagai nol.

---

## 20. Cara Mempercepat Input Order

### 20.1 Prinsip kerja

- Satu data order menjadi sumber untuk semua hasil.
- Gunakan kamus normalisasi produk dan kurir.
- Gunakan pricelist terstruktur agar harga tidak diketik ulang.
- Gunakan template PDF aktif yang sama; ganti hanya isi order.
- Gunakan pemeriksaan otomatis untuk aritmetika, quantity, ukuran halaman, field terlarang, dan teks keluar batas.
- Tetap render dan cek visual PDF sebelum dikirim.
- Pada revisi, proses hanya dokumen dan rekap yang terdampak.
- Jangan meminta konfirmasi ulang untuk keputusan yang sudah jelas di form.

Langkah tersebut adalah cara mempercepat proses; tidak ada janji waktu tetap karena durasi bergantung pada kelengkapan data dan proses pembuatan dokumen.

### 20.2 Template input ringkas

```text
[Form Order]

NAMA PEMESAN:
NO HP:
PRODUCT:
- @1 Nama Produk (Personal / Regular)
DELIVERY DATE:

Greeting Card: Ya / Tidak
From:
To:
Message:

NAMA PENERIMA:
ALAMAT KIRIM:
No HP:
NOTES:
- Metode pengiriman:
- Ongkir:
- Request jam:
```

Quantity dihitung dari rincian produk. Jika tidak ingin kartu, cukup tulis Tidak; blok kartu dihapus pada hasil normalisasi.

### 20.3 Template revisi cepat

```text
REVISI ORDER NO. YY-####

Perubahan:
- ...

Data lainnya tetap.
```

Jika nomor tidak disebut tetapi konteks order terakhir benar-benar jelas, revisi dapat diterapkan tanpa meminta ulang seluruh form.

---

## 21. Rancangan Implementasi

### Tahap 1 — Dokumen dan template terpusat

- Satu master SOP aktif.
- Satu pricelist.
- Satu template PDF terkunci dan logo resmi.
- Satu daftar order dengan nomor terakhir.
- Riwayat revisi dan dokumen terbaru per order.

### Tahap 2 — Pencatatan terstruktur

- Tabel Orders untuk identitas, tanggal, penerima, dan pengiriman.
- Tabel Order Items untuk rincian produk dan harga.
- Tabel Payments untuk pembayaran terkonfirmasi.
- Tabel Revisions untuk histori.
- Tabel Products dan Prices untuk katalog serta harga aktif.

Media awal dapat berupa spreadsheet terstruktur. Jika beberapa admin bekerja bersamaan, gunakan sistem yang mendukung penomoran dan pembaruan terpusat.

### Tahap 3 — Dashboard operasional

- Daftar kirim per tanggal.
- Rekap kebutuhan dapur.
- Order yang masih kurang data.
- Pembayaran yang belum dikonfirmasi.
- Produk siap dikirim / diambil.
- Akses PDF terbaru dan riwayat revisi.

### Tahap 4 — Integrasi bila dibutuhkan

- Pembacaan form masuk.
- Pembuatan konfirmasi dan PDF dari data order.
- Pembaruan status serta rekap.

Pengiriman pesan kepada pelanggan, akses akun, dan integrasi pembayaran memerlukan implementasi serta otorisasi tersendiri. Pembuatan dokumen ini tidak mengaktifkan fitur tersebut.

---

## 22. Prompt Operasional Siap Pakai

```text
Anda adalah asisten operasional PO LAIORA BOULANGERIE.

Gunakan MASTER SOP LAIORA ORDER terbaru sebagai sumber utama.
Baca status nomor order dan data revisi terbaru sebelum memproses.

Untuk order baru:
1. Normalisasi form tanpa mengarang data penting.
2. Terapkan penamaan produk dan ukuran sesuai SOP.
3. Hitung quantity fisik, harga produk, kartu yang terkonfirmasi, subtotal, ongkir, dan total.
4. Jika tanggal belum ada, minta tanggal sebelum memberi nomor baru.
5. Gunakan nomor order baru berikutnya hanya untuk transaksi baru.
6. Tampilkan Form Order dan Order Confirmation dalam code block terpisah.
7. Buat Delivery Order PDF portrait 100x150 mm sesuai template aktif.
8. Gunakan logo resmi asli, proporsional, hitam-putih; jarak tinta logo dari outline atas 3 mm dan dari tinta logo ke tinta judul 3 mm.
9. PDF hanya berisi data penerima, produk, quantity, tanggal, alamat, dan instruksi operasional. Jangan masukkan harga, ongkir nominal, pemesan, atau isi kartu.
10. Render dan cek PDF sebelum memberikan link.
11. Perbarui sequence setelah order baru tersimpan.

Untuk revisi:
- Gunakan nomor order yang sama.
- Ubah hanya field yang diminta.
- Pertahankan koreksi sebelumnya.
- Hitung ulang nilai yang terdampak.
- Buat ulang PDF dan simpan riwayat.
- Jangan menaikkan sequence.

Komunikasi ringkas dalam bahasa Indonesia.
Tanyakan hanya ambiguitas yang berdampak material.
Jangan menganggap pembayaran, produksi, pengiriman, atau integrasi sudah terjadi tanpa bukti.
```

---

## 23. Pemeliharaan Dokumen

- Aturan eksplisit terbaru pemilik mengalahkan bagian terkait dalam dokumen.
- Perubahan harga, logo, template, dan format harus diberi tanggal berlaku.
- Nomor order diperbarui dari catatan operasional, bukan asumsi.
- SOP ini tidak menggantikan penyimpanan detail setiap order.
- Riwayat pelanggan tidak disalin seluruhnya ke dokumen konsep; simpan dalam catatan order masing-masing.
- Dokumen ini disusun dari master aktif versi tersimpan 39 pada 16 Oktober 2026.
- Aturan jarak awal 0,3 mm telah digantikan revisi aktif 3 mm (0,3 cm); gunakan 3 mm untuk order selanjutnya.

