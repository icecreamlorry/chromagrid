// dominoes/js/main.js — Dominoes controller matching Table Games group standards

import { dealGame, canPlayTile, playTile, passTurn, drawFromBoneyard, replayMoves, hasPlayableTile } from './engine.js';
import { createDominoesUI } from './board.js';
import { createRoom, joinRoom, fetchMoves, RoomConnection, seatName } from './net.js';
import { takeRoomParam } from '../../shared/deep-link.js';
import { cachedUser, onAuthChange, displayName } from '../../shared/auth.js';
import { getGuestName, setGuestName } from '../../shared/guest-name.js';
import { saveSession, readSession, clearSession } from '../../shared/game-session.js';
import { GAME_SLUG } from './config.js';

const $ = (id) => document.getElementById(id);

const app = {
  user: null, userId: null, name: null, code: null, playerIndex: 0,
  room: null, state: null, conn: null, timeKey: 'unlimited',
  offlineSolo: false,
};

let ui = null;
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
    $('gameover-overlay').classList.remove('hidden');
    const titleEl = $('gameover-title');
    const detailEl = $('gameover-detail');

    if (app.state.winner === null) {
      titleEl.textContent = 'GAME OVER — DRAW!';
      detailEl.textContent = 'Game is blocked with equal remaining pips.';
    } else if (app.state.winner === app.playerIndex) {
      titleEl.textContent = 'VICTORY!';
      detailEl.textContent = 'You emptied your hand / held lowest pips!';
    } else {
      titleEl.textContent = 'DEFEAT';
      detailEl.textContent = 'Opponent emptied hand / held lowest pips.';
    }
    setStatus('GAME OVER');
  } else {
    $('gameover-overlay').classList.add('hidden');
    const turnName = isMyTurn ? 'Your turn' : `${seatName(app.room, app.state.turn) || 'Opponent'}'s turn`;
    setStatus(turnName);
  }
}

function handleTileClick(tileIdx, tile) {
  if (!app.state || app.state.gameOver || app.state.turn !== app.playerIndex) return;

  let side = 'right';
  if (app.state.leftEnd !== null && tile[1] === app.state.leftEnd) side = 'left';

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
        let side = 'right';
        if (app.state.leftEnd !== null && tile[1] === app.state.leftEnd) side = 'left';
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
    app.state = dealGame('seed', 2);
  } else {
    const moves = await fetchMoves(code);
    app.state = replayMoves(room?.seed || 'seed', moves);
  }

  if (!ui) {
    ui = createDominoesUI($('chain'), $('my-rack'), handleTileClick);
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
    const room = await createRoom('dominoes', name);
    await enterGameScreen(room.code, 0, name, room, false);
  } catch (err) {
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
    app.state = dealGame(String(Date.now()), 2);
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
      window.LBBoot?.done();
      return;
    } catch {}
  }

  const session = readSession(GAME_SLUG);
  if (session) {
    try {
      const s = typeof session === 'string' ? JSON.parse(session) : session;
      if (s.offline) {
        await enterGameScreen('SOLO', 0, s.name, null, true);
        window.LBBoot?.done();
        return;
      }
      const { room, playerIndex } = await joinRoom(s.code, s.name, app.userId);
      await enterGameScreen(s.code, playerIndex, s.name, room, false);
      window.LBBoot?.done();
      return;
    } catch {
      clearSession(GAME_SLUG);
    }
  }

  $('screen-landing').classList.remove('hidden');
  window.LBBoot?.done();
}

boot();
