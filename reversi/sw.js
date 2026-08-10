// reversi/sw.js — Service Worker for Reversi
const CACHE_NAME = 'reversi-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through network strategy
});
