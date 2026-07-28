// Atlaz game logic — pure functions, no DOM, no network (unit-tested by
// test/engine.test.mjs under plain node). The seeded RNG and answer-matching
// come from shared/quiz-engine.js; the jigsaw geometry and Atlaz's sweep-aware
// ranking are game-specific and live here.

import { mulberry32, seededShuffle, makeAnswerMatcher } from '../../shared/quiz-engine.js';

export { mulberry32, seededShuffle };

// ---- Game modes -------------------------------------------------------------

export const MODES = [
  { id: 'pinpoint', name: 'PINPOINT', tagline: 'See the name, tap the place' },
  { id: 'lineup', name: 'LINE-UP', tagline: 'See the shape, pick the name' },
  { id: 'namedrop', name: 'NAMEDROP', tagline: 'See the shape, type the name' },
  { id: 'jigsaw', name: 'JIGSAW', tagline: 'Drag each piece into place' },
  { id: 'sweep', name: 'SWEEP', tagline: 'Name everything against the clock' },
];

export function modeMeta(id) { return MODES.find((m) => m.id === id) || null; }

// ---- Seeded shuffle ---------------------------------------------------------
// mulberry32 + seededShuffle are shared (re-exported above). The shared question
// order for a room: every seat shuffles the region's item ids with the room seed.
export function questionOrder(items, seed) {
  return seededShuffle(items.map((it) => it.id), seed);
}

// ---- Answer matching (NAMEDROP / SWEEP) -------------------------------------
// Country names unify "&"↔"and" and "St"↔"Saint", and index a space-stripped
// alias too ("U.S.A." → "usa"). (No leading-"the" drop — Atlaz keeps that quirk
// out; Flagz opts in.)
export const { normalizeAnswer, buildAnswerIndex, matchAnswer } =
  makeAnswerMatcher({ amp: true, saint: true, packed: true });

// ---- Jigsaw tolerance --------------------------------------------------------
// A drop counts as correct within max(55% of the piece's own bbox diagonal,
// 5% of the map diagonal) of the piece's true bbox centre — big pieces get
// naturally forgiving targets, tiny pieces a phone-friendly floor.

export function bboxCenter(item) {
  const [x0, y0, x1, y1] = item.bbox;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

export function jigsawTolerance(item, mapW, mapH) {
  const [x0, y0, x1, y1] = item.bbox;
  const pieceDiag = Math.hypot(x1 - x0, y1 - y0);
  return Math.max(0.55 * pieceDiag, 0.05 * Math.hypot(mapW, mapH));
}

export function jigsawHit(item, dropX, dropY, mapW, mapH) {
  const [cx, cy] = bboxCenter(item);
  return Math.hypot(dropX - cx, dropY - cy) <= jigsawTolerance(item, mapW, mapH);
}

// ---- Results / ranking -------------------------------------------------------
// A result: { outcomes: [{id, ok, pick?}], ms, foundCount, gaveUp, total }.
// Modes 1–4: score = #correct, tiebreak lower ms. SWEEP: everyone who found
// them all ranks by time; quitters rank below by found count, then time.

export function scoreOf(result) {
  if (!result) return 0;
  if (Array.isArray(result.outcomes) && result.outcomes.length) {
    return result.outcomes.filter((o) => o && o.ok).length;
  }
  return result.foundCount || 0;
}

export function compareResults(mode, a, b) {
  const missing = (x) => (x ? 0 : 1);
  if (missing(a) || missing(b)) return missing(a) - missing(b);
  if (mode === 'sweep') {
    const doneA = !a.gaveUp && a.foundCount >= a.total;
    const doneB = !b.gaveUp && b.foundCount >= b.total;
    if (doneA !== doneB) return doneA ? -1 : 1;
    if (doneA) return a.ms - b.ms;
    return (b.foundCount - a.foundCount) || (a.ms - b.ms);
  }
  return (scoreOf(b) - scoreOf(a)) || (a.ms - b.ms);
}

// results: sparse array/dict seat -> result. Returns seats best-first.
export function rankSeats(mode, results, seats) {
  const list = [];
  for (let s = 0; s < seats; s++) list.push(s);
  return list.sort((a, b) => compareResults(mode, results[a], results[b]) || a - b);
}

// Winner seat for finishRoom: top of the ranking, 'tie' when the runner-up is
// equivalent under the mode's comparator (or nobody submitted anything).
export function winnerSeat(mode, results, seats) {
  if (seats <= 1) return 0;
  const ranked = rankSeats(mode, results, seats);
  const top = ranked[0];
  if (!results[top]) return 'tie';
  const next = ranked[1];
  // A draw is an equal SCORE — time only breaks ties for list order, it doesn't
  // decide the winner. Sweep is the exception: it's an explicit speed race, so
  // there the full comparator (completion + time) does decide.
  const tied = next != null && results[next] && (
    mode === 'sweep'
      ? compareResults(mode, results[top], results[next]) === 0
      : scoreOf(results[top]) === scoreOf(results[next])
  );
  if (tied) return 'tie';
  return top;
}
