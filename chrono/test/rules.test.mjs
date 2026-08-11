// chrono/test/rules.test.mjs — real tests for the seeded "sort these events
// chronologically" quiz: round construction, seat-to-seat determinism, grading
// of WRONG answers and of ties, and dataset integrity.
//
// The pre-existing e2e test grades `round.expected` (the answer key) against the
// answer key and asserts a perfect score — which cannot fail whatever gradeOrder
// does. Everything below grades arrangements that are actually wrong.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRounds, gradeOrder, orderKey } from '../js/engine.js';
import { loadEvents } from '../js/dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const J = (v) => JSON.stringify(v);

const events = await loadEvents();
const byId = {};
events.forEach((e) => { byId[e.id] = e; });

// ---- 1. Round construction --------------------------------------------------
{
  const rounds = buildRounds(events, 12345, 10);
  ok(rounds.length === 10, 'rounds: 10 rounds requested, 10 built');
  ok(rounds.every((r) => r.items.length === 4), 'rounds: every round holds 4 items');

  const seenGlobal = new Set();
  let dupInRound = 0, dupAcross = 0, foreign = 0;
  for (const r of rounds) {
    const ids = r.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) dupInRound++;
    for (const id of ids) {
      if (seenGlobal.has(id)) dupAcross++;
      seenGlobal.add(id);
      if (!byId[id]) foreign++;
    }
  }
  ok(dupInRound === 0, 'rounds: no item repeats inside a round');
  ok(dupAcross === 0, 'rounds: no item repeats across the whole 10-round set');
  ok(foreign === 0, 'rounds: every item comes from the dataset');

  // `expected` must be a permutation of `items`, sorted ascending by year.
  for (const r of rounds) {
    ok(J(r.expected.map((i) => i.id).slice().sort()) === J(r.items.map((i) => i.id).slice().sort()),
      'rounds: expected is a permutation of items');
    ok(r.expected.every((it, i) => i === 0 || r.expected[i - 1].year <= it.year),
      'rounds: expected is sorted earliest-to-latest');
  }

  // Asking for more rounds than the dataset can fill must not invent items.
  ok(buildRounds(events, 12345, 100).length === Math.floor(events.length / 4),
    'rounds: asking for more rounds than the data allows yields floor(n/4), not garbage');
  ok(buildRounds(events, 12345, 0).length === 0, 'rounds: 0 rounds requested, 0 built');
}

// ---- 2. Seeded determinism (every seat must see the same rounds) -----------
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  ok(!/Math\.random\s*\(/.test(src), 'seed: the engine never calls Math.random()');

  const seatA = buildRounds(events, 424242, 10);
  const seatB = buildRounds(events, 424242, 10);
  ok(J(seatA) === J(seatB), 'seed: two seats on one room seed build identical rounds');
  ok(J(buildRounds(events, 1, 10)) !== J(buildRounds(events, 2, 10)),
    'seed: different room seeds build different rounds');

  // buildRounds must not mutate the dataset it was handed (it is the shared
  // `app.data` array in the quiz controller).
  const snapshot = J(events);
  buildRounds(events, 777, 10);
  ok(J(events) === snapshot, 'seed: buildRounds does not mutate the dataset');

  // Rounds must actually reorder the dataset, not just slice it in file order.
  ok(J(buildRounds(events, 999, 3)[0].items.map((i) => i.id)) !== J(events.slice(0, 4).map((i) => i.id)),
    'seed: the round set is shuffled, not the raw dataset order');

  // shared/quiz-game.js calls cfg.buildRounds(data, payload, seed) — data,
  // then the START PAYLOAD, then the numeric room seed. Two rooms with
  // different seeds must therefore get different rounds through that wiring.
  const wiring = (data, payload, seed) =>
    // exactly what chrono/js/main.js registers:
    //   buildRounds: (data, p, seed) => buildRounds(data, seed, p?.count ?? 10)
    buildRounds(data, seed, payload?.count ?? 10);
  const payload = { mode: 'timeline', diff: 'medium', count: 10 };
  ok(J(wiring(events, payload, 111)) !== J(wiring(events, payload, 222)),
    'seed: as wired by main.js, two rooms with different seeds get DIFFERENT rounds');
}

// ---- 3. Grading a WRONG answer ---------------------------------------------
{
  // A round with four distinct years, so every ordering error is punishable.
  const round = buildRounds(events, 12345, 10)
    .find((r) => new Set(r.items.map((i) => i.year)).size === 4);
  ok(!!round, 'grade setup: found a round with four distinct years');

  const correct = round.expected.map((i) => i.id);
  ok(gradeOrder(correct, byId).every(Boolean), 'grade: the correct order scores 4/4');

  const reversed = correct.slice().reverse();
  ok(gradeOrder(reversed, byId).filter(Boolean).length === 0,
    'grade: the exactly-reversed order scores 0/4');

  // Swap the first two: exactly those two slots are wrong.
  const swapped = [correct[1], correct[0], correct[2], correct[3]];
  const g = gradeOrder(swapped, byId);
  ok(J(g) === J([false, false, true, true]), 'grade: swapping two adjacent items marks exactly those two wrong');

  // Rotating by one is wrong everywhere.
  const rotated = [correct[3], correct[0], correct[1], correct[2]];
  ok(gradeOrder(rotated, byId).filter(Boolean).length === 0, 'grade: a rotation scores 0/4');

  // Grading must not depend on the order the round was presented in.
  ok(J(gradeOrder(correct, byId)) === J(gradeOrder(correct.slice(), byId)), 'grade: grading is pure');
}

// ---- 4. Ties in date --------------------------------------------------------
{
  // Equal years are interchangeable: either arrangement of the tied pair is
  // correct, but moving a later event ahead of them is not.
  const data = {
    a: { id: 'a', year: 1900 },
    b: { id: 'b', year: 1950 },
    c: { id: 'c', year: 1950 },
    d: { id: 'd', year: 2000 },
  };
  ok(gradeOrder(['a', 'b', 'c', 'd'], data).every(Boolean), 'ties: a-b-c-d (tie in given order) scores 4/4');
  ok(gradeOrder(['a', 'c', 'b', 'd'], data).every(Boolean), 'ties: a-c-b-d (tie swapped) also scores 4/4');
  // Grading is slot-wise against the sorted keys, so a misplaced item costs the
  // slot it sits in and the slot it displaced — not every slot after it.
  ok(J(gradeOrder(['a', 'd', 'b', 'c'], data)) === J([true, false, true, false]),
    'ties: hoisting the 2000 event costs its slot and the slot it pushed out');
  ok(J(gradeOrder(['d', 'c', 'b', 'a'], data)) === J([false, true, true, false]),
    'ties: a full reversal still scores the two interchangeable tied slots');

  // Real tied years exist in the dataset, so this path is live.
  const years = events.map((e) => e.year);
  ok(new Set(years).size < years.length, 'ties: the dataset really does contain repeated years');
}

// ---- 5. orderKey ------------------------------------------------------------
{
  ok(orderKey({ year: 1969 }) === 1969, 'orderKey: reads the year');
  ok(orderKey(undefined) === 0 && orderKey(null) === 0, 'orderKey: missing item does not throw');
  // An id that is not in the round must not silently grade as a correct "year 0"
  // placement — a client can post any id string in its result move.
  ok(gradeOrder(['nope', ...buildRounds(events, 5, 1)[0].expected.slice(1).map((i) => i.id)], byId)[0] === false,
    'orderKey: an unknown id must not grade as CORRECT via the year-0 fallback '
    + '(flagz/atomyx throw on a missing item rather than scoring it)');
}

// ---- 6. Dataset integrity ---------------------------------------------------
{
  ok(events.length >= 40, 'data: at least 40 events (10 rounds of 4)');
  ok(events.length % 4 === 0, 'data: the event count is a multiple of 4, so no items are unusable');
  ok(new Set(events.map((e) => e.id)).size === events.length, 'data: ids are unique');
  ok(new Set(events.map((e) => e.title)).size === events.length, 'data: no duplicate event titles');
  ok(events.every((e) => Number.isInteger(e.year)), 'data: every year is an integer');
  ok(events.every((e) => e.year >= 400 && e.year <= new Date().getFullYear()),
    'data: every year is in a plausible range and not in the future');
  ok(events.every((e) => typeof e.title === 'string' && e.title.length > 0), 'data: every event has a title');
  ok(events.every((e) => typeof e.category === 'string' && e.category.length > 0), 'data: every event has a category');

  // Known-good anchor dates: a regression net over the facts.
  const want = {
    'Moon Landing (Apollo 11)': 1969,
    'Fall of Constantinople': 1453,
    'First Airplane Flight (Wright Brothers)': 1903,
    'Discovery of Penicillin': 1928,
    'French Revolution Begins': 1789,
    'Fall of the Berlin Wall': 1989,
    'Declaration of Independence': 1776,
    'Sinking of the Titanic': 1912,
    'Magna Carta Signed': 1215,
    'End of World War I': 1918,
    'End of World War II': 1945,
    'First Man in Space (Yuri Gagarin)': 1961,
    'Launch of Sputnik 1': 1957,
    'Discovery of X-Rays': 1895,
    'First iPhone Announced': 2007,
    'Human Genome Project Completed': 2003,
    'Hubble Space Telescope Launched': 1990,
    'James Webb Space Telescope Launched': 2021,
  };
  let wrong = 0;
  for (const [title, year] of Object.entries(want)) {
    const e = events.find((x) => x.title === title);
    if (!e) { wrong++; console.error(`    (anchor event missing: ${title})`); continue; }
    if (e.year !== year) { wrong++; console.error(`    (${title}: dataset says ${e.year}, expected ${year})`); }
  }
  ok(wrong === 0, 'data: anchor events carry the right year');
}

console.log(`\nchrono rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
