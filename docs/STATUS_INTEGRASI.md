# Status integrasi Laiora

## Proyek Supabase yang diberikan pemilik

- Project reference: `nhkzxncfbfejbrceuzyb`.
- Project URL: https://nhkzxncfbfejbrceuzyb.supabase.co
- User UUID akun bersama: `e41a3083-fa61-47cb-9758-e0f682c7eb61`.
- Publishable key tersedia pada `.env.local` workspace lama yang diabaikan Git; key tidak disalin ke dokumen ini.

Pemilik melaporkan bahwa `SETUP_LAIORA.sql` berhasil dijalankan, satu akun Auth berhasil dibuat, binding UUID benar, dan **Allow new users to sign up** sudah dimatikan. Itu merupakan laporan penyelesaian melalui dashboard Supabase oleh pemilik; sesi pengembangan belum memverifikasi login Auth hosted.

## Keterbatasan verifikasi saat ini

Environment configuration sudah memuat izin domain proyek, tetapi network policy startup mesin sesi masih tidak memuat domain tersebut, dan request HTTPS melalui proxy masih mendapat CONNECT 403. Plugin Supabase tetap belum mengekspos tools di sesi ini. Kegagalan transport ini tidak membuktikan password, key, atau SQL salah.

Jangan meminta key/password baru hanya karena kegagalan jaringan. Jangan menjalankan ulang setup atau mengganti binding yang sudah ada tanpa diagnosis. Uji login dari host aplikasi yang memiliki akses ke proyek.

## Aplikasi

Production build, TypeScript, missing-configuration check, serta 11 skenario browser auth terhadap service tiruan telah lulus pada verifikasi sebelumnya. Konfigurasi runtime server kini memisahkan test lokal dari nilai proyek yang mungkin telah tertanam saat build. Hasil hosted tetap dicatat terpisah.

Tujuh halaman sudah dilindungi tetapi masih menampilkan fondasi. Fitur order nyata, WhatsApp, Sheets, dan PDF masih menunggu implementasi. Deployment publik belum dilakukan.
