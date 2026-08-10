// chrono/test/engine.test.mjs — unit tests for Chrono engine

import { buildRounds, gradeOrder } from '../js/engine.js';
import { loadEvents } from '../js/dataset.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

(async () => {
  const events = await loadEvents();
  const rounds = buildRounds(events, 'testseed123', 2);
  
  ok(rounds.length === 2, 'generated 2 rounds from dataset');
  ok(rounds[0].items.length === 4, 'each round has 4 items');
  ok(rounds[0].expected[0].year <= rounds[0].expected[1].year, 'expected answer is chronologically ordered');

  console.log(`\nchrono engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
