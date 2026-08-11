// Reversi (Othello) engine — deterministic board state folded from an ordered
// move log, like the other LB Games table games.
//
// 8×8 board. A legal move places a disc on an empty square such that, in at
// least one of the eight directions, an unbroken line of enemy discs is
// terminated by one of your own — every disc in every such line flips. Dark
// moves first.
//
// PASSING IS AUTOMATIC. If the side to move has no legal move, the turn hands
// straight back to the opponent and `lastMove.passed` records it. That is the
// official rule, and it means the UI never needs a pass control — the deadlock
// where a player with no move can do nothing simply cannot arise. The game ends
// when NEITHER side has a legal move (which covers a full board and an early
// wipe-out alike); most discs wins, equal is a draw.
//
// Pieces: 'd' (dark) / 'l' (light) / null. Colour is intrinsic to a disc; the
// seat→colour mapping (darkSeat, derived from the room seed) only decides who
// plays first and who wins.

export const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Room seeds arrive as numbers or as strings. Fold either to a 32-bit int the
// same way on every client — `'abc' >>> 0` is 0, which would hand every room
// the identical game.
export function seedInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? '');
  if (s !== '' && Number.isFinite(Number(s))) return Number(s) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const other = (col) => (col === 'd' ? 'l' : 'd');

export function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  // Standard Othello opening: light on d4/e5, dark on d5/e4.
  b[3][3] = 'l'; b[4][4] = 'l';
  b[3][4] = 'd'; b[4][3] = 'd';
  return b;
}

// The discs a play at (r,c) by `color` would flip, or [] if the move is illegal.
export function flipsFor(board, r, c, color) {
  if (!inb(r, c) || board[r][c] !== null) return [];
  const foe = other(color);
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (inb(rr, cc) && board[rr][cc] === foe) { line.push([rr, cc]); rr += dr; cc += dc; }
    // The run must be non-empty AND terminated by one of our own discs.
    if (line.length && inb(rr, cc) && board[rr][cc] === color) out.push(...line);
  }
  return out;
}

// All legal moves for `color` as a Map 'r,c' -> flips[[r,c]…].
export function legalMovesForColor(board, color) {
  const moves = new Map();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] !== null) continue;
      const flips = flipsFor(board, r, c, color);
      if (flips.length) moves.set(`${r},${c}`, flips);
    }
  }
  return moves;
}

export function hasLegalMove(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === null && flipsFor(board, r, c, color).length) return true;
    }
  }
  return false;
}

// Apply a validated placement to a COPY of the board.
export function applyPlacement(board, r, c, color, flips) {
  const nb = board.map((row) => row.slice());
  nb[r][c] = color;
  for (const [fr, fc] of flips) nb[fr][fc] = color;
  return nb;
}

export function countDiscs(board) {
  let dark = 0, light = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === 'd') dark++;
      else if (board[r][c] === 'l') light++;
    }
  }
  return { dark, light };
}

// ---- Game state -------------------------------------------------------------

export function newGameState(seed) {
  return {
    seed,
    darkSeat: mulberry32((seedInt(seed) ^ 0x51ed270b) >>> 0)() < 0.5 ? 0 : 1,
    tpm: 0,
    board: initialBoard(),
    toMove: 'd',          // Dark always plays first
    turn: null,           // seat to move, or null before start
    started: false,
    moveCount: 0,
    drawOffer: null,
    lastMove: null,
    gameOver: false,
    winner: null,         // seat | 'tie'
    endDetail: null,
  };
}

export function colorForSeat(state, seat) { return seat === state.darkSeat ? 'd' : 'l'; }
export function seatForColor(state, color) { return color === 'd' ? state.darkSeat : 1 - state.darkSeat; }
export function colorOf(state, seat) { return colorForSeat(state, seat); }

export function legalMoves(state) {
  if (!state.started || state.gameOver) return new Map();
  return legalMovesForColor(state.board, state.toMove);
}

export function isLegal(state, r, c) {
  return legalMoves(state).has(`${r},${c}`);
}

function finish(state) {
  const { dark, light } = countDiscs(state.board);
  state.gameOver = true;
  state.winner = dark === light ? 'tie' : seatForColor(state, dark > light ? 'd' : 'l');
  state.endDetail = { reason: 'no-moves', dark, light };
}

// Hand the turn on after a placement, skipping a side that cannot move and
// ending the game when neither can.
function advanceTurn(state, lastMoveObj) {
  const nextColor = other(state.toMove);
  if (hasLegalMove(state.board, nextColor)) {
    state.toMove = nextColor;
  } else if (hasLegalMove(state.board, state.toMove)) {
    lastMoveObj.passed = seatForColor(state, nextColor);   // opponent forfeits
  } else {
    state.turn = null;
    finish(state);
    return;
  }
  state.turn = seatForColor(state, state.toMove);
}

export function applyMove(state, move) {
  if (move.move_index !== state.moveCount) {
    throw new Error(`Move ${move.move_index} applied out of order (expected ${state.moveCount})`);
  }
  const seat = move.player;
  const payload = move.payload || {};

  switch (move.type) {
    case 'start': {
      state.board = initialBoard();
      state.toMove = 'd';
      state.tpm = payload.tpm || 0;
      state.started = true;
      state.turn = state.darkSeat;
      state.drawOffer = null;
      state.lastMove = { type: 'start', player: seat, first: state.darkSeat };
      break;
    }
    case 'move': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      const { r, c } = payload;
      const color = state.toMove;
      const flips = flipsFor(state.board, r, c, color);
      if (!flips.length) throw new Error(`Illegal reversi move in log at ${r},${c}`);
      state.board = applyPlacement(state.board, r, c, color, flips);
      state.drawOffer = null;
      const lm = { type: 'move', player: seat, r, c, flips: flips.length, passed: null };
      state.lastMove = lm;
      advanceTurn(state, lm);
      break;
    }
    case 'resign': {
      state.gameOver = true; state.winner = 1 - seat;
      state.endDetail = { reason: 'resign', resignedPlayer: seat };
      state.lastMove = { type: 'resign', player: seat };
      break;
    }
    case 'timeout': {
      const flagged = payload.player ?? seat;
      state.gameOver = true; state.winner = 1 - flagged;
      state.endDetail = { reason: 'timeout', flaggedPlayer: flagged };
      state.lastMove = { type: 'timeout', player: flagged };
      break;
    }
    case 'draw-offer': { state.drawOffer = seat; state.lastMove = { type: 'draw-offer', player: seat }; break; }
    case 'draw-decline': { state.drawOffer = null; state.lastMove = { type: 'draw-decline', player: seat }; break; }
    case 'draw-accept': {
      if (state.drawOffer != null && state.drawOffer !== seat) {
        state.gameOver = true; state.winner = 'tie'; state.endDetail = { reason: 'agreement' };
      }
      state.drawOffer = null; state.lastMove = { type: 'draw-accept', player: seat };
      break;
    }
    default:
      throw new Error(`Unknown move type: ${move.type}`);
  }
  state.moveCount += 1;
  return state;
}

export function replayMoves(seed, moves = []) {
  const state = newGameState(seed);
  const ordered = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const m of ordered) {
    if (m.type === 'rematch') continue;
    applyMove(state, m);
  }
  return state;
}
