// Shared dice tests. Run: node shared/test/dice.test.mjs

import { rollDice, isDoubles, dicePips, openingRoll, pipPositions, diceFace } from '../dice.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// Deterministic + in range.
{
  const seed = 123456;
  for (let i = 0; i < 200; i++) {
    const [a, b] = rollDice(seed, i);
    ok(a >= 1 && a <= 6 && b >= 1 && b <= 6, `roll ${i} in range`);
    const [a2, b2] = rollDice(seed, i);
    ok(a === a2 && b === b2, `roll ${i} deterministic`);
  }
}

// Different seeds give different streams (not all identical).
{
  let diff = 0;
  for (let i = 0; i < 50; i++) {
    const x = rollDice(1, i).join(), y = rollDice(2, i).join();
    if (x !== y) diff++;
  }
  ok(diff > 40, 'different seeds diverge');
}

// Roughly uniform faces over many rolls.
{
  const counts = Array(7).fill(0);
  let n = 0;
  for (let i = 0; i < 6000; i++) { const [a, b] = rollDice(999, i); counts[a]++; counts[b]++; n += 2; }
  const expected = n / 6;
  let okUniform = true;
  for (let f = 1; f <= 6; f++) if (Math.abs(counts[f] - expected) > expected * 0.15) okUniform = false;
  ok(okUniform, `faces roughly uniform (${counts.slice(1).join(',')})`);
}

// Doubles → four pips, else two.
{
  let sawDoubles = false, sawTwo = false;
  for (let i = 0; i < 100; i++) {
    const roll = rollDice(42, i);
    const pips = dicePips(42, i);
    if (isDoubles(roll)) { ok(pips.length === 4, `doubles → 4 pips @${i}`); sawDoubles = true; }
    else { ok(pips.length === 2, `non-doubles → 2 pips @${i}`); sawTwo = true; }
  }
  ok(sawDoubles && sawTwo, 'both doubles and non-doubles occur');
}

// Opening roll always yields a first player.
{
  for (let s = 0; s < 100; s++) {
    const o = openingRoll(s);
    ok(o.a !== o.b, `opening roll not tied @seed ${s}`);
    ok(typeof o.firstIsA === 'boolean', `opening has a first player @${s}`);
  }
}

// Pip geometry.
ok(pipPositions(1).length === 1 && pipPositions(6).length === 6, 'pip counts');
ok(pipPositions(5).every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1), 'pips within unit square');
ok(diceFace(3) === '⚂', 'unicode die face');

console.log(`\nshared dice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
