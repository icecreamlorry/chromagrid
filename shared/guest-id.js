// A persistent per-device guest identity.
//
// Stored in localStorage so it survives page reloads AND full browser restarts.
// This is what lets a guest rejoin the room they were in — their seat on the
// room is matched by this id — so guest play is as seamless as signed-in play.
// (It used to live in sessionStorage, which the browser wipes on close: the
// returning guest got a fresh id, couldn't be matched to their seat, and hit
// "that room is already full" when trying to rejoin with the code.)
//
// It's per-device: two different browsers/devices are naturally different
// guests. Two tabs in the same browser share it (the same person), exactly like
// a signed-in account shared across tabs.

const KEY = 'lbgames.guestId';

// ---- Dev-only per-tab identity override ------------------------------------
// Set from Dev Tools → "Test identity" (shared/devtools.js). Deliberately in
// sessionStorage — the opposite of the real id above — so it is naturally
// scoped to ONE TAB and never survives past that tab closing. This is what
// lets two tabs in the same browser join a room as two different players for
// local testing, without disturbing the real persistent identity a returning
// guest relies on. getGuestName() (guest-name.js) honours the same override so
// the landing name box picks it up automatically.
const TEST_KEY = 'lbgames.testIdentity';

export function getTestIdentity() {
  try { return sessionStorage.getItem(TEST_KEY) || ''; } catch { return ''; }
}

export function setTestIdentity(name) {
  try {
    const v = (name || '').trim();
    if (v) sessionStorage.setItem(TEST_KEY, v);
    else sessionStorage.removeItem(TEST_KEY);
  } catch { /* storage blocked — dev tool just won't persist */ }
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'guest';
}

export function getGuestId() {
  const test = getTestIdentity();
  if (test) return `test-${slugify(test)}`;

  let id = null;
  // Prefer the persistent id; fall back to (and migrate) any older
  // sessionStorage id so a guest mid-session keeps the same identity.
  try { id = localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  try { localStorage.setItem(KEY, id); }
  catch { try { sessionStorage.setItem(KEY, id); } catch { /* nothing more we can do */ } }
  return id;
}
