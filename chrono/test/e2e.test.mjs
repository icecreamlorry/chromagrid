// chrono/test/e2e.test.mjs — End-to-end simulation test for Chrono

import { buildRounds, gradeOrder } from '../js/engine.js';
import { loadEvents } from '../js/dataset.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

console.log('Running Chrono End-to-End Game Flow Simulation...');

(async () => {
  const events = await loadEvents();
  ok(events.length >= 40, 'E2E: dataset loaded with 40+ historical events');

  const dataMap = {};
  events.forEach((e) => { dataMap[e.id] = e; });

  const rounds = buildRounds(events, 'seedChronoE2E', 5);
  ok(rounds.length === 5, 'E2E: 5 quiz rounds generated');

  let correctSlots = 0;
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    const placedIds = round.expected.map((item) => item.id);
    const results = gradeOrder(placedIds, dataMap);
    correctSlots += results.filter(Boolean).length;
  }

  ok(correctSlots === 20, `E2E: 5 rounds of 4 items scored perfectly (20/20 slots correct)`);

  console.log(`\nchrono E2E: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
