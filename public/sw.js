// Network only: never persist customer data, authenticated pages, or API replies.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laiora — Tidak ada koneksi</title>
<style>body{margin:0;padding:32px;background:#f8f6f1;color:#203d50;font:17px/1.6 system-ui}main{max-width:460px;margin:15vh auto}a{display:inline-block;padding:12px 20px;background:#203d50;color:white;border-radius:8px}</style>
<main><h1>Tidak ada koneksi</h1><p>Hubungkan perangkat ke internet untuk membuka Laiora dan memeriksa status pesanan. Jika koneksi terputus saat menyimpan, periksa daftar pesanan sebelum mengirim ulang.</p><a href="/dashboard">Coba lagi</a></main></html>`, {
    status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })));
});
