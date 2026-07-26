// Shared time-control tests. Run: node shared/test/time-control.test.mjs

import {
  TIME_CONTROLS, TIME_ORDER, timeKeyFor, fmtClock, renderClockPair, createMoveTimer,
} from '../time-control.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗ ' + name); } }

// fmtClock
check('fmtClock 0 → 0:00', fmtClock(0) === '0:00');
check('fmtClock 59 → 0:59', fmtClock(59) === '0:59');
check('fmtClock 75 → 1:15', fmtClock(75) === '1:15');
check('fmtClock 3600 → 1h 0m', fmtClock(3600) === '1h 0m');
check('fmtClock 3660 → 1h 1m', fmtClock(3660) === '1h 1m');
check('fmtClock 86400 → 1d 0h', fmtClock(86400) === '1d 0h');
check('fmtClock 259200 → 3d 0h', fmtClock(259200) === '3d 0h');
check('fmtClock rounds up', fmtClock(0.2) === '0:01');

// timeKeyFor
check('timeKeyFor 0 → unlimited', timeKeyFor(0) === 'unlimited');
check('timeKeyFor 60 → m1', timeKeyFor(60) === 'm1');
check('timeKeyFor 86400 → d1', timeKeyFor(86400) === 'd1');
check('timeKeyFor unknown → unlimited', timeKeyFor(12345) === 'unlimited');
check('TIME_ORDER covers all controls', TIME_ORDER.length === Object.keys(TIME_CONTROLS).length);

// renderClockPair (fake DOM elements)
{
  const my = { textContent: '', className: '' };
  const opp = { textContent: '', className: '' };
  // Unlimited → both ∞.
  renderClockPair(my, opp, { tpm: 0, live: true, turn: 0, mySeat: 0, remainingSec: 5 });
  check('unlimited shows ∞', my.textContent === '∞' && opp.textContent === '∞');
  // 60s control, my turn, 12s left → my clock active+low, opp shows full budget.
  renderClockPair(my, opp, { tpm: 60, live: true, turn: 0, mySeat: 0, remainingSec: 12 });
  check('active my clock shows remaining', my.textContent === '0:12');
  check('active+low class', my.className.includes('active') && my.className.includes('low'));
  check('inactive opp shows budget', opp.textContent === '1:00' && !opp.className.includes('active'));
  // Not low when > 20s.
  renderClockPair(my, opp, { tpm: 60, live: true, turn: 0, mySeat: 0, remainingSec: 45 });
  check('not low above 20s', !my.className.includes('low'));
}

// createMoveTimer flag logic (drive with refresh(), no real interval)
{
  let flagged = null;
  const now = Date.now();
  // Opponent (seat 1) is 4s past a 60s budget → past the 2.5s grace → flag.
  let ctx = { tpm: 60, live: true, turn: 1, anchorMs: now - 64_000 };
  const t = createMoveTimer({
    elMy: null, elOpp: null, mySeat: () => 0, context: () => ctx,
    onFlag: (s) => { flagged = s; }, graceMs: 2500,
  });
  t.refresh();
  check('opponent flagged past grace', flagged === 1);
  // Only fires once until resetClaim.
  flagged = null; t.refresh();
  check('does not re-flag same turn', flagged === null);
  // My own clock 1s over → flags immediately (no grace for myself).
  t.resetClaim(); ctx = { ...ctx, turn: 0, anchorMs: now - 61_000 };
  t.refresh();
  check('my own flag fires at zero', flagged === 0);
}
{
  // Within grace, opponent NOT yet flagged.
  let flagged = null;
  const ctx = { tpm: 60, live: true, turn: 1, anchorMs: Date.now() - 61_000 }; // 1s past zero, within 2.5s grace
  const t = createMoveTimer({ elMy: null, elOpp: null, mySeat: () => 0, context: () => ctx, onFlag: (s) => { flagged = s; } });
  t.refresh();
  check('opponent not flagged within grace', flagged === null);
}
{
  // Unlimited never flags.
  let flagged = null;
  const ctx = { tpm: 0, live: true, turn: 0, anchorMs: Date.now() - 999_999 };
  const t = createMoveTimer({ elMy: null, elOpp: null, mySeat: () => 0, context: () => ctx, onFlag: (s) => { flagged = s; } });
  t.refresh();
  check('unlimited never flags', flagged === null);
}

console.log(`\nshared time-control: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
