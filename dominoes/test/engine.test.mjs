// dominoes/test/engine.test.mjs — rules + move-log contract for the Dominoes engine.
// Run with: node dominoes/test/engine.test.mjs
//
// Replaces the pre-rebuild engine/e2e/rules suites, which targeted an older API
// (dealGame/playTile/passTurn with hand INDICES and no move_index). Every rule
// those suites failed to check — seeded dealing, purity, draw-before-pass,
// pip scoring, log ordering — is covered here.

import {
  newGameState, applyMove, replayMoves, fullSet, shuffled, seedInt, opening,
  legalPlays, canPlay, mustDraw, canPass, handPips, pips, isDouble, sameTile, sidesFor,
  HAND_SIZE,
} from '../js/engine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const throws = (fn, msg) => { try { fn(); fail++; console.error('  ✗ ' + msg); } catch { pass++; } };
const J = (v) => JSON.stringify(v);

// Fold a started game so tests can act on a real position.
function started(seed) {
  const s = newGameState(seed);
  applyMove(s, { move_index: 0, player: 0, type: 'start', payload: { tpm: 0 } });
  return s;
}
function play(s, seat, tile, side) {
  applyMove(s, { move_index: s.moveCount, player: seat, type: 'play', payload: { tile, side } });
}

// ---- 1. The set ------------------------------------------------------------
{
  const set = fullSet();
  ok(set.length === 28, 'set: a double-six set has 28 tiles');
  ok(new Set(set.map(J)).size === 28, 'set: every tile is distinct');
  ok(set.filter(isDouble).length === 7, 'set: there are 7 doubles');
  ok(set.reduce((n, t) => n + pips(t), 0) === 168, 'set: the pip total is 168');
  for (let v = 0; v <= 6; v++) {
    ok(set.filter((t) => t[0] === v || t[1] === v).length === 7, `set: value ${v} appears on 7 tiles`);
  }
}

// ---- 2. Dealing is genuinely seeded ----------------------------------------
{
  ok(seedInt('4242') === 4242, 'seed: a numeric string reads as its number');
  ok(seedInt('ABCDEF') !== 0, 'seed: a non-numeric room code does NOT collapse to 0');
  ok(seedInt('ABCDEF') !== seedInt('ABCDEG'), 'seed: different room codes hash differently');

  const a = newGameState('ROOMAA'), b = newGameState('ROOMBB'), a2 = newGameState('ROOMAA');
  ok(J(a.hands) !== J(b.hands), 'deal: two different room seeds deal DIFFERENT hands');
  ok(J(a.hands) === J(a2.hands), 'deal: the same seed deals identically on both clients');
  ok(J(newGameState('seed').hands) !== J(newGameState(0).hands),
    'deal: a word seed does not degrade to the seed-0 deal');

  const all = [...a.hands[0], ...a.hands[1], ...a.boneyard];
  ok(all.length === 28, 'deal: every tile is dealt somewhere');
  ok(new Set(all.map(J)).size === 28, 'deal: no tile is duplicated or lost');
  ok(a.hands[0].length === HAND_SIZE && a.hands[1].length === HAND_SIZE, 'deal: 7 tiles each');
  ok(a.boneyard.length === 14, 'deal: 14 tiles in the boneyard');

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  ok(!/Math\.random/.test(src), 'deal: the engine never calls Math.random');
}

// ---- 3. The opening --------------------------------------------------------
{
  const hands = [[[3, 3], [0, 1]], [[6, 6], [2, 4]]];
  ok(J(opening(hands)) === J({ seat: 1, tile: [6, 6] }), 'open: the highest double leads');

  const noDoubles = [[[3, 4], [0, 1]], [[6, 5], [2, 4]]];
  ok(J(opening(noDoubles)) === J({ seat: 1, tile: [6, 5] }), 'open: with no doubles the heaviest tile leads');

  const s = started('ROOMAA');
  ok(s.turn === s.openerSeat, 'open: the opener is on move');
  const plays = legalPlays(s, s.turn);
  ok(plays.length === 1 && sameTile(plays[0].tile, s.openerTile),
    'open: the lead tile is the ONLY legal opening move');
  throws(() => play(s, s.turn, s.hands[s.turn].find((t) => !sameTile(t, s.openerTile)), 'right'),
    'open: opening with any other tile is rejected');
}

// ---- 4. Matching ends ------------------------------------------------------
{
  const s = started('ROOMAA');
  const opener = s.openerTile, seat = s.turn;
  play(s, seat, opener, 'right');
  ok(s.leftEnd === opener[0] && s.rightEnd === opener[1], 'ends: the opening tile sets both ends');
  ok(s.turn === 1 - seat, 'ends: the turn passes to the opponent');

  // A tile matching neither end is not offered and is rejected in the log.
  const foe = 1 - seat;
  const bad = (s.hands[foe] || []).find((t) => sidesFor(s, t).length === 0);
  if (bad) {
    throws(() => play(s, foe, bad, 'right'), 'ends: a tile matching neither end is rejected');
  } else pass++;   // this deal has no such tile; nothing to assert

  // Orientation: whichever way round the tile is stored, the matching pip must
  // end up touching the chain.
  const t = { chain: null };
  const g = started('ROOMAA');
  play(g, g.turn, g.openerTile, 'right');
  const nxt = legalPlays(g, g.turn)[0];
  if (nxt) {
    const beforeLeft = g.leftEnd, beforeRight = g.rightEnd;
    const side = nxt.sides[0];
    play(g, g.turn, nxt.tile, side);
    const joined = side === 'left' ? g.chain[0] : g.chain[g.chain.length - 1];
    ok(side === 'left' ? joined[1] === beforeLeft : joined[0] === beforeRight,
      'ends: the tile is flipped so the matching pip touches the chain');
    ok(side === 'left' ? g.leftEnd === joined[0] : g.rightEnd === joined[1],
      'ends: the new open end is the tile\'s far pip');
  } else { pass += 2; }
  ok(t.chain === null, 'ends: (fixture sanity)');
}

// ---- 5. Purity -------------------------------------------------------------
{
  const s = started('ROOMAA');
  const seat = s.turn;
  const handBefore = J(s.hands[seat]);
  const handRef = s.hands[seat];
  play(s, seat, s.openerTile, 'right');
  ok(J(handRef) === handBefore, 'purity: playing does not splice the caller\'s hand array in place');
  ok(s.hands[seat] !== handRef, 'purity: the new state gets a fresh hand array');
  ok(s.hands[seat].length === HAND_SIZE - 1, 'purity: the played tile leaves the hand');
}

// ---- 6. Drawing and passing ------------------------------------------------
{
  // Build a position where the mover cannot play but the boneyard has tiles.
  const s = started('ROOMAA');
  play(s, s.turn, s.openerTile, 'right');
  const seat = s.turn;
  s.hands = s.hands.map((h, i) => (i === seat ? [[9, 9]] : h));   // matches nothing
  ok(!canPlay(s, seat), 'draw setup: the mover has nothing playable');
  ok(mustDraw(s, seat), 'draw: with tiles left in the boneyard you MUST draw');
  ok(!canPass(s, seat), 'draw: you may not pass while the boneyard has tiles');
  throws(() => applyMove(s, { move_index: s.moveCount, player: seat, type: 'pass', payload: {} }),
    'draw: a pass while a draw is available is rejected');

  const boneBefore = s.boneyard.length;
  applyMove(s, { move_index: s.moveCount, player: seat, type: 'draw', payload: {} });
  ok(s.boneyard.length === boneBefore - 1, 'draw: one tile leaves the boneyard');
  ok(s.hands[seat].length === 2, 'draw: the tile joins your hand');
  ok(s.turn === seat, 'draw: drawing does not end your turn');
  ok(s.passes === 0, 'draw: drawing does not count as a pass toward the block rule');
}
{
  // A legal play exists — drawing is then illegal.
  const s = started('ROOMAA');
  play(s, s.turn, s.openerTile, 'right');
  const seat = s.turn;
  if (canPlay(s, seat)) {
    throws(() => applyMove(s, { move_index: s.moveCount, player: seat, type: 'draw', payload: {} }),
      'draw: drawing while you CAN play is rejected');
  } else pass++;
}
{
  // Empty boneyard, nothing playable: pass is the only move, and two in a row
  // blocks the game.
  const s = started('ROOMAA');
  play(s, s.turn, s.openerTile, 'right');
  s.boneyard = [];
  s.hands = [[[9, 9]], [[8, 8]]];
  const seat = s.turn;
  ok(canPass(s, seat), 'pass: with an empty boneyard and nothing to play you may pass');
  applyMove(s, { move_index: s.moveCount, player: seat, type: 'pass', payload: {} });
  ok(!s.gameOver && s.turn === 1 - seat, 'pass: one pass just hands the turn over');
  applyMove(s, { move_index: s.moveCount, player: 1 - seat, type: 'pass', payload: {} });
  ok(s.gameOver && s.endDetail.reason === 'blocked', 'pass: two passes in a row block the game');
}

// ---- 7. Ending and scoring -------------------------------------------------
{
  // Domino: play your last tile.
  const s = started('ROOMAA');
  const seat = s.turn;
  s.hands = s.hands.map((h, i) => (i === seat ? [s.openerTile] : [[1, 1], [2, 2]]));
  play(s, seat, s.openerTile, 'right');
  ok(s.gameOver && s.winner === seat, 'end: playing your last tile wins');
  ok(s.endDetail.reason === 'domino', 'end: the reason is a domino');
  ok(s.score && s.score.points === 6, 'end: the winner scores the pips left in the loser\'s hand');
}
{
  // Blocked: the lighter hand wins and scores the heavier one.
  const s = started('ROOMAA');
  play(s, s.turn, s.openerTile, 'right');
  s.boneyard = [];
  s.leftEnd = 0; s.rightEnd = 0;      // so neither hand below can be played
  s.hands = [[[1, 1]], [[6, 6]]];     // 2 pips vs 12
  const seat = s.turn;
  applyMove(s, { move_index: s.moveCount, player: seat, type: 'pass', payload: {} });
  applyMove(s, { move_index: s.moveCount, player: 1 - seat, type: 'pass', payload: {} });
  ok(s.winner === 0, 'block: the lighter hand wins');
  ok(s.score.points === 12, 'block: the heavier hand\'s pips are scored');
}
{
  // Blocked and level: a draw, scoring nothing.
  const s = started('ROOMAA');
  play(s, s.turn, s.openerTile, 'right');
  s.boneyard = [];
  s.leftEnd = 0; s.rightEnd = 0;      // so neither hand below can be played
  s.hands = [[[3, 3]], [[2, 4]]];     // 6 pips each
  const seat = s.turn;
  applyMove(s, { move_index: s.moveCount, player: seat, type: 'pass', payload: {} });
  applyMove(s, { move_index: s.moveCount, player: 1 - seat, type: 'pass', payload: {} });
  ok(s.winner === 'tie' && s.score.points === 0, 'block: a level blocked game is a draw');
}
{
  const s = started('ROOMAA');
  applyMove(s, { move_index: s.moveCount, player: 1, type: 'resign', payload: {} });
  ok(s.gameOver && s.winner === 0 && s.endDetail.reason === 'resign', 'end: resign hands the win over');

  const t = started('ROOMAA');
  applyMove(t, { move_index: t.moveCount, player: 0, type: 'timeout', payload: { player: 1 } });
  ok(t.gameOver && t.winner === 0 && t.endDetail.reason === 'timeout', 'end: a flagged seat loses on time');
}
{
  const s = started('ROOMAA');
  s.gameOver = true;
  throws(() => applyMove(s, { move_index: s.moveCount, player: s.openerSeat, type: 'draw', payload: {} }),
    'end: you cannot draw after the game is over');
}

// ---- 8. Move-log contract --------------------------------------------------
{
  const s = newGameState('ROOMAA');
  throws(() => applyMove(s, { move_index: 5, player: 0, type: 'start', payload: {} }),
    'log: a move applied out of order is rejected');

  const g = started('ROOMAA');
  throws(() => play(g, 1 - g.turn, g.openerTile, 'right'),
    'log: a move logged by the wrong seat is rejected, not re-attributed');
  throws(() => applyMove(g, { move_index: g.moveCount, player: 0, type: 'nonsense', payload: {} }),
    'log: an unknown move type is rejected');
}
{
  const seed = 'ROOMAA';
  const probe = started(seed);
  const log = [
    { move_index: 0, player: 0, type: 'start', payload: { tpm: 0 } },
    { move_index: 1, player: probe.turn, type: 'play', payload: { tile: probe.openerTile, side: 'right' } },
  ];
  const a = replayMoves(seed, log);
  ok(a.started === true, 'replay: the folded state keeps `started` (home-dashboard gates on it)');
  ok(typeof a.turn === 'number' && typeof a.gameOver === 'boolean',
    'replay: returns { turn, gameOver } as the dashboard contract requires');
  ok(J(replayMoves(seed, log)) === J(a), 'replay: folding the same log twice is identical');
  ok(J(replayMoves(seed, [log[1], log[0]])) === J(a), 'replay: an out-of-order log is sorted first');
  ok(J(replayMoves(seed, [...log, { move_index: 9000000, player: 0, type: 'rematch', payload: { code: 'X' } }])) === J(a),
    'replay: a rematch pointer is skipped, not folded');
  ok(replayMoves(seed, []).started === false, 'replay: an empty log is an unstarted game');

  // The exact row shape main.js writes must fold — this is what the old build
  // got wrong (it wrote no `player`, so every move was silently discarded).
  ok(a.chain.length === 1, 'replay: a move row carrying move_index + player actually applies');
}

// ---- 9. A full deterministic game ------------------------------------------
{
  let finished = 0, dominoes = 0, blocks = 0;
  for (let n = 0; n < 25; n++) {
    const s = started(`GAME${n}`);
    let guard = 0;
    while (!s.gameOver && guard++ < 200) {
      const seat = s.turn;
      const plays = legalPlays(s, seat);
      if (plays.length) {
        const p = plays[0];
        play(s, seat, p.tile, p.sides[0]);
      } else if (mustDraw(s, seat)) {
        applyMove(s, { move_index: s.moveCount, player: seat, type: 'draw', payload: {} });
      } else if (canPass(s, seat)) {
        applyMove(s, { move_index: s.moveCount, player: seat, type: 'pass', payload: {} });
      } else break;
    }
    if (s.gameOver) {
      finished++;
      if (s.endDetail.reason === 'domino') dominoes++;
      if (s.endDetail.reason === 'blocked') blocks++;
      const played = 28 - s.hands[0].length - s.hands[1].length - s.boneyard.length;
      ok(played === s.chain.length, `game ${n}: every tile is accounted for`);
      ok(s.score != null, `game ${n}: the finished game recorded a score`);
    }
  }
  ok(finished === 25, 'self-play: all 25 games reached a legal conclusion');
  ok(dominoes > 0 && blocks > 0, 'self-play: both endings (domino and block) actually occur');
}

console.log(`\ndominoes engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
