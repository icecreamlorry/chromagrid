// Chromagrid engine tests. Run: node chromagrid/test/engine.test.mjs

import {
  COLORS, SHAPES, mulberry32, buildBoardForSeed, calcScore,
  floodFill, idx, rowOf, colOf, visColor, newCell, SPECIALS,
  dailySeed, dailySlug
} from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// Board sizing & indexing helpers
{
  const r = 3, c = 5, cols = 8;
  const i = idx(r, c, cols);
  ok(i === 29, `idx(3,5,8) == 29 (got ${i})`);
  ok(rowOf(i, cols) === r, `rowOf(29,8) == 3`);
  ok(colOf(i, cols) === c, `colOf(29,8) == 5`);
}

// Deterministic PRNG & Board building
{
  const seed = 123456;
  const board1 = buildBoardForSeed(seed, 12, 8);
  const board2 = buildBoardForSeed(seed, 12, 8);
  ok(board1.length === 96, 'board has 96 cells');
  ok(JSON.stringify(board1) === JSON.stringify(board2), 'identical seeds produce identical board snapshots');

  const diffBoard = buildBoardForSeed(654321, 12, 8);
  ok(JSON.stringify(board1) !== JSON.stringify(diffBoard), 'different seeds produce different boards');
}

// Cell structure & colors
{
  const rng = mulberry32(42);
  const cell = newCell(rng);
  ok(cell.frontColor && cell.backColor, 'cell has front and back colors');
  ok(cell.frontColor !== cell.backColor, 'front and back colors are distinct');
  ok(typeof cell.shape === 'number' && cell.shape >= 0 && cell.shape < SHAPES.length, 'shape in range');
  ok(visColor(cell) === cell.frontColor, 'visColor unflipped returns frontColor');
  cell.flipped = true;
  ok(visColor(cell) === cell.backColor, 'visColor flipped returns backColor');
}

// Score calculation formula
{
  ok(calcScore(4) === 100, `calcScore(4) == 100 (4*4*6.25 = 100)`);
  ok(calcScore(6) === 225, `calcScore(6) == 225 (6*6*6.25 = 225)`);
  ok(calcScore(10) === 625, `calcScore(10) == 625`);
}

// Flood fill algorithm
{
  const c1 = COLORS[0], c2 = COLORS[1];
  // 3x3 mock grid
  const state = [
    { frontColor: c1, flipped: false }, { frontColor: c1, flipped: false }, { frontColor: c2, flipped: false },
    { frontColor: c1, flipped: false }, { frontColor: c2, flipped: false }, { frontColor: c2, flipped: false },
    { frontColor: c2, flipped: false }, { frontColor: c2, flipped: false }, { frontColor: c2, flipped: false }
  ];
  const fill0 = floodFill(state, 0, 3, 3);
  ok(fill0.length === 3 && fill0.includes(0) && fill0.includes(1) && fill0.includes(3), 'flood fill finds connected group of 3');

  const fill8 = floodFill(state, 8, 3, 3);
  ok(fill8.length === 6, 'flood fill finds connected group of 6');
}

// Specials bomb explosions
{
  const popped = new Set([12]);
  const addedBomb = SPECIALS.bomb.expandPop(12, popped, 5, 5);
  // Bomb pops 3x3 surrounding cells excluding center 12
  ok(addedBomb.length === 8, `bomb expands to 8 adjacent cells (got ${addedBomb.length})`);
  ok(popped.size === 9, 'popped set contains 9 cells total');
}

// Daily challenge key generators
{
  ok(typeof dailySeed() === 'number', 'dailySeed returns numeric seed');
  ok(dailySlug().startsWith('chromagrid-daily-'), 'dailySlug starts with chromagrid-daily-');
}

console.log(`\nchromagrid engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
