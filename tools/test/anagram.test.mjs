import assert from 'node:assert/strict';
import {
  parseLengths, parseLetters, resizeLocked, consumeLocked, reconcileOrder,
  shuffle, reshuffle, dealOrder, lockLetter, unlockLetter, view, MAX_TOTAL,
} from '../js/anagram.js';

// A tiny deterministic RNG so shuffles are repeatable in tests.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('parseLengths accepts a single length and multi-word shapes', () => {
  assert.deepEqual(parseLengths('9'), [9]);
  assert.deepEqual(parseLengths(' 5,4 '), [5, 4]);
  assert.deepEqual(parseLengths('5 4'), [5, 4]);
  assert.deepEqual(parseLengths('3-2-4'), [3, 2, 4]);
  assert.deepEqual(parseLengths('(7,3)'), []);      // brackets aren't digits
  assert.deepEqual(parseLengths(''), []);
  assert.deepEqual(parseLengths('0'), []);
  assert.deepEqual(parseLengths('abc'), []);
  assert.deepEqual(parseLengths(String(MAX_TOTAL + 1)), []);
  assert.deepEqual(parseLengths(String(MAX_TOTAL)), [MAX_TOTAL]);
});

test('parseLetters keeps letters only, upper-cased, in order', () => {
  assert.deepEqual(parseLetters('Rain, bow! 2'), ['R', 'A', 'I', 'N', 'B', 'O', 'W']);
  assert.deepEqual(parseLetters(null), []);
});

test('resizeLocked keeps the prefix that still fits', () => {
  assert.deepEqual(resizeLocked(['A', null, 'C'], 2), ['A', null]);
  assert.deepEqual(resizeLocked(['A'], 3), ['A', null, null]);
});

test('consumeLocked removes locked letters from the pool and flags missing ones', () => {
  const pool = parseLetters('LISTEN');
  const { remaining, missing } = consumeLocked(pool, [null, 'I', null, null, 'N', null]);
  assert.deepEqual(remaining, ['L', 'S', 'T', 'E']);
  assert.deepEqual(missing, [false, false, false, false, false, false]);

  const r2 = consumeLocked(pool, ['Q', null, null, 'N', null, 'N']);
  assert.deepEqual(r2.missing, [true, false, false, false, false, true]);
  assert.deepEqual(r2.remaining, ['L', 'I', 'S', 'T', 'E']);
});

test('reconcileOrder drops gone letters in place and appends new ones', () => {
  assert.deepEqual(reconcileOrder(['T', 'A', 'C', 'S'], ['C', 'A', 'S']), ['A', 'C', 'S']);
  assert.deepEqual(reconcileOrder(['T', 'A'], ['A', 'T', 'X']), ['T', 'A', 'X']);
  assert.deepEqual(reconcileOrder([], ['B', 'A']), ['B', 'A']);
});

test('shuffle is a permutation and reshuffle never returns the same row', () => {
  const rng = lcg(7);
  const src = parseLetters('ABCDEFG');
  const s = shuffle(src, rng);
  assert.deepEqual(s.slice().sort(), src.slice().sort());
  assert.deepEqual(src, parseLetters('ABCDEFG'), 'input untouched');
  for (let seed = 1; seed < 40; seed++) {
    const r = reshuffle(['A', 'B'], lcg(seed));
    assert.deepEqual(r, ['B', 'A']);
  }
  assert.deepEqual(reshuffle(['A', 'A', 'A'], lcg(3)), ['A', 'A', 'A']);
  assert.deepEqual(reshuffle([], lcg(3)), []);
});

test('dealOrder lays the arrangement over the unlocked boxes, spare letters left over', () => {
  const locked = [null, 'I', null, null];
  assert.deepEqual(dealOrder(['L', 'S', 'T', 'E', 'N'], locked),
    { fill: ['L', null, 'S', 'T'], leftover: ['E', 'N'] });
  assert.deepEqual(dealOrder(['L'], locked), { fill: ['L', null, null, null], leftover: [] });
});

test('locking the letter you can see removes that copy and keeps the neighbours put', () => {
  // Boxes show  E N L I S T  (order dealt over six unlocked boxes).
  const m0 = { locked: [null, null, null, null, null, null], order: parseLetters('ENLIST') };
  const m1 = lockLetter(m0, 2, 'L');
  assert.deepEqual(m1.locked, [null, null, 'L', null, null, null]);
  assert.deepEqual(m1.order, parseLetters('ENIST'));
  assert.deepEqual(dealOrder(m1.order, m1.locked).fill, ['E', 'N', null, 'I', 'S', 'T']);

  // Lock an S into box 0: the visible S (box 4) leaves, boxes shift by one.
  const m2 = lockLetter(m1, 0, 'S');
  assert.deepEqual(m2.order, parseLetters('ENIT'));
  assert.deepEqual(dealOrder(m2.order, m2.locked).fill, [null, 'E', null, 'N', 'I', 'T']);

  // Unlock the L: it comes back where it was.
  const m3 = unlockLetter(m2, 2);
  assert.deepEqual(m3.locked, ['S', null, null, null, null, null]);
  assert.deepEqual(dealOrder(m3.order, m3.locked).fill, [null, 'E', 'L', 'N', 'I', 'T']);

  // Overtype a locked box: old letter back, new letter out.
  const m4 = lockLetter(m3, 0, 'T');
  assert.deepEqual(m4.locked, ['T', null, null, null, null, null]);
  assert.deepEqual(m4.order.slice().sort(), parseLetters('ELNIS').sort());

  // Locking a letter that isn't there leaves the arrangement alone.
  const m5 = lockLetter(m4, 1, 'Q');
  assert.deepEqual(m5.order, m4.order);
  assert.equal(unlockLetter(m5, 3).order.length, m5.order.length, 'unlocking an unlocked box is a no-op');
});

test('view derives fill, missing flags, leftovers and the letter balance', () => {
  const v = view({ lengths: [3, 3], locked: [null, 'I', null, null, 'Q', null], poolText: 'listen', order: [] });
  assert.equal(v.total, 6);
  assert.deepEqual(v.missing, [false, false, false, false, true, false]);
  assert.deepEqual(v.order, ['L', 'S', 'T', 'E', 'N']);
  assert.deepEqual(v.fill, ['L', null, 'S', 'T', null, 'E']);
  assert.deepEqual(v.leftover, ['N']);
  assert.equal(v.balance, 1);      // Q isn't from the fodder, so one fodder letter is spare
  assert.equal(v.lockedCount, 2);

  const short = view({ lengths: [5], locked: [null, null, null, null, null], poolText: 'cat', order: ['T', 'A', 'C'] });
  assert.equal(short.balance, -2);
  assert.deepEqual(short.fill, ['T', 'A', 'C', null, null]);
});

console.log(`\n${n} tests passed`);
