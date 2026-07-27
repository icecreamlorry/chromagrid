// Seeded, deterministic dice for the turn-based table games (Backgammon first;
// reusable by any future dice game). Because engines are pure and fold an
// ordered move log into state, the dice must NOT be a per-client random — both
// clients have to agree. So each roll is derived from the room `seed` plus a
// roll index (0, 1, 2, … one per turn): every client computes the same faces,
// and nobody can pick favourable dice. No dice value is ever stored in the log.
//
// Also exports pip geometry so any renderer can draw a die face consistently.

// Small integer hash → a well-mixed 32-bit seed for the PRNG.
function hash32(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x9e3779b9), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The two dice (each 1–6) for a given roll index, deterministic from the seed.
export function rollDice(seed, index) {
  const r = mulberry32(hash32(seed >>> 0, index >>> 0));
  return [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
}

export function isDoubles([a, b]) { return a === b; }

// The pip values a roll makes available to play: doubles give four of the value,
// otherwise the two faces. (Backgammon convention.)
export function dicePips(seed, index) {
  const [a, b] = rollDice(seed, index);
  return a === b ? [a, a, a, a] : [a, b];
}

// A single die that decides who starts + the opening dice in backgammon: both
// players roll one die, higher goes first and plays both. Deterministic here:
// derive the two "opening dice" from the seed; if they tie, re-roll until they
// differ (bounded), so there's always a first player.
export function openingRoll(seed) {
  let i = 0;
  let [a, b] = rollDice(seed, 0);
  while (a === b && i < 32) { i += 1; [a, b] = rollDice(seed, 1000 + i); }
  return { a, b, firstIsA: a > b }; // A = seat 0
}

// Unicode die faces (⚀…⚅), handy for compact display.
export const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export function diceFace(n) { return DICE_FACES[n] || ''; }

// Pip centres for face `n`, in a unit square (0..1) — for drawing a die in SVG.
const P = {
  c: [0.5, 0.5], tl: [0.28, 0.28], tr: [0.72, 0.28], bl: [0.28, 0.72], br: [0.72, 0.72],
  ml: [0.28, 0.5], mr: [0.72, 0.5],
};
const PIP_LAYOUT = {
  1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
export function pipPositions(n) { return (PIP_LAYOUT[n] || []).map((k) => P[k]); }
