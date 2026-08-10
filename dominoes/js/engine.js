// dominoes/js/engine.js — Double-Six Dominoes game engine

import { seededShuffle } from '../../shared/quiz-engine.js';

export function createDeck() {
  const tiles = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      tiles.push([i, j]);
    }
  }
  return tiles;
}

export function dealGame(seed, numPlayers = 2) {
  const deck = createDeck();
  const shuffled = seededShuffle(deck, seed);
  const handSize = numPlayers === 2 ? 7 : 5;
  const hands = [];
  
  for (let p = 0; p < numPlayers; p++) {
    hands.push(shuffled.slice(p * handSize, (p + 1) * handSize));
  }
  const boneyard = shuffled.slice(numPlayers * handSize);

  return {
    hands,
    boneyard,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    turn: 0,
    gameOver: false,
    winner: null,
    passes: 0,
    started: true,
  };
}

export function canPlayTile(tile, leftEnd, rightEnd) {
  if (leftEnd === null && rightEnd === null) return true;
  return tile[0] === leftEnd || tile[1] === leftEnd || tile[0] === rightEnd || tile[1] === rightEnd;
}

export function handPips(hand) {
  return hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
}

export function hasPlayableTile(hand, leftEnd, rightEnd) {
  return hand.some((tile) => canPlayTile(tile, leftEnd, rightEnd));
}

export function playTile(state, playerIndex, tileIdx, playSide) {
  if (state.gameOver || state.turn !== playerIndex) return state;

  const hand = state.hands[playerIndex].slice();
  if (tileIdx < 0 || tileIdx >= hand.length) return state;

  const tile = hand[tileIdx];
  let [a, b] = tile;

  if (state.chain.length === 0) {
    hand.splice(tileIdx, 1);
    const newHands = state.hands.slice();
    newHands[playerIndex] = hand;
    const isWin = hand.length === 0;

    return {
      ...state,
      hands: newHands,
      chain: [[a, b]],
      leftEnd: a,
      rightEnd: b,
      turn: (state.turn + 1) % state.hands.length,
      gameOver: isWin,
      winner: isWin ? playerIndex : null,
      passes: 0,
    };
  }

  let placed = [a, b];
  let newLeft = state.leftEnd;
  let newRight = state.rightEnd;

  if (playSide === 'left') {
    if (b === state.leftEnd) {
      placed = [a, b];
      newLeft = a;
    } else if (a === state.leftEnd) {
      placed = [b, a];
      newLeft = b;
    } else {
      throw new Error(`Tile [${a}|${b}] cannot play on left end ${state.leftEnd}`);
    }
  } else {
    if (a === state.rightEnd) {
      placed = [a, b];
      newRight = b;
    } else if (b === state.rightEnd) {
      placed = [b, a];
      newRight = a;
    } else {
      throw new Error(`Tile [${a}|${b}] cannot play on right end ${state.rightEnd}`);
    }
  }

  hand.splice(tileIdx, 1);
  const newHands = state.hands.slice();
  newHands[playerIndex] = hand;

  const newChain = playSide === 'left' ? [placed, ...state.chain] : [...state.chain, placed];
  const isWin = hand.length === 0;

  // Check if next player can move or if game is blocked
  const nextTurn = (state.turn + 1) % state.hands.length;
  const nextHand = newHands[nextTurn];
  const nextCanPlay = hasPlayableTile(nextHand, newLeft, newRight);

  return {
    ...state,
    hands: newHands,
    chain: newChain,
    leftEnd: newLeft,
    rightEnd: newRight,
    turn: nextTurn,
    gameOver: isWin,
    winner: isWin ? playerIndex : null,
    passes: 0,
  };
}

export function passTurn(state, playerIndex) {
  if (state.gameOver || state.turn !== playerIndex) return state;

  const passes = state.passes + 1;
  const nextTurn = (state.turn + 1) % state.hands.length;

  // If all players pass consecutively and boneyard is empty, evaluate win by lowest pips
  const isBlocked = passes >= state.hands.length && state.boneyard.length === 0;
  let winner = null;

  if (isBlocked) {
    const p0Pips = handPips(state.hands[0]);
    const p1Pips = handPips(state.hands[1]);
    if (p0Pips < p1Pips) winner = 0;
    else if (p1Pips < p0Pips) winner = 1;
    else winner = null; // Draw
  }

  return {
    ...state,
    turn: nextTurn,
    passes,
    gameOver: isBlocked,
    winner,
  };
}

export function drawFromBoneyard(state, playerIndex) {
  if (state.boneyard.length === 0 || state.turn !== playerIndex) return state;

  const boneyard = state.boneyard.slice();
  const drawn = boneyard.pop();

  const hands = state.hands.slice();
  hands[playerIndex] = [...hands[playerIndex], drawn];

  return {
    ...state,
    hands,
    boneyard,
  };
}

export function replayMoves(seed, moves = []) {
  let state = dealGame(seed, 2);

  for (const move of moves) {
    if (move.type === 'move' && move.payload) {
      const p = move.payload;
      if (p.timeout != null) {
        return { ...state, gameOver: true, winner: 1 - p.timeout };
      }
      if (p.tileIdx != null) {
        try {
          state = playTile(state, move.player, p.tileIdx, p.side || 'right');
        } catch { /* ignore unappliable */ }
      } else if (p.pass) {
        state = passTurn(state, move.player);
      } else if (p.draw) {
        state = drawFromBoneyard(state, move.player);
      }
    }
  }

  return state;
}
