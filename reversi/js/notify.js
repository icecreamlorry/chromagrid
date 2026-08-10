// reversi/js/notify.js — Push notification helper wrapper

export function notificationsSupported() { return typeof Notification !== 'undefined' && 'serviceWorker' in navigator; }
export function notificationPermission() { return notificationsSupported() ? Notification.permission : 'unsupported'; }
export function isMuted() { return localStorage.getItem('reversi_notify_muted') === '1'; }
export function setMuted(v) { localStorage.setItem('reversi_notify_muted', v ? '1' : '0'); }
export function isEnabled() { return notificationsSupported() && Notification.permission === 'granted' && !isMuted(); }
export function pushSupported() { return false; }
export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}
export async function registerServiceWorker() {
  if (!notificationsSupported()) return null;
  try { return await navigator.serviceWorker.register('./sw.js'); } catch { return null; }
}
export async function subscribeToPush() { return null; }
export async function showLocalNotification() { return null; }
