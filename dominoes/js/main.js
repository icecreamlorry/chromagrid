// dominoes/js/main.js — Dominoes controller & networking integration

import { dealGame, canPlayTile, playTile, drawFromBoneyard } from './engine.js';
import { createDominoesUI } from './board.js';
import { createRoom, joinRoom, fetchMoves, RoomConnection, seatName } from './net.js';
import { takeRoomParam } from '../../shared/deep-link.js';
import { cachedUser, onAuthChange, displayName } from '../../shared/auth.js';
import { getGuestName } from '../../shared/guest-name.js';
import { saveSession, readSession, clearSession } from '../../shared/game-session.js';
import { GAME_SLUG } from './config.js';

const $ = (id) => document.getElementById(id);

const app = {
  user: null, userId: null, name: null, code: null, playerIndex: null,
  room: null, state: null, conn: null,
};

let ui = null;

function setStatus(msg) {
  $('status').textContent = msg || '';
}

function updateUI() {
  if (!app.state) return;

  const oppSeat = 1 - (app.playerIndex ?? 0);
  const oppHand = app.state.hands[oppSeat] || [];
  if ($('opp-tiles')) $('opp-tiles').textContent = oppHand.length;
  if ($('boneyard-count')) $('boneyard-count').textContent = app.state.boneyard.length;

  if (ui) {
    ui.render(app.state, app.playerIndex ?? 0);
  }

  if (app.state.gameOver) {
    if (app.state.winner === null) setStatus('GAME OVER — DRAW!');
    else if (app.state.winner === app.playerIndex) setStatus('GAME OVER — YOU WIN!');
    else setStatus('GAME OVER — OPPONENT WINS');
  } else {
    const isMyTurn = app.state.turn === app.playerIndex;
    const turnName = isMyTurn ? 'Your turn' : `${seatName(app.room, app.state.turn) || 'Opponent'}'s turn`;
    setStatus(turnName);
  }
}

function handleTileClick(tileIdx, tile) {
  if (!app.state || app.state.gameOver || app.state.turn !== app.playerIndex) return;

  // Determine play side
  let side = 'right';
  if (app.state.leftEnd !== null && tile[1] === app.state.leftEnd) side = 'left';

  try {
    app.state = playTile(app.state, app.playerIndex, tileIdx, side);
    updateUI();
    if (app.conn) {
      app.conn.sendMove({ type: 'move', payload: { tileIdx, side } });
    }
  } catch (err) {
    console.error(err);
  }
}

async function enterRoom(code, playerIndex, name, room) {
  app.code = code; app.playerIndex = playerIndex; app.name = name; app.room = room;
  $('room-code-text').textContent = code;
  $('room-code-chip').classList.remove('hidden');

  saveSession(GAME_SLUG, { code, playerIndex, name }, app.userId);

  const moves = await fetchMoves(code);
  app.state = replayMoves(room.seed, moves);

  if (!ui) {
    ui = createDominoesUI($('chain'), $('my-rack'), handleTileClick);
  }
  updateUI();

  if (app.conn) try { app.conn.close(); } catch {}
  app.conn = new RoomConnection(code, playerIndex, name, {
    onMove: async (m) => {
      const moves = await fetchMoves(code);
      app.state = replayMoves(room.seed, moves);
      updateUI();
    },
    onPresence: () => updateUI(),
  });
  app.conn.connect();
}

$('btn-leave').addEventListener('click', () => {
  clearSession(GAME_SLUG);
  if (app.conn) { app.conn.close(); app.conn = null; }
  location.href = '../index.html';
});

async function boot() {
  onAuthChange((user) => {
    app.user = user;
    app.userId = user?.id || null;
    app.name = user ? displayName(user) : getGuestName();
  });

  const urlCode = takeRoomParam();
  if (urlCode) {
    try {
      const { room, playerIndex } = await joinRoom(urlCode, app.name, app.userId);
      await enterRoom(urlCode, playerIndex, seatName(room, playerIndex) || 'Guest', room);
      return;
    } catch {}
  }

  const session = readSession(GAME_SLUG);
  if (session) {
    try {
      const { code, name } = typeof session === 'string' ? JSON.parse(session) : session;
      const { room, playerIndex } = await joinRoom(code, name, app.userId);
      await enterRoom(code, playerIndex, name, room);
      return;
    } catch {
      clearSession(GAME_SLUG);
    }
  }

  const { room, playerIndex } = await createRoom('dominoes', app.name || 'Player 1');
  await enterRoom(room.code, playerIndex, app.name || 'Player 1', room);
}

boot();
