// reversi/test/e2e.test.mjs — End-to-end integration test for Reversi

import { newGameState, applyMove, legalMoves, countDiscs } from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

console.log('Running Reversi End-to-End Game Flow Simulation...');

// Simulate full game from start to finish
let state = newGameState();
ok(state.board[27] === 2 && state.board[28] === 1, 'E2E: starting center discs initialized');

let turnCount = 0;
while (!state.gameOver && turnCount < 100) {
  const valid = legalMoves(state.board, state.turn);
  if (valid.size > 0) {
    // Pick first available move
    const pickIdx = Array.from(valid.keys())[0];
    const r = Math.floor(pickIdx / 8), c = pickIdx % 8;
    state = applyMove(state, { r, c });
  } else {
    // Pass turn
    state = applyMove(state, { pass: true });
  }
  turnCount++;
}

ok(state.gameOver === true, `E2E: complete game finished in ${turnCount} turns`);
const finalCounts = countDiscs(state.board);
ok(finalCounts.dark + finalCounts.light > 0, `E2E: final disc count is ${finalCounts.dark} Dark vs ${finalCounts.light} Light`);

console.log(`\nreversi E2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
