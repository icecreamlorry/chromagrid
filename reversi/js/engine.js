// reversi/js/engine.js — pure deterministic Reversi / Othello game engine

export const BOARD_SIZE = 8;
export const CELL_COUNT = 64;

// 1 = Dark (Black, Player 0, moves first), 2 = Light (White, Player 1)
export const DARK = 1;
export const LIGHT = 2;

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

export function rcToIdx(r, c) {
  return r * BOARD_SIZE + c;
}

export function idxToRc(idx) {
  return [Math.floor(idx / BOARD_SIZE), idx % BOARD_SIZE];
}

export function newGameState() {
  const board = new Array(CELL_COUNT).fill(0);
  // Standard starting 4 discs in the center
  board[rcToIdx(3, 3)] = LIGHT;
  board[rcToIdx(3, 4)] = DARK;
  board[rcToIdx(4, 3)] = DARK;
  board[rcToIdx(4, 4)] = LIGHT;

  return {
    board,
    turn: 0, // 0 = Dark's turn, 1 = Light's turn
    gameOver: false,
    winner: null, // 0, 1, or null (draw)
    counts: { dark: 2, light: 2 },
    lastMove: null,
    passCount: 0,
    started: true,
  };
}

export function countDiscs(board) {
  let dark = 0, light = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (board[i] === DARK) dark++;
    else if (board[i] === LIGHT) light++;
  }
  return { dark, light };
}

// Returns array of indices that would flip if player plays at (r, c)
export function getFlips(board, r, c, playerIndex) {
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return [];
  const idx = rcToIdx(r, c);
  if (board[idx] !== 0) return [];

  const playerPiece = playerIndex === 0 ? DARK : LIGHT;
  const oppPiece = playerIndex === 0 ? LIGHT : DARK;
  const allFlips = [];

  for (const [dr, dc] of DIRECTIONS) {
    let nr = r + dr;
    let nc = c + dc;
    const dirFlips = [];

    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
      const nIdx = rcToIdx(nr, nc);
      const piece = board[nIdx];
      if (piece === oppPiece) {
        dirFlips.push(nIdx);
      } else if (piece === playerPiece) {
        if (dirFlips.length > 0) {
          allFlips.push(...dirFlips);
        }
        break;
      } else {
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  return allFlips;
}

// Returns Map<cellIndex, flipsArray> of all legal moves for playerIndex (0 or 1)
export function legalMoves(board, playerIndex) {
  const moves = new Map();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const idx = rcToIdx(r, c);
      if (board[idx] === 0) {
        const flips = getFlips(board, r, c, playerIndex);
        if (flips.length > 0) {
          moves.set(idx, flips);
        }
      }
    }
  }
  return moves;
}

export function applyMove(state, move) {
  if (state.gameOver) return state;

  const board = state.board.slice();
  const playerIndex = state.turn;
  const playerPiece = playerIndex === 0 ? DARK : LIGHT;

  if (move.pass) {
    const nextTurn = 1 - playerIndex;
    const nextMoves = legalMoves(board, nextTurn);
    const passCount = state.passCount + 1;
    const gameOver = passCount >= 2 || (nextMoves.size === 0 && legalMoves(board, playerIndex).size === 0);

    const counts = countDiscs(board);
    let winner = null;
    if (gameOver) {
      if (counts.dark > counts.light) winner = 0;
      else if (counts.light > counts.dark) winner = 1;
    }

    return {
      board,
      turn: nextTurn,
      gameOver,
      winner,
      counts,
      lastMove: { pass: true, player: playerIndex },
      passCount,
    };
  }

  const { r, c } = move;
  const idx = rcToIdx(r, c);
  const flips = getFlips(board, r, c, playerIndex);
  if (flips.length === 0) {
    throw new Error(`Invalid move at (${r}, ${c}) for player ${playerIndex}`);
  }

  board[idx] = playerPiece;
  for (const flipIdx of flips) {
    board[flipIdx] = playerPiece;
  }

  const nextTurn = 1 - playerIndex;
  const nextMoves = legalMoves(board, nextTurn);
  const myMoves = legalMoves(board, playerIndex);
  const counts = countDiscs(board);

  const isFull = counts.dark + counts.light === CELL_COUNT;
  const noMovesBoth = nextMoves.size === 0 && myMoves.size === 0;
  const gameOver = isFull || noMovesBoth;

  let winner = null;
  if (gameOver) {
    if (counts.dark > counts.light) winner = 0;
    else if (counts.light > counts.dark) winner = 1;
  }

  return {
    board,
    turn: nextTurn,
    gameOver,
    winner,
    counts,
    lastMove: { r, c, idx, flips, player: playerIndex },
    passCount: 0,
  };
}

export function replayMoves(seed, moves = []) {
  let state = newGameState();

  for (const move of moves) {
    if (move.type === 'move' && move.payload) {
      const p = move.payload;
      if (p.timeout != null) {
        const winner = 1 - p.timeout;
        state = { ...state, gameOver: true, winner, timeoutWinner: winner };
        break;
      }
      if (p.r != null && p.c != null) {
        state = applyMove(state, { r: p.r, c: p.c });
      } else if (p.pass) {
        state = applyMove(state, { pass: true });
      }
    }
  }

  return state;
}
