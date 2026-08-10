// chrono/sw.js — Service Worker for Chrono
const CACHE_NAME = 'chrono-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through network strategy
});
