// Draughts engine tests. Run: node draughts/test/engine.test.mjs

import {
  initialBoard, newGameState, applyMove, replayMoves, legalMoves, legalMovesForColor,
  movesFrom, findMove, applyPath, seatForColor, material, colorOfPiece, isKing,
} from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eqNum = (m, g, w) => ok(g === w, `${m} (got ${g}, want ${w})`);

// Build an 8×8 board from rows of 8 chars ('.'=empty, w/b/W/B).
function boardFrom(rows) { return rows.map((r) => r.split('').map((ch) => (ch === '.' ? null : ch))); }
// A started state with a custom position and side to move.
function withBoard(board, toMove = 'w', seed = 1) {
  const s = newGameState(seed);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  s.board = board; s.toMove = toMove; s.turn = seatForColor(s, toMove);
  return s;
}

// ---- Initial setup ----------------------------------------------------------
{
  const b = initialBoard();
  const mat = material(b);
  eqNum('white men at start', mat.w.men, 12);
  eqNum('black men at start', mat.b.men, 12);
  ok(mat.w.kings === 0 && mat.b.kings === 0, 'no kings at start');
  // Every piece on a dark square.
  let allDark = true;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] && (r + c) % 2 === 0) allDark = false;
  ok(allDark, 'all pieces on dark squares');
}

// ---- Opening simple moves ---------------------------------------------------
{
  const s = withBoard(initialBoard(), 'w');
  eqNum('white has 7 opening moves', legalMoves(s).length, 7);
  ok(legalMoves(s).every((m) => m.captures.length === 0), 'opening moves are simple');
}

// ---- Forced capture ---------------------------------------------------------
{
  const b = boardFrom([
    '........', '........', '........', '...b....',
    '....w...', '........', '........', '........',
  ]);
  const s = withBoard(b, 'w');
  const moves = legalMoves(s);
  ok(moves.length === 1 && moves[0].captures.length === 1, 'only the capture is legal (forced)');
  ok(findMove(s, [[4, 4], [2, 2]]) !== null, 'capture path found');
  // A simple (non-capture) move is rejected while a capture exists.
  ok(findMove(s, [[4, 4], [5, 5]]) === null, 'non-capture rejected when capture available');
}

// ---- Multi-jump ending in a crown ------------------------------------------
{
  const b = boardFrom([
    '........', '...b....', '........', '...b....',
    '..w.....', '........', '........', '........',
  ]);
  const s = withBoard(b, 'w');
  const mv = findMove(s, [[4, 2], [2, 4], [0, 2]]);
  ok(mv !== null, 'double jump path is legal');
  eqNum('double jump captures two', mv ? mv.captures.length : -1, 2);
  const res = applyPath(b, mv.path);
  ok(res.board[0][2] === 'W', 'lands crowned on the back rank');
  ok(res.crowned === true, 'crowned flag set');
  ok(res.board[1][3] === null && res.board[3][3] === null, 'both jumped men removed');
}

// ---- Man crowns on a simple move -------------------------------------------
{
  const b = boardFrom(['........', '.w......', '........', '........', '........', '........', '........', '........']);
  const res = applyPath(b, [[1, 1], [0, 0]]);
  ok(res.board[0][0] === 'W' && res.crowned, 'man reaching back rank is crowned');
}

// ---- Kings move & capture in all directions --------------------------------
{
  const b = boardFrom(['........', '........', '........', '........', '....W...', '........', '........', '........']);
  const s = withBoard(b, 'w');
  eqNum('lone king has 4 simple moves', legalMoves(s).length, 4);
  ok(legalMoves(s).some((m) => m.path[1][0] === 5), 'king can move backward (down)');
}
{
  // King captures backward.
  const b = boardFrom(['........', '........', '..W.....', '...b....', '........', '........', '........', '........']);
  const s = withBoard(b, 'w');
  ok(findMove(s, [[2, 2], [4, 4]]) !== null, 'king captures backward-right');
}

// ---- A man cannot capture backward (English rule) --------------------------
{
  const b = boardFrom(['........', '........', '..w.....', '...b....', '........', '........', '........', '........']);
  const s = withBoard(b, 'w');
  // White man at (2,2) would have to jump DOWN over (3,3) — illegal for a man.
  ok(findMove(s, [[2, 2], [4, 4]]) === null, 'man cannot capture backward');
}

// ---- Win by leaving the opponent with no pieces / no moves -----------------
{
  const b = boardFrom(['........', '........', '........', '...b....', '....w...', '........', '........', '........']);
  const s = withBoard(b, 'w');
  const wSeat = s.whiteSeat;
  applyMove(s, { move_index: 1, player: wSeat, type: 'move', payload: { path: [[4, 4], [2, 2]] } });
  ok(s.gameOver && s.winner === wSeat, 'capturing the last enemy wins');
  ok(s.endDetail.reason === 'no-moves', 'win reason recorded');
}

// ---- Move log: turns, replay determinism, resign, timeout, draw ------------
{
  const seed = 4242;
  const s0 = newGameState(seed);
  const wSeat = s0.whiteSeat, bSeat = 1 - wSeat;
  const moves = [{ move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } }];
  // 1. w (5,0)->(4,1)  2. b (2,1)->(3,0)  3. w (4,1)->(3,2)
  const script = [
    { player: wSeat, path: [[5, 0], [4, 1]] },
    { player: bSeat, path: [[2, 1], [3, 0]] },
    { player: wSeat, path: [[4, 1], [3, 2]] },
  ];
  script.forEach((mv, i) => moves.push({ move_index: i + 1, player: mv.player, type: 'move', payload: { path: mv.path } }));
  const a = replayMoves(seed, moves);
  const b = replayMoves(seed, [...moves].reverse());
  ok(JSON.stringify(a.board) === JSON.stringify(b.board), 'replay is order-independent');
  eqNum('tpm carried from start', a.tpm, 60);
  ok(a.turn === bSeat, 'back to black after 3 plies');
}
{
  const s = newGameState(7);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === 1 && s.endDetail.reason === 'resign', 'resign ends game');
}
{
  const s = newGameState(8);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } });
  applyMove(s, { move_index: 1, player: 1, type: 'timeout', payload: { player: 1 } });
  ok(s.gameOver && s.winner === 0 && s.endDetail.reason === 'timeout', 'timeout: flagged loses');
}
{
  const s = newGameState(9);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'draw-offer', payload: {} });
  ok(s.drawOffer === 0 && !s.gameOver, 'draw offer recorded');
  applyMove(s, { move_index: 2, player: 1, type: 'draw-accept', payload: {} });
  ok(s.gameOver && s.winner === 'tie' && s.endDetail.reason === 'agreement', 'draw agreed → tie');
}

// ---- Out-of-turn move rejected ---------------------------------------------
{
  const s = withBoard(initialBoard(), 'w');
  let threw = false;
  try { applyMove(s, { move_index: 1, player: 1 - s.whiteSeat, type: 'move', payload: { path: [[2, 1], [3, 0]] } }); } catch { threw = true; }
  ok(threw, 'out-of-turn move rejected');
}

console.log(`\ndraughts engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
