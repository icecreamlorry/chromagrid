// dominoes/test/chain-layout.test.mjs — the snake/corner-turn chain layout.
// Run with: node dominoes/test/chain-layout.test.mjs
//
// layoutChain is a pure function (board.js) with no DOM dependency, so this
// proves the "never needs a horizontal scrollbar" guarantee algebraically
// across many chain lengths and container widths, rather than just eyeballing
// a few screenshots.

import { layoutChain } from '../js/board.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

const METRICS = { tileLen: 66, tileWid: 34, gap: 4 };

// ---- 1. No tile ever exceeds the container width ---------------------------
// Only meaningful once the container can fit at least 2 columns (a domino tile
// is ~66px long — a board narrower than 2 columns can't lay dominoes flat at
// all, full stop, regardless of layout algorithm).
{
  let checked = 0, allWithin = true;
  const cell = METRICS.tileLen + METRICS.gap;
  for (let containerWidth = 2 * cell; containerWidth <= 900; containerWidth += 17) {
    for (let n = 0; n <= 40; n++) {
      const { positions } = layoutChain(n, containerWidth, METRICS);
      for (const p of positions) {
        checked++;
        if (p.x < 0 || p.x + p.w > containerWidth + 1e-9) allWithin = false; // +epsilon for float rounding
      }
    }
  }
  ok(checked > 1000, 'sanity: the sweep actually exercised a lot of positions');
  ok(allWithin, 'layout: no tile, at any chain length or container width, ever exceeds the container — this IS the no-horizontal-scroll guarantee');
}

// ---- 2. Degenerates gracefully ----------------------------------------------
{
  ok(layoutChain(0, 400, METRICS).positions.length === 0, 'n=0: no positions');
  ok(layoutChain(0, 400, METRICS).height >= 0, 'n=0: a non-negative height');
  const one = layoutChain(1, 400, METRICS);
  ok(one.positions.length === 1 && !one.positions[0].rotate, 'n=1: a single straight tile, never a corner');
}

// ---- 3. A short chain that fits in one row never turns ---------------------
{
  const wide = layoutChain(5, 2000, METRICS);
  ok(wide.positions.every((p) => !p.rotate), 'a chain that fits in one row has zero corners');
  ok(wide.positions.every((p) => !p.mirror), 'a single left-to-right row is never mirrored');
  // Strictly increasing x, all at the same y (one straight row).
  for (let i = 1; i < wide.positions.length; i++) {
    ok(wide.positions[i].x > wide.positions[i - 1].x, `row 0 tile ${i} sits to the right of tile ${i - 1}`);
    ok(wide.positions[i].y === wide.positions[0].y, `row 0 tile ${i} shares tile 0's row`);
  }
}

// ---- 4. A forced small width actually turns corners, alternating direction -
{
  // cols = floor(200/70) = 2 → every row is 1 straight tile + 1 corner.
  const { positions, cols } = layoutChain(7, 200, METRICS);
  ok(cols === 2, 'setup: this width gives exactly 2 columns');
  const rotated = positions.filter((p) => p.rotate);
  ok(rotated.length === 3, 'a 7-tile chain in 2 columns turns 3 corners (tiles 1,3,5; tile 6 is the chain\'s own end, not a corner)');
  ok(positions[6].rotate === false, 'the LAST tile in the whole chain is never forced into a corner, even if it lands in the final column');

  // Straight tiles alternate mirror state row by row (row 0 not mirrored, row 1
  // mirrored, row 2 not, …) — mirror only ever applies to STRAIGHT tiles.
  ok(positions.every((p) => !p.rotate || !p.mirror), 'corner tiles are never mirrored (rotation alone conveys the turn)');
  const straightMirrors = positions.filter((p) => !p.rotate).map((p) => p.mirror);
  ok(straightMirrors[0] === false, 'row 0 (left-to-right) tile is not mirrored');
  // tile index 2 is the first straight tile of row 1 (right-to-left) — mirrored.
  ok(positions[2].mirror === true, 'the first straight tile of a right-to-left row IS mirrored');
}

// ---- 5. Corners sit at alternating ends, tracking the snake direction ------
{
  const { positions } = layoutChain(7, 200, METRICS);
  const corners = positions.filter((p) => p.rotate);
  // Row 0 travels left-to-right, so its corner is at the RIGHT (larger x);
  // row 1 travels right-to-left, so its corner is at the LEFT (x≈0); etc.
  ok(corners[0].x > corners[1].x, 'the row-0 corner (rightward run) sits to the right of the row-1 corner (leftward run)');
  ok(corners[1].x < corners[0].x && corners[1].x <= corners[2].x, 'corners alternate sides as the snake reverses direction');
  // Consecutive rows' corners share a column with the FIRST tile of the row
  // they lead into (visual continuity — the new row starts directly under the
  // corner that turned into it). straights[1] (chain index 2) is row 1's first
  // straight tile — the one right after corners[0] (chain index 1, row 0's
  // corner). The two x-coordinates land EXACTLY on top of each other: both
  // reduce to the corner column's centre once the (cell-tileWid)/2 vs gap/2
  // padding difference is accounted for.
  const straights = positions.filter((p) => !p.rotate);
  const expectedX = corners[0].x + (METRICS.tileWid - METRICS.tileLen) / 2;
  ok(Math.abs(expectedX - straights[1].x) < 1e-9,
    'row 1\'s first straight tile lines up exactly under the corner that led into it');
}

// ---- 6. Height grows monotonically with chain length ------------------------
{
  let prevHeight = -1;
  for (let n = 0; n <= 20; n++) {
    const { height } = layoutChain(n, 250, METRICS);
    ok(height >= prevHeight, `height never shrinks as the chain grows (n=${n})`);
    prevHeight = height;
  }
}

console.log(`\ndominoes chain-layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
