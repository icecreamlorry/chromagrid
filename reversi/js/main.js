// reversi/js/main.js — Reversi application controller with full Table Games screen & lobby parity

import { newGameState, applyMove, replayMoves, legalMoves, countDiscs } from './engine.js';
import { createReversiBoard } from './board.js';
import {
  createRoom, joinRoom, fetchRoom, fetchMoves, fetchMyRooms, updateRoomStatus,
  finishRoom, RoomConnection, triggerPush, seatName, userSeat, seatLeft, markPlayerLeft,
} from './net.js';
import { createRematch } from '../../shared/rematch.js';
import { takeRoomParam, roomShareUrl } from '../../shared/deep-link.js';
import { openHistory } from '../../shared/history.js';
import { filterDismissed, dismissGame, makeDismissControl } from '../../shared/dismissed-games.js';
import { cachedUser, onAuthChange, displayName, signOut } from '../../shared/auth.js';
import { getGuestName, setGuestName } from '../../shared/guest-name.js';
import { saveSession, readSession, clearSession } from '../../shared/game-session.js';
import { TIME_CONTROLS, TIME_LABELS, createMoveTimer } from '../../shared/time-control.js';
import { confirmEnabled, injectConfirmToggle } from '../../shared/move-confirm.js';
import { configReady, GAME_SLUG } from './config.js';

const $ = (id) => document.getElementById(id);

const app = {
  user: null, userId: null, name: null, code: null, playerIndex: 0,
  room: null, state: null, conn: null, timeKey: 'unlimited',
  offlineSolo: false,
};

let boardUI = null;
let moveTimer = null;
let setupCtx = null;
let rematch = null;
let lobbyPollTimer = null;

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function landingError(msg) {
  const el = $('landing-error');
  if (el) el.textContent = msg || '';
}

function lobbyError(msg) {
  const el = $('lobby-error');
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

// ---- Screen Navigation ----

function showScreen(which) {
  for (const id of ['screen-landing', 'screen-lobby', 'screen-game']) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== `screen-${which}`);
  }
  document.body.dataset.screen = which;
  if (which !== 'lobby') stopLobbyPolling();
}

function applyAuthToUI() {
  const btnLobby = $('btn-go-lobby');
  if (btnLobby) btnLobby.classList.toggle('hidden', !app.user);
  const lobbyName = $('lobby-name');
  if (lobbyName && app.user) lobbyName.textContent = app.name;
}

function handleAuthChange(user) {
  app.user = user;
  app.userId = user?.id ?? null;
  if (user) app.name = displayName(user);
  applyAuthToUI();
  if ($('screen-game')?.classList.contains('hidden')) {
    if (user) {
      showScreen('lobby');
      renderLobby();
    } else {
      showScreen('landing');
    }
  }
}

// ---- Lobby ----

function startLobbyPolling() {
  stopLobbyPolling();
  lobbyPollTimer = setInterval(() => {
    if (!$('screen-lobby')?.classList.contains('hidden') && !document.hidden) {
      renderLobby();
    }
  }, 5000);
}

function stopLobbyPolling() {
  if (lobbyPollTimer) {
    clearInterval(lobbyPollTimer);
    lobbyPollTimer = null;
  }
}

async function renderLobby() {
  if (!app.userId) return;
  startLobbyPolling();
  const list = $('lobby-list');
  if (!list) return;

  let rooms;
  try {
    rooms = await fetchMyRooms(app.userId);
  } catch (e) {
    lobbyError(`Could not load your games (${e.message}).`);
    return;
  }

  rooms = filterDismissed(app.userId, rooms);
  if (!rooms.length) {
    list.innerHTML = '<p class="lobby-empty muted">No games yet. Start one with <strong>New game</strong>, or join a friend\'s with their code.</p>';
    return;
  }

  const summaries = await Promise.all(rooms.map(summarizeRoom));
  list.innerHTML = '';
  for (const s of summaries) {
    list.appendChild(buildLobbyCard(s));
  }
}

async function summarizeRoom(room) {
  const myIndex = userSeat(room, app.userId);
  const oppIndex = myIndex === 0 ? 1 : 0;
  const oppName = seatName(room, oppIndex);
  if (room.status === 'finished' && room.result) {
    return { room, myIndex, oppIndex, oppName, state: { started: true, gameOver: true, winner: room.result.winner } };
  }
  let state = null;
  try {
    state = replayMoves(room.seed, await fetchMoves(room.code));
  } catch {}
  return { room, myIndex, oppIndex, oppName, state };
}

function buildLobbyCard({ room, myIndex, oppIndex, oppName, state }) {
  const card = document.createElement('button');
  card.className = 'lobby-game';

  const isTurn = state && !state.gameOver && state.turn === myIndex;
  const isOver = state && state.gameOver;

  let tagHtml = '';
  if (isOver) {
    const win = state.winner === myIndex;
    tagHtml = `<span class="dash-tag done">${win ? 'WIN' : 'LOSS'}</span>`;
  } else if (isTurn) {
    tagHtml = '<span class="dash-tag turn">YOUR TURN</span>';
  } else {
    tagHtml = '<span class="dash-tag">THEIR TURN</span>';
  }

  card.innerHTML = `
    <div class="dash-body">
      <div class="dash-game">${esc(GAME_SLUG.toUpperCase())} — vs ${esc(oppName || 'Opponent')}</div>
      <div class="dash-line">Room Code: ${esc(room.code)}</div>
    </div>
    ${tagHtml}
  `;

  card.addEventListener('click', () => {
    enterGameScreen(room.code, myIndex, app.name, room, false);
  });

  return card;
}

// ---- Setup & Dialogs ----

function openSetup(name, userId, onError) {
  setupCtx = { name, userId, onError };
  $('modal-setup')?.classList.remove('hidden');
}

function closeSetup() {
  $('modal-setup')?.classList.add('hidden');
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

$('room-code-chip')?.addEventListener('click', async () => {
  if (!app.code) return;
  try {
    await navigator.clipboard.writeText(roomShareUrl(app.code));
    const text = $('room-code-text');
    if (text) {
      const orig = text.textContent;
      text.textContent = 'COPIED!';
      setTimeout(() => { text.textContent = orig; }, 1500);
    }
  } catch {}
});

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
    $('gameover-overlay')?.classList.remove('hidden');
    const titleEl = $('gameover-title');
    const detailEl = $('gameover-detail');

    if (app.state.winner === null) {
      if (titleEl) titleEl.textContent = 'GAME OVER — DRAW!';
      if (detailEl) detailEl.textContent = `Both players finished with ${counts.dark} discs each.`;
    } else if (app.state.winner === app.playerIndex) {
      if (titleEl) titleEl.textContent = 'VICTORY!';
      if (detailEl) detailEl.textContent = `You won ${counts.dark} to ${counts.light}!`;
    } else {
      if (titleEl) titleEl.textContent = 'DEFEAT';
      if (detailEl) detailEl.textContent = `Opponent won ${counts.light} to ${counts.dark}.`;
    }
    setStatus('GAME OVER');
  } else {
    $('gameover-overlay')?.classList.add('hidden');
    const isMyTurn = app.state.turn === app.playerIndex;
    const turnName = isMyTurn ? 'Your turn' : `${seatName(app.room, app.state.turn) || 'Opponent'}'s turn`;
    setStatus(turnName);
  }

  if (moveTimer) {
    moveTimer.render();
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

  showScreen('game');

  if (code) {
    if ($('room-code-text')) $('room-code-text').textContent = code;
    $('room-code-chip')?.classList.remove('hidden');
  } else {
    $('room-code-chip')?.classList.add('hidden');
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

  if (moveTimer) moveTimer.destroy();
  moveTimer = createMoveTimer({
    myClockEl: $('my-clock'),
    oppClockEl: $('opp-clock'),
    getTurn: () => app.state?.turn,
    mySeat: app.playerIndex,
    timeKey: room?.players?.[0]?.time || app.timeKey,
  });

  injectConfirmToggle(GAME_SLUG, true);

  updateUI();

  if (app.conn) try { app.conn.close(); } catch {}
  if (!offline && code) {
    app.conn = new RoomConnection(code, playerIndex, name, {
      onMove: async (m) => {
        if (m.type === 'rematch') {
          if (rematch) rematch.follow(m.payload.code);
          return;
        }
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
    await enterGameScreen('SOLO', 0, name, null, true);
  }
}

rematch = createRematch({
  state: app,
  seatKey: 'playerIndex',
  createRoom: (name) => createRoom('reversi', name),
  joinRoom: (code, name) => joinRoom(code, name, app.userId),
  enterRoom: (code, playerIndex, name, room) => enterGameScreen(code, playerIndex, name, room, false),
  button: () => $('btn-rematch'),
  onError: (msg) => setStatus(msg),
});

$('btn-create')?.addEventListener('click', () => {
  openSetup(getPlayerName(), app.userId, landingError);
});

$('btn-join')?.addEventListener('click', () => {
  $('join-box')?.classList.toggle('hidden');
  $('code-input')?.focus();
});

$('btn-join-go')?.addEventListener('click', async () => {
  const code = $('code-input')?.value.trim().toUpperCase();
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
  if (app.user) {
    showScreen('lobby');
    renderLobby();
  } else {
    showScreen('landing');
  }
});

$('btn-rematch')?.addEventListener('click', () => {
  if (app.offlineSolo) {
    app.state = newGameState();
    updateUI();
  } else if (rematch) {
    rematch.start();
  }
});

$('btn-lobby-history')?.addEventListener('click', () => {
  openHistory({ userId: app.userId, gameSlug: GAME_SLUG });
});

$('btn-lobby-new')?.addEventListener('click', () => {
  lobbyError('');
  openSetup(app.name || getPlayerName(), app.userId, lobbyError);
});

$('btn-lobby-refresh')?.addEventListener('click', () => renderLobby());
$('btn-go-lobby')?.addEventListener('click', () => {
  showScreen('lobby');
  renderLobby();
});

async function tryResumeWithTimeout() {
  const urlCode = takeRoomParam();
  if (urlCode) {
    try {
      const roomPromise = joinRoom(urlCode, getPlayerName(), app.userId);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
      const { room, playerIndex } = await Promise.race([roomPromise, timeoutPromise]);
      await enterGameScreen(urlCode, playerIndex, getPlayerName(), room, false);
      return true;
    } catch {
      // Fall through to stored session or landing/lobby
    }
  }

  const session = readSession(GAME_SLUG);
  if (session) {
    try {
      const s = typeof session === 'string' ? JSON.parse(session) : session;
      if (s.offline) {
        await enterGameScreen('SOLO', 0, s.name, null, true);
        return true;
      }
      const roomPromise = joinRoom(s.code, s.name, app.userId);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
      const { room, playerIndex } = await Promise.race([roomPromise, timeoutPromise]);
      await enterGameScreen(s.code, playerIndex, s.name, room, false);
      return true;
    } catch {
      clearSession(GAME_SLUG);
    }
  }
  return false;
}

async function boot() {
  app.user = cachedUser();
  app.userId = app.user?.id ?? null;
  if (app.user) app.name = displayName(app.user);

  applyAuthToUI();

  onAuthChange(handleAuthChange);

  const resumed = await tryResumeWithTimeout();

  if (!resumed) {
    if (app.user) {
      showScreen('lobby');
      renderLobby();
    } else {
      showScreen('landing');
    }
  }

  window.LBBoot?.done();
}

boot();
