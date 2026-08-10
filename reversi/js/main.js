// reversi/js/main.js — Reversi application controller & networking bridge

import { newGameState, applyMove, replayMoves, legalMoves, countDiscs } from './engine.js';
import { createReversiBoard } from './board.js';
import {
  createRoom, joinRoom, fetchRoom, fetchMoves, RoomConnection, seatName, markPlayerLeft,
} from './net.js';
import { createRematch } from '../../shared/rematch.js';
import { takeRoomParam, roomShareUrl } from '../../shared/deep-link.js';
import { openHistory } from '../../shared/history.js';
import { cachedUser, onAuthChange, displayName } from '../../shared/auth.js';
import { getGuestName } from '../../shared/guest-name.js';
import { saveSession, readSession, clearSession } from '../../shared/game-session.js';
import { createMoveTimer } from '../../shared/time-control.js';
import { confirmEnabled, injectConfirmToggle } from '../../shared/move-confirm.js';
import { GAME_SLUG } from './config.js';

const $ = (id) => document.getElementById(id);

const app = {
  user: null, userId: null, name: null, code: null, playerIndex: null,
  room: null, state: null, conn: null, staged: null,
  confirmMoves: false,
};

let boardUI = null;
let moveTimer = null;

function setStatus(msg) {
  $('status').textContent = msg || '';
}

function updateUI() {
  if (!app.state) return;

  const counts = countDiscs(app.state.board);
  const myIsDark = app.playerIndex === 0;

  if ($('my-discs')) $('my-discs').textContent = myIsDark ? counts.dark : counts.light;
  if ($('opp-discs')) $('opp-discs').textContent = myIsDark ? counts.light : counts.dark;

  if (boardUI) {
    boardUI.render(app.state, app.playerIndex ?? 0);
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

async function handleCellClick(r, c, idx) {
  if (!app.state || app.state.gameOver || app.state.turn !== app.playerIndex) return;

  const valid = legalMoves(app.state.board, app.playerIndex);
  if (!valid.has(idx)) return;

  try {
    const nextState = applyMove(app.state, { r, c });
    app.state = nextState;
    updateUI();

    if (app.conn) {
      await app.conn.sendMove({ type: 'move', payload: { r, c } });
    }

    // Auto-pass check if opponent has no valid moves
    if (!app.state.gameOver && legalMoves(app.state.board, app.state.turn).size === 0) {
      setTimeout(async () => {
        if (!app.state.gameOver && legalMoves(app.state.board, app.state.turn).size === 0) {
          app.state = applyMove(app.state, { pass: true });
          updateUI();
          if (app.conn) await app.conn.sendMove({ type: 'move', payload: { pass: true } });
        }
      }, 600);
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

  if (!boardUI) {
    boardUI = createReversiBoard($('board'), handleCellClick);
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
  app.code = null; app.playerIndex = null;
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

  // Create solo training game if no room in URL
  const { room, playerIndex } = await createRoom('reversi', app.name || 'Player 1');
  await enterRoom(room.code, playerIndex, app.name || 'Player 1', room);
}

boot();
