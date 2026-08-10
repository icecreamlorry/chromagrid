// reversi/test/engine.test.mjs — unit tests for Reversi engine

import { newGameState, applyMove, legalMoves, getFlips, replayMoves } from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// Test starting board state
{
  const state = newGameState();
  ok(state.board[27] === 2 && state.board[28] === 1, 'center setup row 3');
  ok(state.board[35] === 1 && state.board[36] === 2, 'center setup row 4');
  ok(state.counts.dark === 2 && state.counts.light === 2, 'initial counts 2-2');
  ok(state.turn === 0, 'Dark moves first');
}

// Test legal moves for Dark initially
{
  const state = newGameState();
  const moves = legalMoves(state.board, 0);
  ok(moves.size === 4, 'Dark has 4 legal opening moves');
  ok(moves.has(19) && moves.has(26) && moves.has(37) && moves.has(44), 'valid opening indices');
}

// Test applying a move and disc flipping
{
  let state = newGameState();
  // Dark plays (2, 3) -> index 19
  state = applyMove(state, { r: 2, c: 3 });
  ok(state.board[19] === 1, 'played cell set to Dark');
  ok(state.board[27] === 1, 'sandwiched Light disc flipped to Dark');
  ok(state.counts.dark === 4 && state.counts.light === 1, 'counts updated to 4-1');
  ok(state.turn === 1, 'turn passed to Light');
}

// Test replay determinism
{
  const moves = [
    { type: 'move', payload: { r: 2, c: 3 } },
    { type: 'move', payload: { r: 2, c: 2 } },
  ];
  const finalState = replayMoves('seed123', moves);
  ok(finalState.counts.dark + finalState.counts.light === 6, 'replay resulting total discs is 6');
}

console.log(`\nreversi engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
