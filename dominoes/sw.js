// dominoes/sw.js — Service Worker for Dominoes
const CACHE_NAME = 'dominoes-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Pass-through network strategy
});
