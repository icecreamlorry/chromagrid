// dominoes/test/e2e.test.mjs — End-to-end simulation test for Dominoes

import { dealGame, playTile, passTurn, drawFromBoneyard, canPlayTile, getPlaySide } from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

console.log('Running Dominoes End-to-End Game Flow Simulation...');

let game = dealGame('seedE2E', 2);
ok(game.hands[0].length === 7 && game.hands[1].length === 7, 'E2E: 2 players dealt 7 tiles each');

let turns = 0;
while (!game.gameOver && turns < 100) {
  const currentSeat = game.turn;
  const hand = game.hands[currentSeat];
  const playableIdx = hand.findIndex((t) => canPlayTile(t, game.leftEnd, game.rightEnd));

  if (playableIdx >= 0) {
    const tile = hand[playableIdx];
    const side = getPlaySide(tile, game.leftEnd, game.rightEnd);
    game = playTile(game, currentSeat, playableIdx, side);
  } else if (game.boneyard.length > 0) {
    game = drawFromBoneyard(game, currentSeat);
  } else {
    game = passTurn(game, currentSeat);
  }
  turns++;
}

ok(game.gameOver === true, `E2E: Dominoes game finished in ${turns} moves`);
ok(game.chain.length > 0, `E2E: chain has ${game.chain.length} played domino tiles`);

console.log(`\ndominoes E2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
