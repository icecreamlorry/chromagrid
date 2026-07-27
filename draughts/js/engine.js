// Draughts (English draughts / checkers) engine — deterministic board state
// folded from an ordered move log, like the other LB Games table games.
//
// 8×8 board, play on the dark squares only. Each side has 12 men. Men move one
// square diagonally FORWARD and capture forward by jumping an adjacent enemy to
// the empty square beyond. Captures are FORCED (if any capture exists you must
// take one), and a multi-jump must continue with the same piece until it can
// jump no more. A man reaching the far rank is CROWNED a king; a king moves and
// captures one square in ANY diagonal direction. Crowning ends the move (a man
// that reaches the back rank mid-jump stops — the English rule). Maximum-capture
// is NOT required (unlike international draughts).
//
// Pieces: 'w'/'b' = white/black man, 'W'/'B' = king, or null. Colour is intrinsic
// to a piece; the seat→colour mapping (whiteSeat, from the seed) only decides who
// moves first and who wins. White is at the bottom (rows 5–7) and moves up
// (row-decreasing); Black is at the top and moves down.

export const TIME_LABEL = 'Draughts';

// Two consecutive no-progress plies threshold for the drawing rule (no capture
// and no man move). 100 plies = 50 moves each; a generous casual cutoff.
export const NO_PROGRESS_LIMIT = 100;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const dark = (r, c) => (r + c) % 2 === 1;
const colorOfPiece = (p) => (p ? (p.toLowerCase() === 'w' ? 'w' : 'b') : null);
const isKing = (p) => p === 'W' || p === 'B';
const other = (col) => (col === 'w' ? 'b' : 'w');
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];

export function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if (dark(r, c)) b[r][c] = 'b';
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if (dark(r, c)) b[r][c] = 'w';
  return b;
}

// Diagonal directions a piece may step/capture in.
function dirsFor(piece) {
  if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return colorOfPiece(piece) === 'w' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

function crownRow(color) { return color === 'w' ? 0 : 7; }

// Extend a capture path from (r,c) holding `piece`, given the squares already
// captured (as a Set of 'r,c'). Returns a list of full paths (each an array of
// [r,c] starting at the current square). A man that lands on its crown row ends
// the sequence.
function captureContinuations(board, r, c, piece, captured) {
  const results = [];
  const color = colorOfPiece(piece);
  for (const [dr, dc] of dirsFor(piece)) {
    const mr = r + dr, mc = c + dc;          // the enemy being jumped
    const lr = r + 2 * dr, lc = c + 2 * dc;  // landing square
    if (!inb(lr, lc) || !inb(mr, mc)) continue;
    const mid = board[mr][mc];
    if (!mid || colorOfPiece(mid) !== other(color)) continue;
    if (captured.has(`${mr},${mc}`)) continue;
    if (board[lr][lc] !== null && !(lr === r && lc === c)) continue; // landing must be empty
    // Perform the jump on a scratch board.
    const nb = board.map((row) => row.slice());
    nb[r][c] = null; nb[mr][mc] = null;
    let landed = piece;
    const nowKing = !isKing(piece) && lr === crownRow(color);
    if (nowKing) landed = piece.toUpperCase();
    nb[lr][lc] = landed;
    const nc = new Set(captured); nc.add(`${mr},${mc}`);
    if (nowKing) { results.push([[r, c], [lr, lc]]); continue; } // crowning ends the move
    const subs = captureContinuations(nb, lr, lc, landed, nc);
    if (subs.length === 0) results.push([[r, c], [lr, lc]]);
    // Each sub-path already starts at the landing square (lr,lc); prepend origin.
    else for (const s of subs) results.push([[r, c], ...s]);
  }
  return results;
}

// All legal moves for `color` as { path:[[r,c]…], captures:[[r,c]…] }. If any
// capture exists anywhere, only captures are returned (forced-capture rule).
export function legalMovesForColor(board, color) {
  const captures = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || colorOfPiece(p) !== color) continue;
      for (const path of captureContinuations(board, r, c, p, new Set())) {
        captures.push({ path, captures: capturedSquares(path) });
      }
    }
  }
  if (captures.length) return captures;

  const simple = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || colorOfPiece(p) !== color) continue;
      for (const [dr, dc] of dirsFor(p)) {
        const nr = r + dr, nc = c + dc;
        if (inb(nr, nc) && board[nr][nc] === null) simple.push({ path: [[r, c], [nr, nc]], captures: [] });
      }
    }
  }
  return simple;
}

// The enemy squares captured along a jump path (midpoint of each 2-square hop).
function capturedSquares(path) {
  const caps = [];
  for (let i = 1; i < path.length; i++) {
    const [r0, c0] = path[i - 1], [r1, c1] = path[i];
    if (Math.abs(r1 - r0) === 2) caps.push([(r0 + r1) / 2, (c0 + c1) / 2]);
  }
  return caps;
}

// Apply a validated move path to a COPY of the board; returns { board, captured,
// crowned }.
export function applyPath(board, path) {
  const nb = board.map((row) => row.slice());
  const [sr, sc] = path[0];
  let piece = nb[sr][sc];
  const color = colorOfPiece(piece);
  nb[sr][sc] = null;
  const captured = [];
  for (let i = 1; i < path.length; i++) {
    const [r0, c0] = path[i - 1], [r1, c1] = path[i];
    if (Math.abs(r1 - r0) === 2) {
      const mr = (r0 + r1) / 2, mc = (c0 + c1) / 2;
      captured.push([mr, mc]); nb[mr][mc] = null;
    }
  }
  const [er, ec] = path[path.length - 1];
  let crowned = false;
  if (!isKing(piece) && er === crownRow(color)) { piece = piece.toUpperCase(); crowned = true; }
  nb[er][ec] = piece;
  return { board: nb, captured, crowned };
}

function countPieces(board, color) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (colorOfPiece(board[r][c]) === color) n++;
  return n;
}

// ---- Game state ------------------------------------------------------------

export function newGameState(seed) {
  return {
    seed,
    whiteSeat: mulberry32((seed ^ 0x51ed270b) >>> 0)() < 0.5 ? 0 : 1,
    tpm: 0,
    board: initialBoard(),
    toMove: 'w',          // White moves first
    turn: null,           // seat to move, or null before start
    started: false,
    moveCount: 0,
    noProgress: 0,        // plies since the last capture or man move
    drawOffer: null,
    lastMove: null,
    gameOver: false,
    winner: null,         // seat | 'tie'
    endDetail: null,
  };
}

export function colorForSeat(state, seat) { return seat === state.whiteSeat ? 'w' : 'b'; }
export function seatForColor(state, color) { return color === 'w' ? state.whiteSeat : 1 - state.whiteSeat; }
export function colorOf(state, seat) { return colorForSeat(state, seat); }

export function legalMoves(state) {
  if (!state.started || state.gameOver) return [];
  return legalMovesForColor(state.board, state.toMove);
}

// Legal moves that start at (r,c) for the side to move (UI selection).
export function movesFrom(state, r, c) {
  return legalMoves(state).filter((m) => eq(m.path[0], [r, c]));
}

// Validate & find the canonical legal move matching a submitted path.
export function findMove(state, path) {
  return legalMoves(state).find((m) => samePath(m.path, path)) || null;
}
function samePath(a, b) {
  return a.length === b.length && a.every((p, i) => eq(p, b[i]));
}

function endDraw(state, reason) {
  state.gameOver = true; state.winner = 'tie'; state.endDetail = { reason };
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
      state.toMove = 'w';
      state.tpm = payload.tpm || 0;
      state.started = true;
      state.turn = state.whiteSeat;
      state.noProgress = 0;
      state.drawOffer = null;
      state.lastMove = { type: 'start', player: seat, first: state.whiteSeat };
      break;
    }
    case 'move': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      const mv = findMove(state, payload.path);
      if (!mv) throw new Error('Illegal draughts move in log');
      const piece = state.board[mv.path[0][0]][mv.path[0][1]];
      const wasMan = !isKing(piece);
      const res = applyPath(state.board, mv.path);
      state.board = res.board;
      state.toMove = other(state.toMove);
      state.turn = seatForColor(state, state.toMove);
      state.drawOffer = null;
      // No-progress counter: reset on a capture or any man move.
      if (res.captured.length || wasMan) state.noProgress = 0; else state.noProgress += 1;
      state.lastMove = {
        type: 'move', player: seat, path: mv.path,
        captured: res.captured, crowned: res.crowned,
      };
      // End conditions: opponent has no pieces or no legal move → mover wins.
      const oppMoves = legalMovesForColor(state.board, state.toMove);
      if (countPieces(state.board, state.toMove) === 0 || oppMoves.length === 0) {
        state.gameOver = true; state.winner = seat; state.endDetail = { reason: 'no-moves', loser: 1 - seat };
      } else if (state.noProgress >= NO_PROGRESS_LIMIT) {
        endDraw(state, 'no-progress');
      }
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
      if (state.drawOffer != null && state.drawOffer !== seat) endDraw(state, 'agreement');
      state.drawOffer = null; state.lastMove = { type: 'draw-accept', player: seat };
      break;
    }
    default:
      throw new Error(`Unknown move type: ${move.type}`);
  }
  state.moveCount += 1;
  return state;
}

export function replayMoves(seed, moves) {
  const state = newGameState(seed);
  const ordered = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const m of ordered) {
    if (m.type === 'rematch') continue;
    applyMove(state, m);
  }
  return state;
}

// Material tally { w:{men,kings}, b:{men,kings} } for the panels.
export function material(board) {
  const t = { w: { men: 0, kings: 0 }, b: { men: 0, kings: 0 } };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const col = colorOfPiece(p);
      if (isKing(p)) t[col].kings += 1; else t[col].men += 1;
    }
  }
  return t;
}

export { colorOfPiece, isKing };
