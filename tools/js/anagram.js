// Anagram helper — the pure, DOM-free logic. main.js renders it.
//
// The model is deliberately small:
//   lengths  the word shape, e.g. [9] or [5, 4] for a two-word answer
//   locked   one entry per box: the letter the solver has typed in (a crossing
//            letter they already know), or null for a box still to be found
//   pool     the anagram fodder from the clue, as an array of letters
//   order    the CURRENT arrangement of the fodder that is NOT locked in — the
//            shuffled letters, laid over the unlocked boxes in sequence
//
// Nothing here ever solves the anagram: it only takes the locked letters out of
// the fodder and deals what's left into the empty boxes in a random order.

export const MAX_TOTAL = 30;
export const MAX_WORDS = 6;

/** "9" → [9]; "5,4" / "5 4" / "5-4" → [5, 4]. [] when the text isn't a shape. */
export function parseLengths(text) {
  const parts = String(text ?? '').trim().split(/[\s,.\-/]+/).filter(Boolean);
  if (!parts.length || parts.length > MAX_WORDS) return [];
  const lengths = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return [];
    const n = Number(p);
    if (n < 1) return [];
    lengths.push(n);
  }
  const total = lengths.reduce((a, b) => a + b, 0);
  return total > MAX_TOTAL ? [] : lengths;
}

/** Letters only, upper-cased, in the order typed ("Rain, Bow!" → R A I N B O W). */
export function parseLetters(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z]/g, '').split('');
}

/** Resize a locked[] array to a new total, keeping what fits. */
export function resizeLocked(locked, total) {
  const out = new Array(total).fill(null);
  for (let i = 0; i < Math.min(total, locked.length); i++) out[i] = locked[i] || null;
  return out;
}

/** Positions of the unlocked boxes, in reading order. */
export function unlockedSlots(locked) {
  const slots = [];
  locked.forEach((l, i) => { if (!l) slots.push(i); });
  return slots;
}

/**
 * Take each locked letter out of the pool (in box order). A locked letter that
 * isn't in the pool — or all copies are already used by earlier boxes — is
 * flagged as missing so the UI can say "there's no Q in your letters".
 * Returns { remaining: letters left to deal, missing: boolean per box }.
 */
export function consumeLocked(pool, locked) {
  const counts = new Map();
  for (const l of pool) counts.set(l, (counts.get(l) || 0) + 1);
  const missing = locked.map(() => false);
  locked.forEach((l, i) => {
    if (!l) return;
    const n = counts.get(l) || 0;
    if (n > 0) counts.set(l, n - 1);
    else missing[i] = true;
  });
  const remaining = [];
  for (const l of pool) {
    const n = counts.get(l) || 0;
    if (n > 0) { remaining.push(l); counts.set(l, n - 1); }
  }
  return { remaining, missing };
}

/**
 * Make `order` a permutation of `remaining` while disturbing it as little as
 * possible: letters that are gone are dropped from wherever they sat, letters
 * that are new are appended. Keeps the solver's current arrangement stable
 * when they lock or unlock a single letter or fix a typo in the fodder.
 */
export function reconcileOrder(order, remaining) {
  const want = new Map();
  for (const l of remaining) want.set(l, (want.get(l) || 0) + 1);
  const kept = [];
  for (const l of order) {
    const n = want.get(l) || 0;
    if (n > 0) { kept.push(l); want.set(l, n - 1); }
  }
  for (const [l, n] of want) for (let i = 0; i < n; i++) kept.push(l);
  return kept;
}

/** Fisher–Yates over a copy. `rng` returns [0, 1). */
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A fresh arrangement that differs from the current one whenever that is
 * possible (two or more distinct letters) — a shuffle that hands back the same
 * row you were staring at feels broken.
 */
export function reshuffle(order, rng = Math.random) {
  if (new Set(order).size < 2) return order.slice();
  const before = order.join('');
  let next = order;
  for (let tries = 0; tries < 12; tries++) {
    next = shuffle(order, rng);
    if (next.join('') !== before) break;
  }
  return next;
}

/**
 * Lay `order` over the unlocked boxes. Returns
 *   fill      one entry per box: the dealt letter for an unlocked box (null
 *             when the fodder has run out), null for locked boxes
 *   leftover  letters in `order` that didn't fit — the fodder is longer than
 *             the answer, so they're shown beside the boxes instead of lost
 */
export function dealOrder(order, locked) {
  const slots = unlockedSlots(locked);
  const fill = locked.map(() => null);
  slots.forEach((slot, k) => { fill[slot] = k < order.length ? order[k] : null; });
  return { fill, leftover: order.slice(slots.length) };
}

/**
 * Where a box sits among the unlocked boxes — i.e. which index of `order` is
 * showing in it. Used so locking the letter you can SEE in a box removes that
 * very copy from the arrangement (and unlocking puts it back in place) rather
 * than the first copy anywhere, which would visibly shuffle its neighbours.
 */
export function rankAmongUnlocked(locked, slot) {
  let k = 0;
  for (let i = 0; i < slot; i++) if (!locked[i]) k++;
  return k;
}

/**
 * Lock `letter` into box `slot`, returning the new { locked, order }. If the
 * box currently shows that letter, that copy leaves `order`; otherwise the
 * first matching copy does; if there is none, `order` is untouched and the
 * box will be flagged missing by consumeLocked().
 */
export function lockLetter({ locked, order }, slot, letter) {
  const next = locked.slice();
  const wasLocked = !!next[slot];
  const k = rankAmongUnlocked(next, slot);
  next[slot] = letter;
  let o = order.slice();
  if (wasLocked) {
    // Overtyping a locked box: give the old letter back before taking the new one.
    o.splice(k, 0, locked[slot]);
  }
  const idx = o[k] === letter ? k : o.indexOf(letter);
  if (idx >= 0) o.splice(idx, 1);
  return { locked: next, order: o };
}

/** Unlock box `slot`; its letter rejoins the arrangement in that same place. */
export function unlockLetter({ locked, order }, slot) {
  if (!locked[slot]) return { locked: locked.slice(), order: order.slice() };
  const next = locked.slice();
  const letter = next[slot];
  next[slot] = null;
  const k = rankAmongUnlocked(next, slot);
  const o = order.slice();
  o.splice(Math.min(k, o.length), 0, letter);
  return { locked: next, order: o };
}

/** Derive everything the UI shows from the model in one go. */
export function view({ lengths, locked, poolText, order }) {
  const total = lengths.reduce((a, b) => a + b, 0);
  const pool = parseLetters(poolText);
  const { remaining, missing } = consumeLocked(pool, locked);
  const consistent = reconcileOrder(order, remaining);
  const { fill, leftover } = dealOrder(consistent, locked);
  const lockedCount = locked.filter(Boolean).length;
  return {
    total,
    pool,
    order: consistent,
    missing,
    fill,
    leftover,
    lockedCount,
    // How the fodder measures up against the boxes, counting locked letters
    // that ARE in the fodder as used: > 0 spare letters, < 0 letters short.
    balance: pool.length - total + missing.filter(Boolean).length,
  };
}
