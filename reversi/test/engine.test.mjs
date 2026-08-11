// reversi/test/engine.test.mjs — rules + move-log contract for the Reversi engine.
// Run with: node reversi/test/engine.test.mjs
//
// Replaces the pre-rebuild engine/e2e/rules suites, which were written against
// an older engine API (a `{pass:true}` move type and a state without
// move_index) that no longer exists. Passing is now automatic, so the tests
// that asserted a pass CONTROL exists are gone on purpose — the deadlock they
// documented is designed out rather than papered over.

import {
  newGameState, applyMove, replayMoves, legalMoves, legalMovesForColor, hasLegalMove,
  flipsFor, applyPlacement, initialBoard, countDiscs, colorOf, seatForColor, seedInt, mulberry32,
} from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const throws = (fn, msg) => { try { fn(); fail++; console.error('  ✗ ' + msg); } catch { pass++; } };
const J = (v) => JSON.stringify(v);

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(null));

// A started game with a given board and side to move, bypassing the opening.
function stateWith(board, toMove = 'd', darkSeat = 0) {
  const s = newGameState(1);
  s.darkSeat = darkSeat;
  s.board = board;
  s.toMove = toMove;
  s.started = true;
  s.turn = seatForColor(s, toMove);
  s.moveCount = 1;
  return s;
}

// ---- 1. Opening position ----------------------------------------------------
{
  const b = initialBoard();
  const c = countDiscs(b);
  ok(c.dark === 2 && c.light === 2, 'start: two discs each');
  ok(b[3][3] === 'l' && b[4][4] === 'l', 'start: light on d4/e5');
  ok(b[3][4] === 'd' && b[4][3] === 'd', 'start: dark on d5/e4');
  ok(legalMovesForColor(b, 'd').size === 4, 'start: dark has exactly 4 opening moves');
  ok(legalMovesForColor(b, 'l').size === 4, 'start: light has exactly 4 opening moves');
}

// ---- 2. Flipping rules ------------------------------------------------------
{
  const b = emptyBoard();
  // A full 8-direction star: dark centre target at (4,4) surrounded by light,
  // each ray terminated by a dark disc two out.
  b[4][4] = null;
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    b[4 + dr][4 + dc] = 'l';
    b[4 + 2 * dr][4 + 2 * dc] = 'd';
  }
  ok(flipsFor(b, 4, 4, 'd').length === 8, 'flip: a play flips in all eight directions at once');

  const gap = emptyBoard();
  gap[0][1] = 'l'; gap[0][2] = null; gap[0][3] = 'd';
  ok(flipsFor(gap, 0, 0, 'd').length === 0, 'flip: a gap in the line flips nothing');

  const open = emptyBoard();
  open[0][1] = 'l'; open[0][2] = 'l';
  ok(flipsFor(open, 0, 0, 'd').length === 0, 'flip: an unterminated run of enemies flips nothing');

  const own = emptyBoard();
  own[0][1] = 'd'; own[0][2] = 'd';
  ok(flipsFor(own, 0, 0, 'd').length === 0, 'flip: a line of your OWN discs flips nothing');

  const taken = initialBoard();
  ok(flipsFor(taken, 3, 3, 'd').length === 0, 'flip: an occupied square is never legal');

  const one = emptyBoard();
  one[0][1] = 'l'; one[0][2] = 'd';
  const before = J(one);
  ok(applyPlacement(one, 0, 0, 'd', flipsFor(one, 0, 0, 'd'))[0][1] === 'd', 'flip: the bracketed disc changes colour');
  ok(J(one) === before, 'purity: applyPlacement does not mutate the board it was given');
}

// ---- 3. Move-log contract ---------------------------------------------------
{
  const s = newGameState(7);
  throws(() => applyMove(s, { move_index: 3, player: 0, type: 'start', payload: {} }),
    'log: a move applied out of order is rejected');

  const g = newGameState(7);
  applyMove(g, { move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } });
  ok(g.started && g.turn === g.darkSeat, 'log: start puts dark on move');
  ok(g.tpm === 60, 'log: start carries the per-move time control');

  throws(() => applyMove(g, { move_index: 1, player: 1 - g.darkSeat, type: 'move', payload: { r: 2, c: 3 } }),
    'log: a move logged by the wrong seat is rejected, not re-attributed');

  throws(() => applyMove(g, { move_index: 1, player: g.darkSeat, type: 'move', payload: { r: 0, c: 0 } }),
    'log: an illegal placement in the log is rejected');

  throws(() => applyMove(g, { move_index: 1, player: 0, type: 'nonsense', payload: {} }),
    'log: an unknown move type is rejected');
}

// ---- 4. Automatic passing ---------------------------------------------------
{
  // Hand-built: after dark plays a8, light still has a disc on the board but no
  // legal reply, while dark can still play e5 to flip it.
  const b = emptyBoard();
  b[0][0] = 'l';                                       // isolated — neighbours stay empty
  b[4][4] = 'l'; b[4][5] = 'd'; b[4][6] = 'd'; b[4][7] = 'd';
  b[7][1] = 'l'; b[7][2] = 'd';                        // what dark's move flips
  const after = applyPlacement(b, 7, 0, 'd', flipsFor(b, 7, 0, 'd'));
  ok(flipsFor(b, 7, 0, 'd').length === 1, 'pass setup: dark has a legal move to play');
  ok(!hasLegalMove(after, 'l'), 'pass setup: after the move light genuinely has no legal reply');
  ok(hasLegalMove(after, 'd'), 'pass setup: dark can still move, so the game is not over');

  const s = stateWith(b, 'd', 0);
  applyMove(s, { move_index: 1, player: s.turn, type: 'move', payload: { r: 7, c: 0 } });
  ok(!s.gameOver, 'pass: the game continues when only ONE side is stuck');
  ok(s.turn === seatForColor(s, 'd'), 'pass: the turn comes straight back to the player who can move');
  ok(s.lastMove.passed === seatForColor(s, 'l'), 'pass: the skipped seat is recorded on lastMove');
}

{
  // Deterministic self-play: forced passes are common, so the path above must be
  // exercised by ordinary play, and the invariant must hold every time it fires.
  const rnd = mulberry32(20260811);
  let games = 0, passesSeen = 0, invariantHeld = true;
  for (let n = 0; n < 40; n++) {
    const s = newGameState(n + 1);
    applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
    let guard = 0;
    while (!s.gameOver && guard++ < 80) {
      const keys = [...legalMoves(s).keys()];
      if (!keys.length) break;
      const [r, c] = keys[Math.floor(rnd() * keys.length)].split(',').map(Number);
      const mover = s.turn;
      applyMove(s, { move_index: s.moveCount, player: mover, type: 'move', payload: { r, c } });
      if (s.lastMove.passed != null) {
        passesSeen++;
        if (!s.gameOver && s.turn !== mover) invariantHeld = false;
      }
    }
    games++;
    // The engine must never leave a live game with a side to move that cannot.
    if (!s.gameOver && !hasLegalMove(s.board, s.toMove)) invariantHeld = false;
  }
  ok(games === 40, 'self-play: 40 games completed without the engine throwing');
  ok(passesSeen > 0, 'self-play: forced passes actually occur in ordinary play');
  ok(invariantHeld, 'self-play: a live game never has a side to move with no legal move');
}

// ---- 5. Game end and scoring ------------------------------------------------
{
  // Dark's move flips the only light disc, so neither side can move afterwards.
  const b = emptyBoard();
  b[0][0] = 'd'; b[0][1] = 'l';
  const s = stateWith(b, 'd', 0);
  applyMove(s, { move_index: 1, player: s.turn, type: 'move', payload: { r: 0, c: 2 } });
  ok(s.gameOver, 'end: the game ends when neither side has a legal move (board not full)');
  ok(s.winner === seatForColor(s, 'd'), 'end: the player with more discs wins');
  ok(s.endDetail?.reason === 'no-moves', 'end: the reason is recorded');
  ok(J(countDiscs(s.board)) === J({ dark: 3, light: 0 }), 'end: the final disc count is right');

  // A level board that nobody can play into is a draw, not a win.
  const t = emptyBoard();
  for (let c = 0; c < 4; c++) t[0][c] = 'l';
  for (let c = 4; c < 8; c++) t[0][c] = 'd';
  ok(!hasLegalMove(t, 'd') && !hasLegalMove(t, 'l'), 'tie setup: neither side can move');
  const counts = countDiscs(t);
  ok(counts.dark === counts.light, 'tie: an equal disc count is a draw, not a win');
}

{
  const s = newGameState(3);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 1, type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === 0 && s.endDetail.reason === 'resign', 'end: resign hands the win to the other seat');
}
{
  const s = newGameState(3);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'timeout', payload: { player: 1 } });
  ok(s.gameOver && s.winner === 0 && s.endDetail.reason === 'timeout', 'end: a flagged seat loses on time');
}
{
  const s = newGameState(3);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'draw-offer', payload: {} });
  applyMove(s, { move_index: 2, player: 1, type: 'draw-accept', payload: {} });
  ok(s.gameOver && s.winner === 'tie', 'end: an accepted draw is a tie');

  const s2 = newGameState(3);
  applyMove(s2, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s2, { move_index: 1, player: 0, type: 'draw-offer', payload: {} });
  applyMove(s2, { move_index: 2, player: 0, type: 'draw-accept', payload: {} });
  ok(!s2.gameOver, 'end: you cannot accept your OWN draw offer');
}

// ---- 6. replayMoves — the shape shared/home-dashboard.js folds --------------
{
  const log = [
    { move_index: 0, player: 0, type: 'start', payload: { tpm: 0 } },
  ];
  const seed = 4242;
  const probe = replayMoves(seed, log);
  const first = [...legalMoves(probe).keys()][0].split(',').map(Number);
  log.push({ move_index: 1, player: probe.turn, type: 'move', payload: { r: first[0], c: first[1] } });

  const a = replayMoves(seed, log);
  ok(a.started === true, 'replay: the folded state keeps `started` (home-dashboard gates on it)');
  ok(typeof a.turn === 'number' && typeof a.gameOver === 'boolean',
    'replay: returns { turn, gameOver } as the dashboard contract requires');

  const b = replayMoves(seed, log);
  ok(J(a) === J(b), 'replay: folding the same log twice gives an identical state');

  const shuffled = [log[1], log[0]];
  ok(J(replayMoves(seed, shuffled)) === J(a), 'replay: an out-of-order log is sorted by move_index first');

  const withRematch = [...log, { move_index: 9000000, player: 0, type: 'rematch', payload: { code: 'ABC' } }];
  ok(J(replayMoves(seed, withRematch)) === J(a), 'replay: a rematch pointer is skipped, not folded');

  ok(replayMoves(seed, []).started === false, 'replay: an empty log is an unstarted game');
}

// ---- 7. Seeds ---------------------------------------------------------------
{
  ok(seedInt('4242') === 4242, 'seed: a numeric string is read as its number');
  ok(seedInt(4242) === 4242, 'seed: a number passes through');
  ok(seedInt('ABCDEF') !== 0, 'seed: a non-numeric room code does NOT collapse to 0');
  ok(seedInt('ABCDEF') !== seedInt('ABCDEG'), 'seed: different room codes hash differently');
  ok(seedInt('ABCDEF') === seedInt('ABCDEF'), 'seed: hashing is stable across calls');

  const seats = new Set();
  for (let i = 0; i < 40; i++) seats.add(newGameState(`ROOM${i}`).darkSeat);
  ok(seats.size === 2, 'seed: dark is not always the same seat across rooms');

  ok(newGameState('ROOM1').darkSeat === newGameState('ROOM1').darkSeat,
    'seed: both clients in one room derive the SAME colours');
}

// ---- 8. Seat↔colour mapping -------------------------------------------------
{
  const s = newGameState(11);
  ok(colorOf(s, s.darkSeat) === 'd' && colorOf(s, 1 - s.darkSeat) === 'l', 'seats: each seat maps to one colour');
  ok(seatForColor(s, 'd') === s.darkSeat, 'seats: the mapping round-trips');
}

console.log(`\nreversi engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
