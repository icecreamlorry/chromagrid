// One guest display name, shared across every LB Games title.
//
// localStorage is scoped to the origin (not the path), so every game under
// /lb-games/ reads and writes the same key — set your name once (on the
// landing page or in any game) and it follows you everywhere. Signed-in
// players use their account display name instead of this.

import { getTestIdentity } from './guest-id.js';

const KEY = 'lbgames.name';

export const GUEST_NAME_KEY = KEY;

// The guest's display name. If they've never set one, mint a "Guest######"
// (6 random digits, so it's relatively unique) and persist it, so it's stable
// and shows up pre-filled in the name box — deliberately plain enough that most
// people will want to change it, but always a real, non-empty name.
export function getGuestName() {
  // Dev Tools → "Test identity" override (see guest-id.js) — used AS the name
  // directly, not loaded from the shared storage key, so it never clobbers the
  // real cross-game name.
  const test = getTestIdentity();
  if (test) return test;

  let v = (localStorage.getItem(KEY) || '').trim();
  if (!v) {
    v = `Guest${Math.floor(100000 + Math.random() * 900000)}`;
    try { localStorage.setItem(KEY, v); } catch { /* storage blocked — still return it */ }
  }
  return v;
}

// Trims + caps at 20 chars, stores it, and returns the stored value. While a
// test identity is active, deliberately does NOT touch the real shared key —
// typing in the landing box while testing must not overwrite your real
// cross-game name for every other tab and game.
export function setGuestName(name) {
  const v = (name || '').trim().slice(0, 20);
  if (getTestIdentity()) return v;
  if (v) localStorage.setItem(KEY, v);
  else localStorage.removeItem(KEY);
  return v;
}
