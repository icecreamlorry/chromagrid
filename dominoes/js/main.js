// dominoes/js/main.js — Dominoes application controller with full Table Games screen & lobby parity

import { dealGame, canPlayTile, playTile, passTurn, drawFromBoneyard, replayMoves, hasPlayableTile, getPlaySide } from './engine.js';
import { createDominoesUI } from './board.js';
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

let ui = null;
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

  const oppSeat = 1 - app.playerIndex;
  const oppHand = app.state.hands[oppSeat] || [];
  if ($('opp-tiles')) $('opp-tiles').textContent = oppHand.length;
  if ($('boneyard-count')) $('boneyard-count').textContent = app.state.boneyard.length;

  const myHand = app.state.hands[app.playerIndex] || [];
  const isMyTurn = app.state.turn === app.playerIndex && !app.state.gameOver;
  const myCanPlay = isMyTurn && hasPlayableTile(myHand, app.state.leftEnd, app.state.rightEnd);

  const btnDraw = $('btn-draw');
  const btnPass = $('btn-pass');

  if (isMyTurn && !myCanPlay) {
    if (app.state.boneyard.length > 0) {
      btnDraw?.classList.remove('hidden');
      btnPass?.classList.add('hidden');
    } else {
      btnDraw?.classList.add('hidden');
      btnPass?.classList.remove('hidden');
    }
  } else {
    btnDraw?.classList.add('hidden');
    btnPass?.classList.add('hidden');
  }

  if (ui) {
    ui.render(app.state, app.playerIndex);
  }

  if (app.state.gameOver) {
    $('gameover-overlay')?.classList.remove('hidden');
    const titleEl = $('gameover-title');
    const detailEl = $('gameover-detail');

    if (app.state.winner === null) {
      if (titleEl) titleEl.textContent = 'GAME OVER — DRAW!';
      if (detailEl) detailEl.textContent = 'Game is blocked with equal remaining pips.';
    } else if (app.state.winner === app.playerIndex) {
      if (titleEl) titleEl.textContent = 'VICTORY!';
      if (detailEl) detailEl.textContent = 'You emptied your hand / held lowest pips!';
    } else {
      if (titleEl) titleEl.textContent = 'DEFEAT';
      if (detailEl) detailEl.textContent = 'Opponent emptied hand / held lowest pips.';
    }
    setStatus('GAME OVER');
  } else {
    $('gameover-overlay')?.classList.add('hidden');
    const turnName = isMyTurn ? 'Your turn' : `${seatName(app.room, app.state.turn) || 'Opponent'}'s turn`;
    setStatus(turnName);
  }

  if (moveTimer) {
    moveTimer.render();
  }
}

function handleTileClick(tileIdx, tile) {
  if (!app.state || app.state.gameOver || app.state.turn !== app.playerIndex) return;

  const side = getPlaySide(tile, app.state.leftEnd, app.state.rightEnd);

  try {
    app.state = playTile(app.state, app.playerIndex, tileIdx, side);
    updateUI();

    if (app.conn && !app.offlineSolo) {
      app.conn.sendMove({ type: 'move', payload: { tileIdx, side } });
    }

    triggerBotIfNeeded();
  } catch (err) {
    console.error(err);
  }
}

function triggerBotIfNeeded() {
  if (app.offlineSolo && !app.state.gameOver && app.state.turn === 1) {
    setTimeout(() => {
      const botHand = app.state.hands[1];
      const playableIndices = [];
      botHand.forEach((t, i) => {
        if (canPlayTile(t, app.state.leftEnd, app.state.rightEnd)) playableIndices.push(i);
      });

      if (playableIndices.length > 0) {
        const pickIdx = playableIndices[0];
        const tile = botHand[pickIdx];
        const side = getPlaySide(tile, app.state.leftEnd, app.state.rightEnd);
        app.state = playTile(app.state, 1, pickIdx, side);
      } else if (app.state.boneyard.length > 0) {
        app.state = drawFromBoneyard(app.state, 1);
        triggerBotIfNeeded();
        return;
      } else {
        app.state = passTurn(app.state, 1);
      }
      updateUI();
    }, 600);
  }
}

$('btn-draw')?.addEventListener('click', () => {
  if (!app.state || app.state.turn !== app.playerIndex) return;
  app.state = drawFromBoneyard(app.state, app.playerIndex);
  updateUI();
  if (app.conn && !app.offlineSolo) app.conn.sendMove({ type: 'move', payload: { draw: true } });
});

$('btn-pass')?.addEventListener('click', () => {
  if (!app.state || app.state.turn !== app.playerIndex) return;
  app.state = passTurn(app.state, app.playerIndex);
  updateUI();
  if (app.conn && !app.offlineSolo) app.conn.sendMove({ type: 'move', payload: { pass: true } });
  triggerBotIfNeeded();
});

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
    app.state = dealGame('seed', 2);
  } else {
    const moves = await fetchMoves(code);
    app.state = replayMoves(room?.seed || 'seed', moves);
  }

  if (!ui) {
    ui = createDominoesUI($('chain'), $('my-rack'), handleTileClick);
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
    const room = await createRoom('dominoes', name);
    await enterGameScreen(room.code, 0, name, room, false);
  } catch (err) {
    await enterGameScreen('SOLO', 0, name, null, true);
  }
}

rematch = createRematch({
  state: app,
  seatKey: 'playerIndex',
  createRoom: (name) => createRoom('dominoes', name),
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
    app.state = dealGame(String(Date.now()), 2);
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
