// Dominoes (block-and-draw, double-six, two players) engine — deterministic
// state folded from an ordered move log, like the other LB Games table games.
//
// The 28-tile double-six set is shuffled from the ROOM SEED, so both clients
// deal the same hands without anything being stored. Opening: the player
// holding the highest double must lead with it; if neither holds a double, the
// player with the heaviest tile leads with that. Thereafter a tile may only be
// played on a matching open end. If you cannot play you MUST draw, one tile at
// a time, until you can — or until the boneyard is empty, and only then may you
// pass. The game ends when someone plays their last tile (a "domino") or when
// both players pass in succession with an empty boneyard (a "block"); the
// winner scores the pips left in the loser's hand, and an equal count in a
// blocked game is a draw.
//
// KNOWN LIMITATION — hidden information is not truly hidden. Because the deal
// is derived from the public room seed, a determined player could open devtools
// and compute the opponent's hand. Fixing that properly needs a server-side
// dealer, which this static-hosting architecture does not have. It is fine for
// a friendly game; it is not cheat-proof, and that is a deliberate trade rather
// than an oversight.

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
// same way on every client — `'abc' >>> 0` is 0, which would deal every room
// the identical hands.
export function seedInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed ?? '');
  if (s !== '' && Number.isFinite(Number(s))) return Number(s) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const HAND_SIZE = 7;

export function fullSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles;
}

export function shuffled(seed) {
  const rnd = mulberry32(seedInt(seed));
  const deck = fullSet();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const isDouble = (t) => t[0] === t[1];
export const pips = (t) => t[0] + t[1];
export const sameTile = (a, b) => a[0] === b[0] && a[1] === b[1];
export function handPips(hand) { return hand.reduce((n, t) => n + pips(t), 0); }

// Who leads, and with which tile: highest double, else heaviest tile.
export function opening(hands) {
  let best = null;
  for (let seat = 0; seat < hands.length; seat++) {
    for (const t of hands[seat]) {
      const rank = isDouble(t) ? 100 + pips(t) : pips(t);
      if (!best || rank > best.rank) best = { seat, tile: t, rank };
    }
  }
  return best ? { seat: best.seat, tile: best.tile } : null;
}

// ---- Game state -------------------------------------------------------------

export function newGameState(seed, players = 2) {
  const deck = shuffled(seed);
  const hands = [];
  for (let s = 0; s < players; s++) hands.push(deck.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE));
  const boneyard = deck.slice(players * HAND_SIZE);
  const open = opening(hands);
  return {
    seed,
    tpm: 0,
    hands,
    boneyard,
    chain: [],            // tiles in play, oriented left→right
    leftEnd: null,
    rightEnd: null,
    openerSeat: open ? open.seat : 0,
    openerTile: open ? open.tile : null,
    turn: null,           // seat to move, or null before start
    started: false,
    moveCount: 0,
    passes: 0,            // consecutive passes — two in a row on an empty boneyard = block
    drawOffer: null,
    lastMove: null,
    gameOver: false,
    winner: null,         // seat | 'tie'
    score: null,          // { winner, points } once the game is over
    endDetail: null,
  };
}

// Can `tile` go on `side` of the current chain?
export function fits(state, tile, side) {
  if (!state.chain.length) return true;
  const end = side === 'left' ? state.leftEnd : state.rightEnd;
  return tile[0] === end || tile[1] === end;
}

// The sides a tile may legally be played on, [] if it cannot be played at all.
export function sidesFor(state, tile) {
  if (!state.chain.length) return ['right'];
  const out = [];
  if (fits(state, tile, 'left')) out.push('left');
  if (fits(state, tile, 'right')) out.push('right');
  return out;
}

// Legal plays for a seat as [{ tile, sides }]. On the opening move only the
// forced lead tile is playable.
export function legalPlays(state, seat) {
  if (!state.started || state.gameOver || state.turn !== seat) return [];
  const hand = state.hands[seat] || [];
  if (!state.chain.length) {
    const lead = hand.find((t) => state.openerTile && sameTile(t, state.openerTile));
    return lead ? [{ tile: lead, sides: ['right'] }] : [];
  }
  return hand.map((t) => ({ tile: t, sides: sidesFor(state, t) })).filter((p) => p.sides.length);
}

export function canPlay(state, seat) { return legalPlays(state, seat).length > 0; }
// You must draw while you cannot play and the boneyard still has tiles.
export function mustDraw(state, seat) {
  return state.started && !state.gameOver && state.turn === seat
    && !canPlay(state, seat) && state.boneyard.length > 0;
}
// You may only pass once you cannot play AND the boneyard is empty.
export function canPass(state, seat) {
  return state.started && !state.gameOver && state.turn === seat
    && !canPlay(state, seat) && state.boneyard.length === 0;
}

// Orient a tile so the matching pip touches the chain, and extend it.
function place(state, tile, side) {
  if (!state.chain.length) {
    state.chain = [tile.slice()];
    state.leftEnd = tile[0];
    state.rightEnd = tile[1];
    return;
  }
  if (side === 'left') {
    // The tile's RIGHT pip must meet the current left end.
    const t = tile[1] === state.leftEnd ? tile.slice() : [tile[1], tile[0]];
    state.chain = [t, ...state.chain];
    state.leftEnd = t[0];
  } else {
    // The tile's LEFT pip must meet the current right end.
    const t = tile[0] === state.rightEnd ? tile.slice() : [tile[1], tile[0]];
    state.chain = [...state.chain, t];
    state.rightEnd = t[1];
  }
}

function endWithWinner(state, winner, reason) {
  state.gameOver = true;
  state.winner = winner;
  state.endDetail = { reason };
  if (winner !== 'tie' && state.hands[1 - winner]) {
    state.score = { winner, points: handPips(state.hands[1 - winner]) };
  } else {
    state.score = { winner: 'tie', points: 0 };
  }
  state.turn = null;
}

function resolveBlock(state) {
  const a = handPips(state.hands[0]);
  const b = handPips(state.hands[1]);
  if (a === b) {
    state.gameOver = true; state.winner = 'tie';
    state.endDetail = { reason: 'blocked', pips: [a, b] };
    state.score = { winner: 'tie', points: 0 };
  } else {
    const winner = a < b ? 0 : 1;
    state.gameOver = true; state.winner = winner;
    state.endDetail = { reason: 'blocked', pips: [a, b] };
    state.score = { winner, points: Math.max(a, b) };
  }
  state.turn = null;
}

export function applyMove(state, move) {
  if (move.move_index !== state.moveCount) {
    throw new Error(`Move ${move.move_index} applied out of order (expected ${state.moveCount})`);
  }
  const seat = move.player;
  const payload = move.payload || {};

  switch (move.type) {
    case 'start': {
      state.tpm = payload.tpm || 0;
      state.started = true;
      state.turn = state.openerSeat;
      state.passes = 0;
      state.lastMove = { type: 'start', player: seat, first: state.openerSeat, tile: state.openerTile };
      break;
    }
    case 'play': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      const { tile, side } = payload;
      if (!Array.isArray(tile)) throw new Error('Play move carries no tile');
      const legal = legalPlays(state, seat).find((p) => sameTile(p.tile, tile) && p.sides.includes(side));
      if (!legal) throw new Error(`Illegal dominoes play in log: ${tile} on ${side}`);
      // Copy the hand rather than splicing the array in place — a previous state
      // may still be held by the UI.
      state.hands = state.hands.map((h, i) => (i === seat ? h.filter((t) => !sameTile(t, tile)) : h));
      place(state, tile, side);
      state.passes = 0;
      state.drawOffer = null;
      state.lastMove = { type: 'play', player: seat, tile, side };
      if (state.hands[seat].length === 0) { endWithWinner(state, seat, 'domino'); break; }
      state.turn = 1 - seat;
      break;
    }
    case 'draw': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      if (state.gameOver) throw new Error('Draw after the game ended');
      if (!state.boneyard.length) throw new Error('Draw from an empty boneyard');
      if (canPlay(state, seat)) throw new Error('Draw while a legal play exists');
      const boneyard = state.boneyard.slice();
      const tile = boneyard.shift();
      state.boneyard = boneyard;
      state.hands = state.hands.map((h, i) => (i === seat ? [...h, tile] : h));
      // Drawing is not passing — it must not count toward the block rule.
      state.passes = 0;
      state.lastMove = { type: 'draw', player: seat };
      break;
    }
    case 'pass': {
      if (seat !== state.turn) throw new Error('Move played out of turn in log');
      if (!canPass(state, seat)) throw new Error('Pass while a legal play or a draw is available');
      state.passes += 1;
      state.lastMove = { type: 'pass', player: seat };
      if (state.passes >= 2) { resolveBlock(state); break; }
      state.turn = 1 - seat;
      break;
    }
    case 'resign': {
      endWithWinner(state, 1 - seat, 'resign');
      state.endDetail = { reason: 'resign', resignedPlayer: seat };
      state.lastMove = { type: 'resign', player: seat };
      break;
    }
    case 'timeout': {
      const flagged = payload.player ?? seat;
      endWithWinner(state, 1 - flagged, 'timeout');
      state.endDetail = { reason: 'timeout', flaggedPlayer: flagged };
      state.lastMove = { type: 'timeout', player: flagged };
      break;
    }
    case 'draw-offer': { state.drawOffer = seat; state.lastMove = { type: 'draw-offer', player: seat }; break; }
    case 'draw-decline': { state.drawOffer = null; state.lastMove = { type: 'draw-decline', player: seat }; break; }
    case 'draw-accept': {
      if (state.drawOffer != null && state.drawOffer !== seat) {
        state.gameOver = true; state.winner = 'tie';
        state.endDetail = { reason: 'agreement' }; state.score = { winner: 'tie', points: 0 };
        state.turn = null;
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
