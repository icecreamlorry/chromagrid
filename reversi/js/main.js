// reversi/js/main.js — Reversi controller matching Table Games group standards

import { newGameState, applyMove, replayMoves, legalMoves, countDiscs } from './engine.js';
import { createReversiBoard } from './board.js';
import { createRoom, joinRoom, fetchMoves, RoomConnection, seatName } from './net.js';
import { createRematch } from '../../shared/rematch.js';
import { takeRoomParam } from '../../shared/deep-link.js';
import { cachedUser, onAuthChange, displayName } from '../../shared/auth.js';
import { getGuestName, setGuestName } from '../../shared/guest-name.js';
import { saveSession, readSession, clearSession } from '../../shared/game-session.js';
import { TIME_CONTROLS, createMoveTimer } from '../../shared/time-control.js';
import { confirmEnabled, injectConfirmToggle } from '../../shared/move-confirm.js';
import { GAME_SLUG } from './config.js';

const $ = (id) => document.getElementById(id);

const app = {
  user: null, userId: null, name: null, code: null, playerIndex: 0,
  room: null, state: null, conn: null, timeKey: 'unlimited',
  offlineSolo: false,
};

let boardUI = null;
let moveTimer = null;
let setupCtx = null;

function landingError(msg) {
  const el = $('landing-error');
  if (el) el.textContent = msg || '';
}

function getPlayerName() {
  const name = app.name || getGuestName() || 'Player 1';
  setGuestName(name);
  return name;
}

function setStatus(msg) {
  const el = $('status');
  if (el) el.textContent = msg || '';
}

function openSetup(name, userId, onError) {
  setupCtx = { name, userId, onError };
  $('modal-setup').classList.remove('hidden');
}

function closeSetup() {
  $('modal-setup').classList.add('hidden');
  setupCtx = null;
}

document.querySelectorAll('#setup-times .setup-time').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.time;
    closeSetup();
    startNewGame(key);
  });
});

$('setup-cancel')?.addEventListener('click', closeSetup);

function updateUI() {
  if (!app.state) return;

  const counts = countDiscs(app.state.board);
  const myIsDark = app.playerIndex === 0;

  if ($('my-discs')) $('my-discs').textContent = myIsDark ? counts.dark : counts.light;
  if ($('opp-discs')) $('opp-discs').textContent = myIsDark ? counts.light : counts.dark;

  if (boardUI) {
    boardUI.render(app.state, app.playerIndex);
  }

  if (app.state.gameOver) {
    $('gameover-overlay').classList.remove('hidden');
    const titleEl = $('gameover-title');
    const detailEl = $('gameover-detail');

    if (app.state.winner === null) {
      titleEl.textContent = 'GAME OVER — DRAW!';
      detailEl.textContent = `Both players finished with ${counts.dark} discs each.`;
    } else if (app.state.winner === app.playerIndex) {
      titleEl.textContent = 'VICTORY!';
      detailEl.textContent = `You won ${counts.dark} to ${counts.light}!`;
    } else {
      titleEl.textContent = 'DEFEAT';
      detailEl.textContent = `Opponent won ${counts.light} to ${counts.dark}.`;
    }
    setStatus('GAME OVER');
  } else {
    $('gameover-overlay').classList.add('hidden');
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
    app.state = applyMove(app.state, { r, c });
    updateUI();

    if (app.conn && !app.offlineSolo) {
      await app.conn.sendMove({ type: 'move', payload: { r, c } });
    }

    // Auto-bot play in offline solo mode
    if (app.offlineSolo && !app.state.gameOver && app.state.turn === 1) {
      setTimeout(() => {
        const botMoves = Array.from(legalMoves(app.state.board, 1).keys());
        if (botMoves.length > 0) {
          const pickIdx = botMoves[Math.floor(Math.random() * botMoves.length)];
          const rBot = Math.floor(pickIdx / 8), cBot = pickIdx % 8;
          app.state = applyMove(app.state, { r: rBot, c: cBot });
        } else {
          app.state = applyMove(app.state, { pass: true });
        }
        updateUI();
      }, 500);
    }
  } catch (err) {
    console.error(err);
  }
}

async function enterGameScreen(code, playerIndex, name, room, offline = false) {
  app.code = code; app.playerIndex = playerIndex; app.name = name; app.room = room;
  app.offlineSolo = offline;

  $('screen-landing').classList.add('hidden');
  $('screen-lobby').classList.add('hidden');
  $('screen-game').classList.remove('hidden');

  if (code) {
    $('room-code-text').textContent = code;
    $('room-code-chip').classList.remove('hidden');
  } else {
    $('room-code-chip').classList.add('hidden');
  }

  saveSession(GAME_SLUG, { code, playerIndex, name, offline }, app.userId);

  if (offline) {
    app.state = newGameState();
  } else {
    const moves = await fetchMoves(code);
    app.state = replayMoves(room?.seed || 'seed', moves);
  }

  if (!boardUI) {
    boardUI = createReversiBoard($('board'), handleCellClick);
  }

  updateUI();

  if (app.conn) try { app.conn.close(); } catch {}
  if (!offline && code) {
    app.conn = new RoomConnection(code, playerIndex, name, {
      onMove: async () => {
        const moves = await fetchMoves(code);
        app.state = replayMoves(room.seed, moves);
        updateUI();
      },
      onPresence: () => updateUI(),
    });
    app.conn.connect();
  }
}

async function startNewGame(timeKey) {
  app.timeKey = timeKey;
  const name = getPlayerName();
  try {
    const room = await createRoom('reversi', name);
    await enterGameScreen(room.code, 0, name, room, false);
  } catch (err) {
    // Offline fallback: start solo game immediately if server/network unavailable
    await enterGameScreen('SOLO', 0, name, null, true);
  }
}

$('btn-create')?.addEventListener('click', () => {
  openSetup(getPlayerName(), app.userId, landingError);
});

$('btn-join')?.addEventListener('click', () => {
  $('join-box').classList.toggle('hidden');
  $('code-input').focus();
});

$('btn-join-go')?.addEventListener('click', async () => {
  const code = $('code-input').value.trim().toUpperCase();
  if (!code) return;
  try {
    const { room, playerIndex } = await joinRoom(code, getPlayerName(), app.userId);
    await enterGameScreen(code, playerIndex, getPlayerName(), room, false);
  } catch (err) {
    landingError(err.message || 'Could not join room');
  }
});

$('btn-leave')?.addEventListener('click', () => {
  clearSession(GAME_SLUG);
  if (app.conn) { app.conn.close(); app.conn = null; }
  $('screen-game').classList.add('hidden');
  $('screen-landing').classList.remove('hidden');
});

$('btn-rematch')?.addEventListener('click', () => {
  if (app.offlineSolo) {
    app.state = newGameState();
    updateUI();
  } else {
    startNewGame(app.timeKey);
  }
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
      const { room, playerIndex } = await joinRoom(urlCode, getPlayerName(), app.userId);
      await enterGameScreen(urlCode, playerIndex, getPlayerName(), room, false);
      return;
    } catch {}
  }

  const session = readSession(GAME_SLUG);
  if (session) {
    try {
      const s = typeof session === 'string' ? JSON.parse(session) : session;
      if (s.offline) {
        await enterGameScreen('SOLO', 0, s.name, null, true);
        return;
      }
      const { room, playerIndex } = await joinRoom(s.code, s.name, app.userId);
      await enterGameScreen(s.code, playerIndex, s.name, room, false);
      return;
    } catch {
      clearSession(GAME_SLUG);
    }
  }

  // Show landing screen by default
  $('screen-landing').classList.remove('hidden');
}

boot();
