// Atomyx game logic — pure functions, no DOM, no network (unit-tested by
// test/engine.test.mjs under plain node). The seeded round builders are the
// heart of multiplayer fairness: every seat derives identical rounds from the
// room seed. RNG, ordering-grade, answer-matching and ranking primitives are
// shared with the other quiz games in shared/quiz-engine.js.

import {
  mulberry32, shuffleWith,
  expectedOrder as _expectedOrder, gradeOrder as _gradeOrder,
  makeAnswerMatcher,
  scoreOf, compareResults, rankSeats, winnerSeat,
} from '../../shared/quiz-engine.js';

export { mulberry32, shuffleWith, scoreOf, compareResults, rankSeats, winnerSeat };

// ---- Game modes -------------------------------------------------------------

export const MODES = [
  { id: 'pinpoint', name: 'PINPOINT', tagline: 'One name — tap its cell' },
  { id: 'lineup', name: 'LINE-UP', tagline: 'One element — pick its name' },
  { id: 'namedrop', name: 'NAMEDROP', tagline: 'One element — type its name' },
  { id: 'mass', name: 'MASS', tagline: 'Sort by atomic mass' },
  { id: 'sweep', name: 'SWEEP', tagline: 'Type every element from memory' },
  { id: 'build', name: 'BUILD', tagline: 'Place tiles on a blank table' },
];
export function modeMeta(id) { return MODES.find((m) => m.id === id) || null; }
export function isOrderMode(id) { return id === 'mass'; }
export function isTableMode(id) { return id === 'pinpoint' || id === 'build'; }

// ---- Difficulty ---------------------------------------------------------------
// Two knobs per tier so difficulty means something in EVERY mode:
//   q = number of questions (pinpoint/lineup/namedrop/build); 0 = whole set once.
//   n = juggle count — name options (lineup) / cards per sorting round (mass);
//       0 = the whole set.
// SWEEP is inherently the whole set, so difficulty doesn't apply there.

export const DIFFS = [
  { id: 'easy', name: 'EASY', n: 3, q: 5 },
  { id: 'medium', name: 'MEDIUM', n: 6, q: 10 },
  { id: 'hard', name: 'HARD', n: 9, q: 15 },
  { id: 'all', name: 'ALL', n: 0, q: 0 },
];
export function diffMeta(id) { return DIFFS.find((d) => d.id === id) || null; }

export const PICK_ROUNDS = 10;  // medium question count (kept for reference/tests)
export const ORDER_ROUNDS = 5;  // fallback sorting rounds cap (1 when difficulty = all)

// How many questions/rounds a mode+difficulty actually produces for a given set
// size — used by the UI to tell the player what a difficulty will do.
export function roundsFor(mode, diff, setLen) {
  const { n = 0, q = 0 } = diff || {};
  if (mode === 'sweep') return 1;
  if (isOrderMode(mode)) return n ? Math.min(q || ORDER_ROUNDS, Math.floor(setLen / Math.min(n, setLen)) || 1) : 1;
  return q ? Math.min(q, setLen) : setLen;
}

// ---- Round builders --------------------------------------------------------------
// diff = a DIFFS entry { n, q } (see above).
// pick modes → [{ answer, options }] — q questions (0 = whole set once), no
//   repeats; only lineup gets options (n = 0 → every set element is an option).
// mass → [{ ids }] (display order, already shuffled). n = 0 → one round with
//   the whole set; otherwise q sorting rounds of n, capped by how many
//   non-overlapping groups the set yields.
// sweep → [{ ids }] — one round carrying the whole set (order irrelevant).

export function buildRounds(mode, diff, setIds, seed) {
  const rand = mulberry32(seed);
  const pool = shuffleWith(rand, setIds);
  const { n = 0, q = 0 } = diff || {};

  if (mode === 'sweep') return [{ ids: pool.slice() }];

  if (isOrderMode(mode)) {
    if (!n) return [{ ids: pool.slice() }];
    const size = Math.min(n, pool.length);
    const count = Math.min(q || ORDER_ROUNDS, Math.floor(pool.length / size) || 1);
    const rounds = [];
    for (let r = 0; r < count; r++) rounds.push({ ids: pool.slice(r * size, r * size + size) });
    return rounds;
  }

  const count = q ? Math.min(q, pool.length) : pool.length;
  const rounds = [];
  for (let r = 0; r < count; r++) {
    const answer = pool[r];
    if (mode !== 'lineup') { rounds.push({ answer, options: [] }); continue; }
    let options;
    if (!n || n >= setIds.length) {
      options = shuffleWith(rand, setIds);
    } else {
      const distractors = shuffleWith(rand, setIds.filter((c) => c !== answer)).slice(0, n - 1);
      options = shuffleWith(rand, [answer, ...distractors]);
    }
    rounds.push({ answer, options });
  }
  return rounds;
}

// ---- Ordering keys + grading -------------------------------------------------------

// Value used to sort an element in the mass mode (ascending, lightest first).
export function orderKey(mode, element) {
  return element.mass;
}

// The expected arrangement for a round (ascending).
export function expectedOrder(mode, ids, elements) {
  return _expectedOrder((e) => orderKey(mode, e), ids, elements);
}
export function gradeOrder(mode, placed, elements) {
  return _gradeOrder((e) => orderKey(mode, e), placed, elements);
}

// ---- Answer matching (namedrop / sweep) ------------------------------------------
// Element names normalize simply (no &/Saint/The quirks, no packed alias).
export const { normalizeAnswer, buildAnswerIndex, matchAnswer } = makeAnswerMatcher();

// Symbol lookup for SWEEP ("fe" counts as Iron). Element ids ARE lowercase
// symbols, so this only needs to check membership.
export function matchSymbol(setIds, input) {
  const key = normalizeAnswer(input).replace(/ /g, '');
  return setIds.includes(key) ? key : null;
}

// Results / ranking (scoreOf, compareResults, rankSeats, winnerSeat) are shared —
// re-exported from shared/quiz-engine.js at the top. This rule ranks SWEEP
// correctly for free: completers hold the max score, so they sit above every
// quitter and race each other on time.
