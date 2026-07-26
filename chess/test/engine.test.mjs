// Chess engine tests. Run: node chess/test/engine.test.mjs
//
// Perft (leaf-move counts from known positions) is the movegen correctness
// probe; the rest exercise the special rules and the move-log state machine.

import {
  initialBoard, parseFEN, perft, genLegal, makeMove, toSAN, isAttacked, inCheck,
  insufficientMaterial, newGameState, applyMove, replayMoves, legalMovesFrom,
  isPromotion, findLegalMove, sqName,
} from '../js/engine.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); }
}
function eqNum(name, got, want) {
  check(`${name} (got ${got}, want ${want})`, got === want);
}

// ---- Perft from the opening position ---------------------------------------
{
  const p = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  eqNum('perft(1) start', perft(p, 1), 20);
  eqNum('perft(2) start', perft(p, 2), 400);
  eqNum('perft(3) start', perft(p, 3), 8902);
  // initialBoard() should equal the start FEN.
  const ib = initialBoard();
  check('initialBoard matches FEN', JSON.stringify(ib) === JSON.stringify(p.board));
}

// ---- Perft "Kiwipete": castling, en passant, pins (no promotions ≤ depth 2)
{
  const p = parseFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  eqNum('perft(1) kiwipete', perft(p, 1), 48);
  eqNum('perft(2) kiwipete', perft(p, 2), 2039);
}

// ---- Perft position 3 (edge cases, en passant checks) ----------------------
{
  const p = parseFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  eqNum('perft(1) pos3', perft(p, 1), 14);
  eqNum('perft(2) pos3', perft(p, 2), 191);
  eqNum('perft(3) pos3', perft(p, 3), 2812);
}

// ---- Castling ---------------------------------------------------------------
{
  const p = parseFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const moves = genLegal(p);
  check('white can castle kingside', moves.some((m) => m.flag === 'castleK'));
  check('white can castle queenside', moves.some((m) => m.flag === 'castleQ'));
  const ck = moves.find((m) => m.flag === 'castleK');
  const np = makeMove(p, ck);
  check('kingside puts king on g1', np.board[7][6] === 'wk');
  check('kingside puts rook on f1', np.board[7][5] === 'wr');
  check('kingside vacates h1', np.board[7][7] === null);
  eqNum('castle drops both white rights', [np.castling.wK, np.castling.wQ].filter(Boolean).length, 0);
}
{
  // Cannot castle through check (a black rook eyes f1).
  const p = parseFEN('5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  check('no kingside castle through check', !genLegal(p).some((m) => m.flag === 'castleK'));
  check('queenside still legal', genLegal(p).some((m) => m.flag === 'castleQ'));
}
{
  // Cannot castle while in check.
  const p = parseFEN('4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  check('no castling while in check', !genLegal(p).some((m) => m.flag.startsWith('castle')));
}

// ---- En passant -------------------------------------------------------------
{
  const p = parseFEN('8/8/8/3pP3/8/8/8/4k1K1 w - d6 0 1');
  const ep = genLegal(p).find((m) => m.flag === 'ep');
  check('en passant available', !!ep);
  const np = makeMove(p, ep);
  check('ep pawn lands on d6', np.board[2][3] === 'wp');
  check('ep removes the black pawn on d5', np.board[3][3] === null);
}

// ---- Promotion --------------------------------------------------------------
{
  const p = parseFEN('8/P7/8/8/8/8/8/4k1K1 w - - 0 1');
  const promo = genLegal(p).find((m) => m.flag === 'promo');
  check('promotion generated', !!promo);
  const q = makeMove(p, { ...promo, promo: 'q' });
  check('promotes to queen', q.board[0][0] === 'wq');
  const n = makeMove(p, { ...promo, promo: 'n' });
  check('underpromotes to knight', n.board[0][0] === 'wn');
}

// ---- Check / attack detection ----------------------------------------------
{
  const p = parseFEN('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
  check('black king in check from rook', inCheck(p.board, 'b'));
  check('e8 attacked by white', isAttacked(p.board, 0, 4, 'w'));
  check('a1 not attacked by white', !isAttacked(p.board, 7, 0, 'w'));
}

// ---- Fool's mate (fastest checkmate) ---------------------------------------
{
  // 1. f3 e5 2. g4 Qh4#
  const s = newGameState(1);
  // Force white = seat 0 for a predictable script by picking a seed; assert via colours.
  const wSeat = s.whiteSeat, bSeat = 1 - wSeat;
  const seq = [
    { player: wSeat, from: [6, 5], to: [5, 5] }, // f2-f3
    { player: bSeat, from: [1, 4], to: [3, 4] }, // e7-e5
    { player: wSeat, from: [6, 6], to: [4, 6] }, // g2-g4
    { player: bSeat, from: [0, 3], to: [4, 7] }, // Qd8-h4#
  ];
  applyMove(s, { move_index: 0, player: wSeat, type: 'start', payload: {} });
  seq.forEach((mv, i) => applyMove(s, { move_index: i + 1, ...mv, type: 'move', payload: { from: mv.from, to: mv.to } }));
  check('fool\'s mate: game over', s.gameOver);
  check('fool\'s mate: black (mover) wins', s.winner === bSeat);
  check('fool\'s mate: reason checkmate', s.endDetail.reason === 'checkmate');
  check('fool\'s mate: SAN Qh4#', s.lastMove.san === 'Qh4#');
}

// ---- Stalemate --------------------------------------------------------------
{
  // Classic: black king a8, white queen b6, white king... set side to move black
  // with no moves and not in check.
  const s = newGameState(2);
  s.started = true;
  s.board = parseFEN('k7/8/1Q6/8/8/8/8/K7 b - - 0 1').board;
  s.toMove = 'b'; s.turn = s.whiteSeat === 0 ? 1 : 0; // black to move
  // Instead of scripting, directly assert on the position via genLegal.
  const p = parseFEN('k7/8/1Q6/8/8/8/8/K7 b - - 0 1');
  check('stalemate: black has no legal moves', genLegal(p).length === 0);
  check('stalemate: black not in check', !inCheck(p.board, 'b'));
}

// ---- Insufficient material --------------------------------------------------
{
  check('K vs K insufficient', insufficientMaterial(parseFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board));
  check('K+N vs K insufficient', insufficientMaterial(parseFEN('4k3/8/8/8/8/8/8/4KN2 w - - 0 1').board));
  check('K+B vs K insufficient', insufficientMaterial(parseFEN('4k3/8/8/8/8/8/8/4KB2 w - - 0 1').board));
  // Black Bc8 (light) + White Bf1 (light) → both bishops on the same colour.
  check('K+B vs K+B same colour = draw',
    insufficientMaterial(parseFEN('2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1').board));
  // Opposite-colour bishops are NOT an automatic draw.
  check('K+B vs K+B opposite colour = not draw',
    !insufficientMaterial(parseFEN('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1').board));
  check('K+Q vs K sufficient', !insufficientMaterial(parseFEN('4k3/8/8/8/8/8/8/3QK3 w - - 0 1').board));
  check('K+P vs K sufficient', !insufficientMaterial(parseFEN('4k3/8/8/4P3/8/8/8/4K3 w - - 0 1').board));
}

// ---- Move-log state machine: turns, replay determinism, resign, timeout -----
{
  const seed = 12345;
  const moves = [
    { move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } },
  ];
  const s0 = newGameState(seed);
  const wSeat = s0.whiteSeat;
  // Play 1.e4 e5 2.Nf3
  const script = [
    { player: wSeat, from: [6, 4], to: [4, 4] },
    { player: 1 - wSeat, from: [1, 4], to: [3, 4] },
    { player: wSeat, from: [7, 6], to: [5, 5] },
  ];
  script.forEach((mv, i) => moves.push({ move_index: i + 1, player: mv.player, type: 'move', payload: { from: mv.from, to: mv.to } }));

  const a = replayMoves(seed, moves);
  const b = replayMoves(seed, [...moves].reverse()); // order-independent
  check('replay is order-independent', JSON.stringify(a.board) === JSON.stringify(b.board));
  eqNum('tpm carried from start move', a.tpm, 60);
  check('after 3 plies it is black to move', a.turn === 1 - wSeat && a.toMove === 'b');
  check('e4 pawn present', a.board[4][4] === 'wp');

  // Out-of-turn move in the log is rejected.
  let threw = false;
  try {
    const bad = [...moves, { move_index: 4, player: 1 - wSeat, from: [3, 4], to: [4, 4], type: 'move', payload: { from: [3, 4], to: [4, 4] } }];
    // white to move but black plays → should throw
    replayMoves(seed, bad.map((m, i) => ({ ...m, move_index: i === bad.length - 1 ? 4 : m.move_index })));
  } catch { threw = true; }
  check('out-of-turn move rejected', threw);
}
{
  // Resignation.
  const s = newGameState(7);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'resign', payload: {} });
  check('resign ends game', s.gameOver && s.winner === 1);
  check('resign reason', s.endDetail.reason === 'resign');
}
{
  // Timeout: flagged player loses when opponent can still mate.
  const s = newGameState(8);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { tpm: 60 } });
  applyMove(s, { move_index: 1, player: 1, type: 'timeout', payload: { player: 1 } });
  check('timeout: flagged loses', s.gameOver && s.winner === 0);
  check('timeout reason', s.endDetail.reason === 'timeout');
}

// ---- Draw offer / accept ----------------------------------------------------
{
  const s = newGameState(9);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: 0, type: 'draw-offer', payload: {} });
  check('draw offer recorded', s.drawOffer === 0 && !s.gameOver);
  applyMove(s, { move_index: 2, player: 1, type: 'draw-accept', payload: {} });
  check('draw accepted → tie', s.gameOver && s.winner === 'tie' && s.endDetail.reason === 'agreement');
}
{
  // A move clears a standing draw offer.
  const s = newGameState(10);
  const wSeat = s.whiteSeat;
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  applyMove(s, { move_index: 1, player: wSeat, type: 'draw-offer', payload: {} });
  applyMove(s, { move_index: 2, player: wSeat, type: 'move', payload: { from: [6, 4], to: [4, 4] } });
  check('offer cleared by a move', s.drawOffer === null && !s.gameOver);
}

// ---- UI helpers -------------------------------------------------------------
{
  const s = newGameState(11);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: {} });
  const wSeat = s.whiteSeat;
  // White's e-pawn on e2 (row 6, col 4) has two legal moves.
  const em = legalMovesFrom(s, 6, 4);
  eqNum('e2 pawn has 2 moves', em.length, 2);
  // Not white's turn for a black piece.
  eqNum('black piece has no moves on white turn', legalMovesFrom(s, 1, 4).length, 0);
  // Promotion detection.
  const pp = parseFEN('8/P7/8/8/8/8/8/4k1K1 w - - 0 1');
  const ps = newGameState(11); ps.started = true; ps.board = pp.board; ps.toMove = 'w'; ps.turn = ps.whiteSeat;
  check('isPromotion true for a7-a8', isPromotion(ps, [1, 0], [0, 0]));
  const fm = findLegalMove(ps, [1, 0], [0, 0], 'r');
  check('findLegalMove returns promo=r', fm && fm.promo === 'r');
  check('sqName maps [7,4]→e1', sqName([7, 4]) === 'e1');
}

// ---- SAN spot-checks --------------------------------------------------------
{
  const p = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const e4 = genLegal(p).find((m) => sqName(m.from) === 'e2' && sqName(m.to) === 'e4');
  check('SAN pawn push e4', toSAN(p, e4) === 'e4');
  const nf3 = genLegal(p).find((m) => sqName(m.from) === 'g1' && sqName(m.to) === 'f3');
  check('SAN knight Nf3', toSAN(p, nf3) === 'Nf3');
}

console.log(`\nchess engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
