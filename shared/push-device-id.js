// A persistent per-browser id for push notifications, stored in localStorage
// (shared across every LB Games path on this origin — see guest-id.js for the
// same trick used for guest identity).
//
// Each game registers its own service worker at its own scope, so the same
// physical browser ends up with a DIFFERENT push subscription endpoint per
// game it's opened notifications in. Tagging every subscription row with this
// one shared id lets the notify Edge Function tell "same device, different
// game" apart from "different device" — so a signed-in user gets ONE push per
// real device for an event, not one per game they've ever enabled pushes in.

const KEY = 'lbgames.pushDeviceId';

export function getPushDeviceId() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(KEY, id); } catch { /* storage blocked — id just won't persist */ }
  }
  return id;
}
