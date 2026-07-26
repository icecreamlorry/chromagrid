// Chess engine — deterministic board state folded from an ordered move log.
//
// Like the other LB Games engines (Weiqi is the closest sibling), this is pure
// and deterministic: both clients derive the same colours from the room seed and
// rebuild an identical position by replaying the shared move log, so the database
// is the single source of truth and reconnecting is just "replay the moves".
//
// Pieces are stored as two-character strings: colour ('w'|'b') + type
// ('p','n','b','r','q','k'), e.g. 'wp' (white pawn), 'bk' (black king), or null
// for an empty square. The board is board[row][col] with row 0 at the TOP
// (rank 8) and row 7 at the BOTTOM (rank 1) — i.e. White's home rank is row 7,
// so a freshly parsed FEN and the on-screen board share one orientation.
//
// Colour is intrinsic to a piece; the seat→colour mapping (whiteSeat, derived
// from the seed) only decides who moves first, who wins, and which way to orient
// the board for a given viewer — the rest of the app stays seat-indexed like
// every other game.

// Per-move time controls live in shared/time-control.js now — they're common to
// every turn-based table game. The chosen budget still rides this engine's
// `start` move (payload.tpm) so a replay stays self-describing.

const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Small, fast seeded PRNG so both clients derive colours identically.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Board helpers ---------------------------------------------------------

const BACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    b[0][c] = 'b' + BACK[c];
    b[1][c] = 'bp';
    b[6][c] = 'wp';
    b[7][c] = 'w' + BACK[c];
  }
  return b;
}

function inb(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
const other = (color) => (color === 'w' ? 'b' : 'w');
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];

export function sqName([r, c]) { return FILES[c] + (8 - r); }
function fileCh(c) { return FILES[c]; }
function rankCh(r) { return String(8 - r); }

// ---- FEN (used by the tutorial to author positions, and by tests) ----------

export function parseFEN(fen) {
  const [placement, active = 'w', castle = '-', ep = '-'] = fen.trim().split(/\s+/);
  const board = placement.split('/').map((rowStr) => {
    const row = [];
    for (const ch of rowStr) {
      if (/\d/.test(ch)) { for (let i = 0; i < +ch; i++) row.push(null); }
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        row.push(color + ch.toLowerCase());
      }
    }
    while (row.length < 8) row.push(null);
    return row;
  });
  while (board.length < 8) board.push(Array(8).fill(null));
  const castling = {
    wK: castle.includes('K'), wQ: castle.includes('Q'),
    bK: castle.includes('k'), bQ: castle.includes('q'),
  };
  const epSq = ep && ep !== '-' ? [8 - +ep[1], FILES.indexOf(ep[0])] : null;
  return { board, toMove: active, castling, ep: epSq, halfmove: 0 };
}

// A stable key for a position, for threefold-repetition detection.
function posKey(pos) {
  const rows = pos.board.map((row) => row.map((p) => p || '.').join('')).join('/');
  const cr = (pos.castling.wK ? 'K' : '') + (pos.castling.wQ ? 'Q' : '')
    + (pos.castling.bK ? 'k' : '') + (pos.castling.bQ ? 'q' : '') || '-';
  return `${rows} ${pos.toMove} ${cr} ${pos.ep ? sqName(pos.ep) : '-'}`;
}

// ---- Attacks & check -------------------------------------------------------

// Is square (r,c) attacked by any piece of `by` colour? Pure board query
// (independent of castling/ep), used for check detection and castling legality.
export function isAttacked(board, r, c, by) {
  for (const [dr, dc] of KNIGHT) {
    if (board[r + dr]?.[c + dc] === by + 'n') return true;
  }
  for (const [dr, dc] of KING) {
    if (board[r + dr]?.[c + dc] === by + 'k') return true;
  }
  // Pawns: a `by`-pawn sits one row toward its own side and attacks diagonally
  // forward. White pawns attack upward (from row r+1); black from row r-1.
  const pr = r + (by === 'w' ? 1 : -1);
  if (board[pr]?.[c - 1] === by + 'p') return true;
  if (board[pr]?.[c + 1] === by + 'p') return true;
  // Sliding: bishop/queen along diagonals, rook/queen along orthogonals.
  for (const [dr, dc] of DIAG) {
    let nr = r + dr, nc = c + dc;
    while (inb(nr, nc)) {
      const p = board[nr][nc];
      if (p) { if (p[0] === by && (p[1] === 'b' || p[1] === 'q')) return true; break; }
      nr += dr; nc += dc;
    }
  }
  for (const [dr, dc] of ORTHO) {
    let nr = r + dr, nc = c + dc;
    while (inb(nr, nc)) {
      const p = board[nr][nc];
      if (p) { if (p[0] === by && (p[1] === 'r' || p[1] === 'q')) return true; break; }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function kingPos(board, color) {
  const k = color + 'k';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === k) return [r, c];
  return null;
}

export function inCheck(board, color) {
  const kp = kingPos(board, color);
  return kp ? isAttacked(board, kp[0], kp[1], other(color)) : false;
}

// ---- Move generation -------------------------------------------------------

// Pseudo-legal moves for the side to move (king-safety not yet enforced, except
// castling which validates its own path here). Each move is
//   { from:[r,c], to:[r,c], flag }  flag ∈ '', 'double', 'ep', 'promo',
//   'castleK', 'castleQ'.
function genPseudo(pos) {
  const { board, toMove: color, castling, ep } = pos;
  const moves = [];
  const push = (from, to, flag = '') => moves.push({ from, to, flag });

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p[0] !== color) continue;
      const t = p[1];
      if (t === 'p') {
        const dir = color === 'w' ? -1 : 1;
        const startRank = color === 'w' ? 6 : 1;
        const promoRank = color === 'w' ? 0 : 7;
        const one = r + dir;
        if (inb(one, c) && !board[one][c]) {
          push([r, c], [one, c], one === promoRank ? 'promo' : '');
          const two = r + 2 * dir;
          if (r === startRank && !board[two][c]) push([r, c], [two, c], 'double');
        }
        for (const dc of [-1, 1]) {
          const nr = r + dir, nc = c + dc;
          if (!inb(nr, nc)) continue;
          const tp = board[nr][nc];
          if (tp && tp[0] !== color) push([r, c], [nr, nc], nr === promoRank ? 'promo' : '');
          else if (!tp && ep && ep[0] === nr && ep[1] === nc) push([r, c], [nr, nc], 'ep');
        }
      } else if (t === 'n' || t === 'k') {
        for (const [dr, dc] of (t === 'n' ? KNIGHT : KING)) {
          const nr = r + dr, nc = c + dc;
          if (!inb(nr, nc)) continue;
          const tp = board[nr][nc];
          if (!tp || tp[0] !== color) push([r, c], [nr, nc]);
        }
      } else {
        const dirs = t === 'b' ? DIAG : t === 'r' ? ORTHO : DIAG.concat(ORTHO);
        for (const [dr, dc] of dirs) {
          let nr = r + dr, nc = c + dc;
          while (inb(nr, nc)) {
            const tp = board[nr][nc];
            if (!tp) push([r, c], [nr, nc]);
            else { if (tp[0] !== color) push([r, c], [nr, nc]); break; }
            nr += dr; nc += dc;
          }
        }
      }
    }
  }

  // Castling. Rights present, squares between empty, and the king is not in
  // check nor passing through / landing on an attacked square.
  const home = color === 'w' ? 7 : 0;
  const kp = board[home][4];
  const enemy = other(color);
  if (kp === color + 'k') {
    if (castling[color + 'K'] && board[home][7] === color + 'r'
      && !board[home][5] && !board[home][6]
      && !isAttacked(board, home, 4, enemy)
      && !isAttacked(board, home, 5, enemy)
      && !isAttacked(board, home, 6, enemy)) {
      push([home, 4], [home, 6], 'castleK');
    }
    if (castling[color + 'Q'] && board[home][0] === color + 'r'
      && !board[home][1] && !board[home][2] && !board[home][3]
      && !isAttacked(board, home, 4, enemy)
      && !isAttacked(board, home, 3, enemy)
      && !isAttacked(board, home, 2, enemy)) {
      push([home, 4], [home, 2], 'castleQ');
    }
  }
  return moves;
}

// Apply a move to a COPY of the position, returning the new position (plus the
// captured piece, if any). Does not validate legality.
export function makeMove(pos, mv) {
  const board = pos.board.map((row) => row.slice());
  const { from, to, flag } = mv;
  const piece = board[from[0]][from[1]];
  const color = piece[0], t = piece[1];
  let captured = board[to[0]][to[1]];
  let halfmove = pos.halfmove + 1;

  board[to[0]][to[1]] = piece;
  board[from[0]][from[1]] = null;
  let ep = null;

  if (t === 'p') {
    halfmove = 0;
    if (flag === 'double') ep = [(from[0] + to[0]) / 2, from[1]];
    else if (flag === 'ep') { captured = board[from[0]][to[1]]; board[from[0]][to[1]] = null; }
    else if (flag === 'promo') board[to[0]][to[1]] = color + (mv.promo || 'q');
  }
  if (captured) halfmove = 0;
  if (flag === 'castleK') { board[to[0]][5] = board[to[0]][7]; board[to[0]][7] = null; }
  else if (flag === 'castleQ') { board[to[0]][3] = board[to[0]][0]; board[to[0]][0] = null; }

  const castling = { ...pos.castling };
  if (t === 'k') { castling[color + 'K'] = false; castling[color + 'Q'] = false; }
  // A rook leaving or being captured on its home square drops that right.
  const drop = (rr, cc) => {
    if (rr === 7 && cc === 0) castling.wQ = false;
    else if (rr === 7 && cc === 7) castling.wK = false;
    else if (rr === 0 && cc === 0) castling.bQ = false;
    else if (rr === 0 && cc === 7) castling.bK = false;
  };
  drop(from[0], from[1]);
  drop(to[0], to[1]);

  return { board, toMove: other(color), castling, ep, halfmove, captured };
}

// Legal moves for the side to move.
export function genLegal(pos) {
  const color = pos.toMove;
  const out = [];
  for (const mv of genPseudo(pos)) {
    const np = makeMove(pos, mv);
    if (!inCheck(np.board, color)) out.push(mv);
  }
  return out;
}

// ---- SAN (for move descriptions / notifications) ---------------------------

export function toSAN(pos, mv) {
  if (mv.flag === 'castleK' || mv.flag === 'castleQ') {
    const np = makeMove(pos, mv);
    const suffix = checkSuffix(np);
    return (mv.flag === 'castleK' ? 'O-O' : 'O-O-O') + suffix;
  }
  const piece = pos.board[mv.from[0]][mv.from[1]];
  const t = piece[1];
  const isCap = !!pos.board[mv.to[0]][mv.to[1]] || mv.flag === 'ep';
  const dest = sqName(mv.to);
  const np = makeMove(pos, mv);
  const suffix = checkSuffix(np);
  if (t === 'p') {
    let s = isCap ? fileCh(mv.from[1]) + 'x' : '';
    s += dest;
    if (mv.flag === 'promo') s += '=' + (mv.promo || 'q').toUpperCase();
    return s + suffix;
  }
  // Disambiguate against other same-type pieces that can also reach the dest.
  const rivals = genLegal(pos).filter((m) => (
    (m.from[0] !== mv.from[0] || m.from[1] !== mv.from[1])
    && pos.board[m.from[0]][m.from[1]] && pos.board[m.from[0]][m.from[1]][1] === t
    && m.to[0] === mv.to[0] && m.to[1] === mv.to[1]
  ));
  let dis = '';
  if (rivals.length) {
    if (!rivals.some((m) => m.from[1] === mv.from[1])) dis = fileCh(mv.from[1]);
    else if (!rivals.some((m) => m.from[0] === mv.from[0])) dis = rankCh(mv.from[0]);
    else dis = sqName(mv.from);
  }
  return t.toUpperCase() + dis + (isCap ? 'x' : '') + dest + suffix;
}

function checkSuffix(np) {
  if (!inCheck(np.board, np.toMove)) return '';
  return genLegal(np).length === 0 ? '#' : '+';
}

// ---- Material draws --------------------------------------------------------

function scanMinors(board, colorFilter = null) {
  const minors = [];
  let heavy = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p[1] === 'k') continue;
      if (colorFilter && p[0] !== colorFilter) continue;
      if (p[1] === 'n' || p[1] === 'b') minors.push({ p, r, c });
      else heavy = true;
    }
  }
  return { minors, heavy };
}

// Dead-drawn material on the whole board (auto-draw): K vs K, K+minor vs K,
// K+B vs K+B with both bishops on the same colour square.
export function insufficientMaterial(board) {
  const { minors, heavy } = scanMinors(board);
  if (heavy) return false;
  if (minors.length <= 1) return true;
  if (minors.length === 2 && minors.every((m) => m.p[1] === 'b')) {
    return (minors[0].r + minors[0].c) % 2 === (minors[1].r + minors[1].c) % 2;
  }
  return false;
}

// Can `color` NOT possibly deliver checkmate? Used so a flag-fall against a lone
// king (etc.) is scored a draw rather than a win, per FIDE.
function cannotMate(board, color) {
  const { minors, heavy } = scanMinors(board, color);
  if (heavy) return false;
  if (minors.length === 0) return true;
  if (minors.length === 1) return true; // K+N or K+B can't force mate
  if (minors.every((m) => m.p[1] === 'b')) {
    return new Set(minors.map((m) => (m.r + m.c) % 2)).size === 1;
  }
  return false;
}

// ---- Game state ------------------------------------------------------------

export function newGameState(seed) {
  return {
    seed,
    // Which seat plays White (and therefore moves first). Derived from the seed
    // so both clients agree without extra state.
    whiteSeat: mulberry32((seed ^ 0x9e3779b9) >>> 0)() < 0.5 ? 0 : 1,
    tpm: 0,               // seconds per move (0 = unlimited); set by the start move
    board: initialBoard(),
    toMove: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    halfmove: 0,
    repetition: {},
    turn: null,           // seat to move, or null before 'start'
    started: false,
    moveCount: 0,
    check: false,         // is the side to move in check?
    drawOffer: null,      // seat with a standing draw offer, or null
    lastMove: null,
    gameOver: false,
    winner: null,         // seat | 'tie'
    endDetail: null,
  };
}

export function colorForSeat(state, seat) { return seat === state.whiteSeat ? 'w' : 'b'; }
export function seatForColor(state, color) { return color === 'w' ? state.whiteSeat : 1 - state.whiteSeat; }
export function colorOf(state, seat) { return colorForSeat(state, seat); }
export function blackSeat(state) { return 1 - state.whiteSeat; }

function posOf(state) {
  return {
    board: state.board, toMove: state.toMove, castling: state.castling,
    ep: state.ep, halfmove: state.halfmove,
  };
}

// Legal destinations from a square for the side to move (or [] if it's not that
// seat's piece / the game isn't running). Returns move objects.
export function legalMovesFrom(state, r, c) {
  if (!state.started || state.gameOver) return [];
  const p = state.board[r]?.[c];
  if (!p || p[0] !== state.toMove) return [];
  return genLegal(posOf(state)).filter((m) => m.from[0] === r && m.from[1] === c);
}

export function legalMoves(state) {
  if (!state.started || state.gameOver) return [];
  return genLegal(posOf(state));
}

// Does the (from,to) move require choosing a promotion piece?
export function isPromotion(state, from, to) {
  return legalMovesFrom(state, from[0], from[1]).some(
    (m) => m.flag === 'promo' && eq(m.to, to),
  );
}

// The canonical legal move object matching (from,to[,promo]), or null.
export function findLegalMove(state, from, to, promo) {
  const m = legalMovesFrom(state, from[0], from[1]).find((x) => eq(x.to, to));
  if (!m) return null;
  return m.flag === 'promo' ? { ...m, promo: promo || 'q' } : m;
}

// The board that WOULD result from playing (from,to[,promo]), without mutating
// state — used to preview a staged move under "confirm moves". Returns
// { board, san, captured, flag } or null if the move isn't legal.
export function previewMove(state, { from, to, promo }) {
  const pos = posOf(state);
  const base = genLegal(pos).find((m) => eq(m.from, from) && eq(m.to, to));
  if (!base) return null;
  const mv = base.flag === 'promo' ? { ...base, promo: promo || 'q' } : base;
  const np = makeMove(pos, mv);
  return { board: np.board, san: toSAN(pos, mv), captured: np.captured, flag: mv.flag };
}

// ---- Move application ------------------------------------------------------

function endDraw(state, reason) {
  state.gameOver = true;
  state.winner = 'tie';
  state.endDetail = { reason };
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
      state.castling = { wK: true, wQ: true, bK: true, bQ: true };
      state.ep = null;
      state.halfmove = 0;
      state.tpm = payload.tpm || 0;
      state.started = true;
      state.turn = state.whiteSeat;
      state.check = false;
      state.drawOffer = null;
      state.repetition = { [posKey(posOf(state))]: 1 };
      state.lastMove = { type: 'start', player: seat, first: state.whiteSeat };
      break;
    }
    case 'move': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      const pos = posOf(state);
      let mv = genLegal(pos).find((m) => eq(m.from, payload.from) && eq(m.to, payload.to)
        && (m.flag !== 'promo' || true));
      if (!mv) throw new Error(`Illegal move in log: ${sqName(payload.from)}→${sqName(payload.to)}`);
      if (mv.flag === 'promo') mv = { ...mv, promo: payload.promo || 'q' };
      const san = toSAN(pos, mv);
      const np = makeMove(pos, mv);

      state.board = np.board;
      state.toMove = np.toMove;
      state.castling = np.castling;
      state.ep = np.ep;
      state.halfmove = np.halfmove;
      state.turn = seatForColor(state, np.toMove);
      state.drawOffer = null;

      const key = posKey(np);
      if (np.halfmove === 0) state.repetition = {};
      state.repetition[key] = (state.repetition[key] || 0) + 1;

      const chk = inCheck(np.board, np.toMove);
      state.check = chk;
      const nextLegal = genLegal(np);
      const lm = {
        type: 'move', player: seat, from: mv.from, to: mv.to, san,
        flag: mv.flag, promo: mv.promo, captured: np.captured, check: chk, mate: false,
      };

      if (nextLegal.length === 0) {
        if (chk) {
          state.gameOver = true;
          state.winner = seat;
          state.endDetail = { reason: 'checkmate', loser: 1 - seat };
          lm.mate = true;
        } else {
          endDraw(state, 'stalemate');
        }
      } else if (state.halfmove >= 100) {
        endDraw(state, 'fifty');
      } else if (state.repetition[key] >= 3) {
        endDraw(state, 'repetition');
      } else if (insufficientMaterial(np.board)) {
        endDraw(state, 'insufficient');
      }
      state.lastMove = lm;
      break;
    }
    case 'resign': {
      state.gameOver = true;
      state.winner = 1 - seat;
      state.endDetail = { reason: 'resign', resignedPlayer: seat };
      state.lastMove = { type: 'resign', player: seat };
      break;
    }
    case 'timeout': {
      const flagged = payload.player ?? seat;
      const winnerColor = colorForSeat(state, 1 - flagged);
      if (cannotMate(state.board, winnerColor)) endDraw(state, 'timeout-insufficient');
      else {
        state.gameOver = true;
        state.winner = 1 - flagged;
        state.endDetail = { reason: 'timeout', flaggedPlayer: flagged };
      }
      state.lastMove = { type: 'timeout', player: flagged };
      break;
    }
    case 'draw-offer': {
      state.drawOffer = seat;
      state.lastMove = { type: 'draw-offer', player: seat };
      break;
    }
    case 'draw-decline': {
      state.drawOffer = null;
      state.lastMove = { type: 'draw-decline', player: seat };
      break;
    }
    case 'draw-accept': {
      if (state.drawOffer != null && state.drawOffer !== seat) {
        endDraw(state, 'agreement');
      }
      state.drawOffer = null;
      state.lastMove = { type: 'draw-accept', player: seat };
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
    if (m.type === 'rematch') continue; // cross-cutting control move, not gameplay
    applyMove(state, m);
  }
  return state;
}

// Perft (leaf-node count) — a movegen correctness probe used by the tests.
export function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const mv of genLegal(pos)) n += perft(makeMove(pos, mv), depth - 1);
  return n;
}
