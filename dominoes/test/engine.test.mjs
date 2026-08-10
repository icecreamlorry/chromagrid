// dominoes/test/engine.test.mjs — unit tests for Dominoes engine

import { createDeck, dealGame, canPlayTile, playTile, passTurn, replayMoves } from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

{
  const deck = createDeck();
  ok(deck.length === 28, 'Double-Six deck has 28 tiles');
}

{
  const game = dealGame('seed123', 2);
  ok(game.hands[0].length === 7 && game.hands[1].length === 7, 'both players dealt 7 tiles');
  ok(game.boneyard.length === 14, 'boneyard has 14 remaining tiles');
  ok(game.started === true, 'started flag set for home-dashboard replay detection');
}

{
  ok(canPlayTile([3, 5], 5, 2) === true, 'tile matching left end is playable');
  ok(canPlayTile([1, 4], 5, 2) === false, 'tile not matching ends is rejected');
}

{
  let game = dealGame('seed123', 2);
  const firstTile = game.hands[0][0];
  game = playTile(game, 0, 0, 'right');
  ok(game.chain.length === 1, 'first tile played into chain');
  ok(game.leftEnd === firstTile[0] && game.rightEnd === firstTile[1], 'ends updated');
  ok(game.turn === 1, 'turn passed to next player');
}

{
  const moves = [
    { type: 'move', player: 0, payload: { tileIdx: 0, side: 'right' } },
  ];
  const replayed = replayMoves('seed123', moves);
  ok(replayed.chain.length === 1, 'replayMoves correctly reconstructs chain');
  ok(replayed.turn === 1, 'replayMoves correctly advances turn');
}

console.log(`\ndominoes engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
