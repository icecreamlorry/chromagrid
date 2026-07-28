// Flagz game logic — pure functions, no DOM, no network (unit-tested by
// test/engine.test.mjs under plain node). The seeded round builders are the
// heart of multiplayer fairness: every seat derives identical rounds from the
// room seed. RNG, ordering-grade, answer-matching and ranking primitives are
// shared with the other quiz games in shared/quiz-engine.js; only the round
// BUILDER and the mode/difficulty tables are Flagz-specific.

import {
  mulberry32, shuffleWith,
  expectedOrder as _expectedOrder, gradeOrder as _gradeOrder,
  makeAnswerMatcher,
  scoreOf, compareResults, rankSeats, winnerSeat,
} from '../../shared/quiz-engine.js';

export { mulberry32, shuffleWith, scoreOf, compareResults, rankSeats, winnerSeat };

// ---- Game modes -------------------------------------------------------------

export const MODES = [
  { id: 'spotter', name: 'SPOTTER', tagline: 'One name — tap its flag' },
  { id: 'lineup', name: 'LINE-UP', tagline: 'One flag — pick its country' },
  { id: 'namedrop', name: 'NAMEDROP', tagline: 'One flag — type its country' },
  { id: 'atoz', name: 'A TO Z', tagline: 'Sort flags alphabetically, blind' },
  { id: 'headcount', name: 'HEADCOUNT', tagline: 'Sort flags by population' },
  { id: 'landmass', name: 'LANDMASS', tagline: 'Sort flags by area' },
];
export function modeMeta(id) { return MODES.find((m) => m.id === id) || null; }
export function isOrderMode(id) { return id === 'atoz' || id === 'headcount' || id === 'landmass'; }

// ---- Difficulty ---------------------------------------------------------------
// Two knobs per tier:
//   n = options shown (spotter/lineup) / flags per sorting round; 0 = whole region.
//   q = number of questions, used only by NAMEDROP — the one mode with nothing
//       to juggle, so its difficulty scales the run length instead. 0 = whole
//       region. Spotter/lineup keep a fixed PICK_ROUNDS and scale their options.

export const DIFFS = [
  { id: 'easy', name: 'EASY', n: 3, q: 5 },
  { id: 'medium', name: 'MEDIUM', n: 6, q: 10 },
  { id: 'hard', name: 'HARD', n: 9, q: 15 },
  { id: 'all', name: 'ALL', n: 0, q: 0 },
];
export function diffMeta(id) { return DIFFS.find((d) => d.id === id) || null; }

export const PICK_ROUNDS = 10;  // fixed question count for spotter/lineup
export const ORDER_ROUNDS = 5;  // sorting rounds (1 when difficulty = all)

// How many questions/rounds a mode+difficulty produces for a region of this
// size — used by the UI to tell the player what a difficulty will do.
export function roundsFor(mode, diff, regionLen) {
  const { n = 0, q = 0 } = diff || {};
  if (isOrderMode(mode)) return n ? Math.min(ORDER_ROUNDS, Math.floor(regionLen / Math.min(n, regionLen)) || 1) : 1;
  if (mode === 'namedrop') return q ? Math.min(q, regionLen) : regionLen;
  return Math.min(PICK_ROUNDS, regionLen);
}

// ---- Round builders --------------------------------------------------------------
// diff = a DIFFS entry { n, q } (see above).
// pick modes → [{ answer, options }] (options shuffled, contain answer;
//   namedrop gets no options). n = 0 → every region flag is an option.
//   Spotter/lineup run PICK_ROUNDS; namedrop runs q questions (0 = whole region).
// order modes → [{ ids }] (display order, already shuffled). n = 0 → one round
//   with the whole region.

export function buildRounds(mode, diff, regionIso, seed) {
  const rand = mulberry32(seed);
  const pool = shuffleWith(rand, regionIso);
  const { n = 0, q = 0 } = diff || {};

  if (isOrderMode(mode)) {
    if (!n) return [{ ids: pool.slice() }];
    const size = Math.min(n, pool.length);
    const count = Math.min(ORDER_ROUNDS, Math.floor(pool.length / size) || 1);
    const rounds = [];
    for (let r = 0; r < count; r++) rounds.push({ ids: pool.slice(r * size, r * size + size) });
    return rounds;
  }

  // Namedrop scales its length with difficulty (it has no options to scale);
  // spotter/lineup keep a fixed 10 and scale their option count instead.
  const count = mode === 'namedrop'
    ? (q ? Math.min(q, pool.length) : pool.length)
    : Math.min(PICK_ROUNDS, pool.length);
  const rounds = [];
  for (let r = 0; r < count; r++) {
    const answer = pool[r];
    if (mode === 'namedrop') { rounds.push({ answer, options: [] }); continue; }
    let options;
    if (!n || n >= regionIso.length) {
      options = shuffleWith(rand, regionIso);
    } else {
      const distractors = shuffleWith(rand, regionIso.filter((c) => c !== answer)).slice(0, n - 1);
      options = shuffleWith(rand, [answer, ...distractors]);
    }
    rounds.push({ answer, options });
  }
  return rounds;
}

// ---- Ordering keys + grading -------------------------------------------------------

// Value used to sort a country in each order mode. atoz sorts on the display
// name (case/diacritic-insensitive); headcount/landmass ascending numerics.
export function orderKey(mode, country) {
  if (mode === 'atoz') return normalizeAnswer(country.name);
  if (mode === 'headcount') return country.pop;
  return country.area;
}

// The expected arrangement for a round (ascending; A first for atoz).
export function expectedOrder(mode, ids, countries) {
  return _expectedOrder((c) => orderKey(mode, c), ids, countries);
}
export function gradeOrder(mode, placed, countries) {
  return _gradeOrder((c) => orderKey(mode, c), placed, countries);
}

// ---- Answer matching (namedrop) ------------------------------------------------------
// Country names unify "&"↔"and", "St"↔"Saint", drop a leading "The", and index
// a space-stripped alias too ("U.S.A." → "usa").
export const { normalizeAnswer, buildAnswerIndex, matchAnswer } =
  makeAnswerMatcher({ amp: true, saint: true, dropThe: true, packed: true });
