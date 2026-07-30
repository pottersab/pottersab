/*
  Service worker portal SAB.

  DISENGAJA TIDAK MENG-CACHE HTML. Situs ini masih sering di-update dan
  offline bukan kebutuhan, jadi setiap halaman selalu diambil dari jaringan.
  Kalau HTML ikut di-cache, deploy baru di Vercel tidak akan terlihat di HP
  sampai cache-nya kedaluwarsa — masalah yang sengaja dihindari di sini.

  Tugasnya cuma dua:
  1. Menyediakan fetch handler (syarat Chrome untuk menawarkan "Install app").
  2. Menampilkan halaman offline saat pindah halaman gagal karena tidak ada sinyal.

  Kalau nanti butuh benar-benar offline, ganti strategi navigasi di bawah
  jadi network-first-with-cache dan tambahkan aset ke SHELL.
*/

const CACHE = 'sab-shell-v1';
const OFFLINE_URL = '/offline.html';

const SHELL = [
  OFFLINE_URL,
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya perpindahan halaman yang ditangani; sisanya lewat ke jaringan apa adanya.
  if (req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL))
  );
});
