// chrono/js/notify.js — Push notification helper wrapper

export function notificationsSupported() { return 'Notification' in window && 'serviceWorker' in navigator; }
export function notificationPermission() { return notificationsSupported() ? Notification.permission : 'denied'; }
export async function requestNotifications() {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}
export async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { return await navigator.serviceWorker.register('./sw.js'); } catch { return null; }
  }
  return null;
}
export function isEnabled() { return notificationPermission() === 'granted'; }
