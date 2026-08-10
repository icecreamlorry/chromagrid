// shared/quiz-game.js — the whole game-flow controller for the seeded-quiz
// family (Atlaz, Flagz, Atomyx, Buffz, …). One `createQuizGame(cfg)` owns the
// landing/lobby/room lifecycle, presence, the prestart picker frame, the
// countdown + per-round timer, results/ranking/persistence, spectating, the
// players strip, rematch, notifications and resume/boot — everything that was
// copied line-for-line across the four games' main.js.
//
// Each game passes a `cfg` describing ONLY what differs: its engine tables, how
// to load its dataset, how to draw its prestart picker (a region list, an
// element set, or filter dropdowns), how to turn the picked config into a
// `start` payload + seeded rounds, and how to render a round/review. The DOM
// shell (ids like #btn-start, #results-list, #players-strip) is identical across
// the games and lives in each index.html; only the play STAGE id differs, so
// that's the one element id in cfg.
//
// Multiplayer model (unchanged): the host's `start` move (index 0) carries the
// game's payload + startAt; every seat derives identical seeded rounds from the
// room seed and races; each seat submits ONE sparse `result` move (index 10+seat).

import { takeRoomParam, roomShareUrl } from './deep-link.js';
import { saveSession, readSession, clearSession } from './game-session.js';

const $ = (id) => document.getElementById(id);
const COUNTDOWN_MS = 3000;
const RESULT_MOVE_BASE = 10;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createQuizGame(cfg) {
  const MAX_PLAYERS = cfg.maxPlayers ?? 5;
  const SESSION_KEY = `${cfg.slug}_session`;
  const CFG_KEY = `${cfg.slug}.lastcfg`;
  const {
    net, engine, loadData, createMode, renderReview, hidePanels,
    stageId, gameName,
  } = cfg;
  const {
    createRoom, joinRoom, fetchRoom, fetchMyRooms, updateRoomStatus,
    finishRoom, RoomConnection, triggerPush, seatName, seatLeft, markPlayerLeft,
  } = net;
  const { modeMeta, diffMeta, rankSeats, winnerSeat, scoreOf } = engine;

  const app = {
    user: null, userId: null, name: null,
    code: null, seat: null, room: null, conn: null,
    data: null,
    phase: 'idle',            // idle | config | countdown | playing | results
    payload: null,            // the host's start payload (region/set/filters + mode + diff)
    modeId: null,
    rounds: [],
    startAt: null,
    ctl: null,
    results: {},
    submittedResult: false,
    resultPersisted: false, persistedCount: 0,
    resultsDismissed: false,
    viewingSeat: null,
    online: new Set(),
    timerInt: null,
    rematching: false,
    cfgSel: cfg.initCfgSel(),
    cfgStep: 'pick',
  };

  const playerName = () => (app.user ? cfg.displayName(app.user) : cfg.getGuestName());
  const seats = () => (app.room?.players ?? []).length || 1;
  const soloRoom = () => seats() <= 1;
  const canConfigure = () => app.seat === 0;

  // ---- Session pointer (localStorage for guests, sessionStorage for signed-in) ----
  function saveSession(data) {
    const raw = JSON.stringify(data);
    try {
      if (app.userId) { sessionStorage.setItem(SESSION_KEY, raw); localStorage.removeItem(SESSION_KEY); }
      else { localStorage.setItem(SESSION_KEY, raw); sessionStorage.removeItem(SESSION_KEY); }
    } catch { /* storage blocked — resume just won't persist */ }
  }
  function readSession() {
    try { return localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY); }
    catch { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  // ---- Screens ----
  function showScreen(which) {
    for (const id of ['screen-landing', 'screen-lobby', 'screen-game']) {
      $(id).classList.toggle('hidden', id !== `screen-${which}`);
    }
    if (which !== 'lobby') stopLobbyPolling();
  }

  // ---- Landing ----
  function landingError(msg) { $('landing-error').textContent = msg || ''; }
  function requireName(errFn) {
    const n = playerName();
    if (!n) { errFn('Set your name first.'); return null; }
    return n;
  }

  $('btn-create').addEventListener('click', async () => {
    const name = requireName(landingError); if (!name) return;
    landingError('');
    try {
      const room = await createRoom(name, app.userId, null, MAX_PLAYERS);
      await enterRoom(room.code, 0, name, room);
    } catch (e) { landingError(e.message || 'Could not create a room.'); }
  });

  $('btn-join').addEventListener('click', () => {
    if (!requireName(landingError)) return;
    $('join-box').classList.toggle('hidden');
    $('code-input').focus();
  });

  function doJoin(codeEl, errFn) {
    const name = requireName(errFn); if (!name) return;
    const code = codeEl.value.trim().toUpperCase();
    if (code.length < 4) { errFn('Enter the room code.'); return; }
    errFn('');
    joinRoom(code, name, app.userId)
      .then(({ room, playerIndex }) => enterRoom(code, playerIndex, name, room))
      .catch((e) => errFn(e.message || 'Could not join that room.'));
  }
  $('btn-join-go').addEventListener('click', () => doJoin($('code-input'), landingError));
  $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin($('code-input'), landingError); });
  $('btn-go-lobby').addEventListener('click', () => { showScreen('lobby'); renderLobby(); });

  // ---- Auth ----
  function onAuth(user) {
    app.user = user;
    app.userId = user?.id ?? null;
    app.name = playerName();
    $('btn-go-lobby').classList.toggle('hidden', !user);
    if ($('screen-game').classList.contains('hidden')) {
      if (user) { showScreen('lobby'); renderLobby(); }
      else showScreen('landing');
    }
  }

  // ---- Lobby ----
  let lobbyPoll = null;
  function startLobbyPolling() {
    stopLobbyPolling();
    lobbyPoll = setInterval(() => {
      if (!$('screen-lobby').classList.contains('hidden') && !document.hidden) renderLobby();
    }, 6000);
  }
  function stopLobbyPolling() { if (lobbyPoll) { clearInterval(lobbyPoll); lobbyPoll = null; } }

  $('btn-lobby-new').addEventListener('click', async () => {
    try {
      const room = await createRoom(app.name, app.userId, null, MAX_PLAYERS);
      await enterRoom(room.code, 0, app.name, room);
    } catch (e) { $('lobby-error').textContent = e.message; }
  });
  $('btn-lobby-join').addEventListener('click', () => { $('lobby-join-box').classList.toggle('hidden'); $('lobby-code-input').focus(); });
  $('btn-lobby-join-go').addEventListener('click', () => doJoin($('lobby-code-input'), (m) => ($('lobby-error').textContent = m)));
  $('lobby-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-lobby-join-go').click(); });
  $('btn-lobby-refresh').addEventListener('click', renderLobby);
  $('btn-lobby-challenge').addEventListener('click', () => window.LBAccount?.openProfile());
  $('btn-lobby-history').addEventListener('click', () => cfg.openHistory({ userId: app.userId, gameSlug: cfg.slug }));
  $('btn-logout-lobby').addEventListener('click', async () => { try { await cfg.signOut(); } catch {} });

  async function renderLobby() {
    if (!app.userId) return;
    startLobbyPolling();
    revealNotify();
    $('lobby-name').textContent = app.name || 'player';
    let rooms;
    try { rooms = await fetchMyRooms(app.userId); }
    catch (e) { $('lobby-error').textContent = `Could not load games (${e.message}).`; return; }
    rooms = cfg.filterDismissed(app.userId, rooms);
    const list = $('lobby-list');
    if (!rooms.length) {
      list.innerHTML = '<p class="lobby-empty">No games yet. <strong>NEW GAME</strong> to start one, or challenge a friend.</p>';
      return;
    }
    list.innerHTML = '';
    for (const room of rooms) list.appendChild(lobbyCard(room));
  }

  function lobbyCard(room) {
    const players = room.players ?? [];
    const invitedMe = room.invited_user_id === app.userId && players.every((p) => p.userId !== app.userId);
    const finished = room.status === 'finished';
    const playing = room.status === 'playing';
    let label, status, live = false;
    if (invitedMe) { label = `${players[0]?.name || 'Someone'} invited you`; status = 'Tap to join'; live = true; }
    else { label = `${players.length} player${players.length === 1 ? '' : 's'}`; status = finished ? 'Finished' : playing ? 'In progress' : 'Waiting — tap to open'; live = playing; }

    const card = document.createElement('button');
    card.className = 'lobby-game' + (live ? ' live' : '') + (finished ? ' finished' : '');
    card.innerHTML = `<span class="lobby-opp">${esc(label)}</span><span class="lobby-status">${esc(status)}</span>`
      + `<span class="lobby-score">${room.code}</span>`;
    card.addEventListener('click', () => (
      finished ? cfg.openHistory({ userId: app.userId, gameSlug: cfg.slug }) : openFromLobby(room)
    ));
    card.appendChild(cfg.makeDismissControl({
      userId: app.userId, code: room.code, card,
      onRemoved: () => { if (!$('lobby-list').children.length) renderLobby(); },
    }));
    return card;
  }

  async function openFromLobby(room) {
    try {
      const { room: updated, playerIndex } = await joinRoom(room.code, app.name, app.userId);
      await enterRoom(room.code, playerIndex, app.name, updated);
    } catch (e) { $('lobby-error').textContent = e.message; }
  }

  async function challengeFriend(friend) {
    try {
      const room = await createRoom(app.name, app.userId, { userId: friend.id, name: friend.display_name }, MAX_PLAYERS);
      triggerPush({ user_id: friend.id, title: `${gameName} challenge!`, body: `${app.name} challenged you to ${gameName}.`, url: location.href.split('#')[0] }).catch(() => {});
      await enterRoom(room.code, 0, app.name, room);
    } catch (e) { $('lobby-error').textContent = e.message; }
  }

  // ---- Room / game lifecycle ----
  function resetGame() {
    if (app.conn) { app.conn.close(); app.conn = null; }
    app.ctl?.destroy(); app.ctl = null;
    app.phase = 'idle';
    app.cfgStep = 'pick';
    app.payload = null; app.modeId = null;
    app.rounds = [];
    app.startAt = null;
    app.results = {};
    app.submittedResult = false;
    app.resultPersisted = false; app.persistedCount = 0;
    app.resultsDismissed = false;
    app.viewingSeat = null;
    app.online = new Set();
    app.rematching = false;
    if (app.timerInt) { clearInterval(app.timerInt); app.timerInt = null; }
    hidePanels();
    $('prompt-line').textContent = ''; $('prompt-sub').textContent = '';
    $(stageId).innerHTML = '';
    $('results-overlay').classList.add('hidden');
    $('countdown-overlay').classList.add('hidden');
    const cd = $('countdown-num');
    if (cd) { cd.textContent = ''; cd.classList.remove('pop'); }
    $('timer-chip').classList.add('hidden');
    $('mode-chip').classList.add('hidden');
    if ($('btn-rematch')) $('btn-rematch').disabled = false;
    setStatus('');
  }

  // enterRoom is safe to re-enter: same-room calls are a no-op, and the prior
  // connection is closed before a new one replaces it (the rematch-loop fix).
  async function enterRoom(code, seat, name, room) {
    if (app.code === code && app.conn) { showScreen('game'); return; }
    resetGame();
    app.code = code; app.seat = seat; app.name = name; app.room = room;
    $('room-code-text').textContent = code;
    $('room-code-chip').classList.remove('hidden');
    showScreen('game');
    saveSession(cfg.slug, { code, name }, app.userId);
    setPhase('config');
    renderAll();

    if (app.conn) { try { app.conn.close(); } catch { /* stale room */ } }
    app.conn = new RoomConnection(code, seat, name, {
      onMove: handleMove,
      onPresence: handlePresence,
      onMode: () => {},
      onRoomUpdate: handleRoomUpdate,
    });
    app.conn.connect();

    if (cfg.notifyEnabled()) cfg.subscribeToPush({ userId: app.userId || undefined, roomCode: app.userId ? undefined : code, player: app.userId ? undefined : seat }).catch(() => {});
  }

  $('btn-leave').addEventListener('click', leaveRoom);
  $('btn-results-done').addEventListener('click', () => { if (app.code) cfg.dismissGame(app.userId, app.code); leaveRoom(); });

  async function leaveRoom() {
    if (app.code != null && app.seat != null && app.room && app.room.status !== 'finished') {
      try { const room = await markPlayerLeft(app.code, app.seat); if (room) app.conn?.broadcastRoom(room); } catch { /* best effort */ }
    }
    clearSession(cfg.slug);
    resetGame();
    app.code = null; app.seat = null; app.room = null;
    if (app.user) { showScreen('lobby'); renderLobby(); } else showScreen('landing');
  }

  $('room-code-chip').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomShareUrl(app.code)); setStatus('Invite link copied.'); } catch {}
  });

  // ---- Moves ----
  function handleMove(move) {
    if (move.type === 'rematch') { rematch.follow(move.payload?.code); return; }
    if (move.type === 'start') {
      if (app.startAt != null) return;
      const p = move.payload || {};
      if (!app.data || !cfg.payloadValid(app.data, p)) return;
      beginGame(p, Number(p.startAt) || Date.parse(move.created_at) || Date.now());
      return;
    }
    if (move.type === 'result') {
      const r = move.payload;
      if (!r || typeof move.player !== 'number') return;
      app.results[move.player] = r;
      if (move.player === app.seat) app.submittedResult = true;
      onResultsUpdate();
      renderPlayers();
    }
  }

  function handlePresence(set) {
    app.online = set;
    const known = (app.room?.players ?? []).length;
    let maxSeat = -1;
    set.forEach((k) => { const n = Number(k); if (Number.isFinite(n)) maxSeat = Math.max(maxSeat, n); });
    if (maxSeat + 1 > known) {
      fetchRoom(app.code).then((r) => { app.room = r; renderPlayers(); renderPrestart(); }).catch(() => {});
    }
    renderPlayers();
  }

  function handleRoomUpdate(room) {
    if (!room) return;
    app.room = room;
    renderPlayers();
    renderPrestart();
    onResultsUpdate();
  }

  // ---- Prestart picker (game-specific rows via cfg) ----
  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      cfg.loadCfgInto(app.data, app.cfgSel, c);
    } catch { /* defaults stay */ }
  }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(app.cfgSel)); } catch {} }

  function buildCfgButtons() {
    cfg.buildCfgButtons(app.data, {
      esc,
      canPick: () => canConfigure() && app.phase === 'config',
      // Flat picks (a region/set/mode/diff button): set one key and re-render.
      onPick: (key, val) => { app.cfgSel[key] = val; saveCfg(); renderPrestart(); },
      // For pickers that mutate the selection object themselves (Buffz's nested
      // filter dropdowns): change app.cfgSel directly, then commit().
      commit: () => { saveCfg(); renderPrestart(); },
      sel: app.cfgSel,
    });
  }

  const cfgSummary = () => cfg.cfgSummary(app.data, app.cfgSel);
  const cfgComplete = () => cfg.cfgComplete(app.data, app.cfgSel);
  const diffEffect = () => cfg.diffEffect(app.data, app.cfgSel);

  function renderPrestart() {
    if (app.phase !== 'config') return;
    const host = canConfigure();
    const picked = cfgComplete();
    const picking = host && (app.cfgStep !== 'ready' || !picked);
    const n = (app.room?.players ?? []).length;

    $('cfg').classList.toggle('hidden', !picking);
    $('btn-cfg-back').classList.toggle('hidden', picking || !host);
    $('start-title').textContent = !host ? 'WAITING FOR THE HOST'
      : picking ? cfg.pickTitle
      : (n > 1 ? 'READY?' : 'WAITING FOR PLAYERS');

    cfg.markSelected(app.cfgSel, { host, data: app.data });
    const note = cfg.readyNote ? cfg.readyNote(app.data, app.cfgSel) : '';

    if (!host) {
      $('start-info').innerHTML = `${n} player${n === 1 ? '' : 's'} in · code <strong>${esc(app.code)}</strong>`;
    } else if (picking) {
      const eff = diffEffect();
      $('start-info').innerHTML = (cfgSummary()
        ? `${cfgSummary()}${eff ? `<br><span class="start-note">${esc(eff)}</span>` : ''}`
        : cfg.pickPrompt) + note;
    } else {
      $('start-info').innerHTML = `${cfgSummary()}${diffEffect() ? `<br><span class="start-note">${esc(diffEffect())}</span>` : ''}`
        + `<br>${n} player${n === 1 ? '' : 's'} in · share code <strong>${esc(app.code)}</strong>`
        + `<br><span class="start-note">${n > 1 ? 'Everyone in the room plays.' : 'Friends can join until you start — or race solo.'}</span>`
        + note;
    }
    $('btn-start').classList.toggle('hidden', !host);
    $('btn-start').disabled = !picked;
    $('btn-start').textContent = picking ? 'NEXT' : (n > 1 ? 'START RACE' : 'START');
    $('start-waiting').classList.toggle('hidden', host);
  }

  $('btn-cfg-back').addEventListener('click', () => {
    if (app.phase !== 'config') return;
    app.cfgStep = 'pick';
    renderPrestart();
  });

  $('btn-start').addEventListener('click', async () => {
    if (!canConfigure() || app.phase !== 'config') return;
    if (!cfgComplete()) return;
    if (app.cfgStep !== 'ready') { app.cfgStep = 'ready'; renderPrestart(); return; }
    $('btn-start').disabled = true;
    const startAt = Date.now() + 400;
    const payload = { ...cfg.startPayload(app.cfgSel), startAt };
    try {
      await app.conn.sendMove({ move_index: 0, player: app.seat, type: 'start', payload });
      updateRoomStatus(app.code, 'playing').catch(() => {});
      beginGame(payload, startAt);
    } catch (e) {
      $('btn-start').disabled = false;
      app.conn.pollOnce().catch(() => {});
      setStatus(e.message || 'Could not start.');
    }
  });

  // ---- Phases / timers ----
  function setPhase(p) {
    app.phase = p;
    $('room-code-chip').classList.toggle('hidden', p !== 'config');
    $('prestart-overlay').classList.toggle('hidden', p !== 'config');
    $('countdown-overlay').classList.toggle('hidden', p !== 'countdown');
    $('results-overlay').classList.toggle('hidden', p !== 'results' || app.resultsDismissed);
    if (p === 'config') renderPrestart();
  }

  function beginGame(payload, startAt) {
    app.payload = payload; app.modeId = payload.mode; app.startAt = startAt;
    setStatus('');
    app.rounds = cfg.buildRounds(app.data, payload, Number(app.room?.seed) >>> 0);

    $('mode-chip').textContent = cfg.modeChipLabel(app.data, payload);
    $('mode-chip').classList.remove('hidden');
    $('timer-chip').classList.remove('hidden');

    if (app.timerInt) clearInterval(app.timerInt);
    app.timerInt = setInterval(tick, 200);
    tick();
  }

  function tick() {
    if (app.startAt == null) return;
    const now = Date.now();
    const reveal = app.startAt + COUNTDOWN_MS;
    if (now < reveal) {
      setPhase('countdown');
      const n = String(Math.min(COUNTDOWN_MS / 1000, Math.max(1, Math.ceil((reveal - now) / 1000))));
      const el = $('countdown-num');
      if (el.textContent !== n) {
        el.textContent = n;
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      return;
    }
    if (app.phase === 'countdown' || app.phase === 'config') startPlay();
    if (app.phase === 'playing') renderTimer(now - reveal);
  }

  function startPlay() {
    if (app.results[app.seat]) {
      app.submittedResult = true;
      setPhase('results');
      onResultsUpdate();
      return;
    }
    setPhase('playing');
    app.ctl?.destroy();
    app.ctl = createMode(app.modeId, {
      data: app.data,
      mode: app.modeId,
      rounds: app.rounds,
      startedAt: app.startAt + COUNTDOWN_MS,
      restore: loadProgress(),
      onProgress: saveProgress,
      onStatus: setStatus,
      onFinish: onMyFinish,
    }, { data: app.data, payload: app.payload });
    app.ctl.start();
    renderPlayers();
  }

  function renderTimer(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    $('timer-chip').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---- Progress persistence ----
  function progressKey() { return `${cfg.slug}.progress.${app.code}.${app.seat}`; }
  function saveProgress(state) { try { localStorage.setItem(progressKey(), JSON.stringify(state)); } catch {} }
  function loadProgress() { try { return JSON.parse(localStorage.getItem(progressKey()) || 'null'); } catch { return null; } }
  function clearProgress() { try { localStorage.removeItem(progressKey()); } catch {} }

  // ---- Finishing ----
  async function onMyFinish(result) {
    clearProgress();
    app.results[app.seat] = result;
    app.submittedResult = true;
    app.ctl?.destroy(); app.ctl = null;
    renderReview(app.data, app.modeId, result);
    app.viewingSeat = app.seat;
    setPhase('results');
    onResultsUpdate();

    const move = { move_index: RESULT_MOVE_BASE + app.seat, player: app.seat, type: 'result', payload: result };
    try { await app.conn.sendMove(move); } catch { /* dup = already stored */ }
  }

  function pendingSeats() {
    const players = app.room?.players ?? [];
    return players.filter((p) => !app.results[p.seat] && !seatLeft(app.room, p.seat)).map((p) => p.seat);
  }

  function onResultsUpdate() {
    if (app.phase !== 'results') return;
    const pending = pendingSeats();
    const done = pending.length === 0;
    $('results-waiting').classList.toggle('hidden', done);
    if (!done) {
      const names = pending.map((s) => seatName(app.room, s) || `P${s + 1}`).join(', ');
      $('results-waiting').textContent = `Waiting for ${names}…`;
    }
    renderResults(done);
    if (done) persistResult();
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function resultLine(r) { return r ? `${scoreOf(r)}/${r.total} · ${fmtTime(r.ms)}` : '…'; }

  function renderResults(complete) {
    const n = seats();
    $('results-title').textContent = soloRoom() ? 'YOUR RUN' : complete ? 'RESULTS' : 'FINISHED!';
    const ol = $('results-list');
    ol.innerHTML = '';
    const ranked = rankSeats(app.results, n, app.modeId);
    ranked.forEach((seat, i) => {
      const r = app.results[seat];
      const li = document.createElement('li');
      if (seat === app.seat) li.className = 'me';
      const name = seatName(app.room, seat) || `P${seat + 1}`;
      const leftTag = seatLeft(app.room, seat) && !r ? ' <span class="left-tag">left</span>' : '';
      li.innerHTML = `<span class="r-rank">${r ? i + 1 : '·'}</span>`
        + `<span class="r-name">${esc(name)}${leftTag}</span>`
        + `<span class="r-score">${esc(resultLine(r))}</span>`;
      if (r) li.addEventListener('click', () => { spectate(seat); dismissResults(); });
      ol.appendChild(li);
    });

    const winnerEl = $('results-winner');
    if (n <= 1 || !complete) {
      winnerEl.textContent = ''; winnerEl.className = 'results-winner';
    } else {
      const w = winnerSeat(app.results, n, app.modeId);
      if (w === 'tie') { winnerEl.textContent = "It's a tie!"; winnerEl.className = 'results-winner'; }
      else if (w === app.seat) { winnerEl.textContent = 'You won! 🎉'; winnerEl.className = 'results-winner'; }
      else { winnerEl.textContent = `${seatName(app.room, w) || `P${w + 1}`} won`; winnerEl.className = 'results-winner loss'; }
    }
    $('btn-rematch').textContent = soloRoom() ? 'PLAY AGAIN' : 'REMATCH';
  }

  async function persistResult() {
    if (!app.code || app.resultPersisted) return;
    const n = seats();
    const submitted = Object.keys(app.results).length;
    if (app.resultPersisted && submitted <= app.persistedCount) return;
    app.persistedCount = submitted;
    app.resultPersisted = true;
    const scores = Array.from({ length: n }, (_, s) => scoreOf(app.results[s]));
    const result = { scores, winner: winnerSeat(app.results, n, app.modeId), reason: 'done', ...cfg.resultMeta(app.payload) };
    try {
      await finishRoom(app.code, result, false);
      if (app.room) { app.room.status = 'finished'; app.room.result = result; }
    } catch { app.resultPersisted = false; }
  }

  // ---- Reviewing attempts ----
  function spectate(seat) {
    if (seat !== app.seat && !app.results[app.seat]) {
      setStatus('Finish your own game first to see the answers.');
      return;
    }
    const r = app.results[seat];
    if (!r) { setStatus('Their answers appear once they finish.'); return; }
    app.viewingSeat = seat;
    renderReview(app.data, app.modeId, r);
    setStatus(seat === app.seat ? '' : `Showing ${seatName(app.room, seat) || `P${seat + 1}`}'s answers — tap your own card to go back.`);
    renderPlayers();
  }

  function dismissResults() {
    app.resultsDismissed = true;
    $('results-overlay').classList.add('hidden');
    if (!soloRoom()) setStatus('Tap a player up top to compare answers.');
  }
  $('btn-results-close').addEventListener('click', dismissResults);
  $('btn-results-look').addEventListener('click', dismissResults);

  $('mode-chip').addEventListener('click', reopenResults);
  $('timer-chip').addEventListener('click', reopenResults);
  function reopenResults() {
    if (app.results[app.seat] == null) return;
    app.resultsDismissed = false;
    setPhase('results');
  }

  // ---- Players strip ----
  function renderPlayers() {
    const strip = $('players-strip');
    const players = app.room?.players ?? [];
    strip.innerHTML = '';
    if (players.length < 2) { $('spectate-hint').classList.add('hidden'); return; }
    players.forEach((p) => {
      const r = app.results[p.seat];
      const div = document.createElement('div');
      div.className = 'pchip' + (p.seat === app.seat ? ' me' : '')
        + (app.viewingSeat === p.seat && r ? ' viewing' : '')
        + (r ? ' done' : '');
      const online = app.online.has(String(p.seat));
      const stat = r ? `${scoreOf(r)}` : (app.phase === 'playing' || app.phase === 'countdown' ? '…' : '·');
      div.innerHTML = `<span class="pdot ${online ? '' : 'off'}"></span>`
        + `<span class="pname">${esc(p.name || `P${p.seat + 1}`)}</span>`
        + `<span class="pscore">${stat}</span>`;
      div.addEventListener('click', () => spectate(p.seat));
      strip.appendChild(div);
    });
    $('spectate-hint').classList.toggle('hidden', !(app.phase === 'results' && players.length >= 2));
  }

  // ---- Rematch ----
  const rematch = cfg.createRematch({
    state: app,
    createRoom: (name, userId) => createRoom(name, userId, null, MAX_PLAYERS),
    joinRoom, enterRoom,
    onError: (msg) => setStatus(msg),
  });
  $('btn-rematch').addEventListener('click', () => rematch.start());

  // ---- Status ----
  function setStatus(msg) { $('status-line').textContent = msg || ''; }
  function renderAll() { renderPrestart(); renderPlayers(); }

  // ---- Notifications (lobby bell) ----
  async function onToggleNotify() {
    const res = await cfg.requestNotifications();
    if (res === 'granted') {
      cfg.subscribeToPush({ userId: app.userId || undefined }).catch(() => {});
      revealNotify();
    }
  }
  $('btn-notify-lobby').addEventListener('click', onToggleNotify);

  function revealNotify() {
    const btn = $('btn-notify-lobby');
    const show = cfg.notificationsSupported() && cfg.notificationPermission() !== 'denied' && !cfg.notifyEnabled();
    btn.classList.toggle('hidden', !show);
  }

  // ---- Resume / boot ----
  async function tryResume() {
    // Opened from the home page with ?room=CODE — join that room directly.
    const urlCode = takeRoomParam();
    if (urlCode) {
      try {
        const { room, playerIndex } = await joinRoom(urlCode, app.name, app.userId);
        await enterRoom(urlCode, playerIndex, seatName(room, playerIndex) || 'Guest', room);
        return true;
      } catch { /* fall through to the stored session */ }
    }
    const session = readSession(cfg.slug);
    if (!session) return false;
    try {
      const { code, name } = typeof session === 'string' ? JSON.parse(session) : session;
      const { room, playerIndex } = await joinRoom(code, name, app.userId);
      await enterRoom(code, playerIndex, name, room);
      return true;
    } catch { clearSession(cfg.slug); return false; }
  }

  async function boot() {
    cfg.registerServiceWorker();
    window.LB_CONFIG.onChallengeFriend = challengeFriend;
    window.LB_CONFIG.historyDetail = (room) => cfg.historyDetail(app.data, room?.result || {});
    window.addEventListener('scroll', () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    });
    try { app.data = await loadData(); } catch (e) { landingError(cfg.dataError(e)); window.LBBoot?.done(); return; }
    buildCfgButtons();
    loadCfg();
    if (!cfg.configReady()) landingError('Backend not configured.');
    app.user = cfg.cachedUser();
    app.userId = app.user?.id ?? null;
    app.name = playerName();
    cfg.onAuthChange(onAuth);

    const resumed = await tryResume();
    if (!resumed) onAuth(app.user);
    window.LBBoot?.done();
  }

  $('help-modal')?.addEventListener('click', (e) => { if (e.target === $('help-modal')) $('help-modal').classList.add('hidden'); });

  boot();

  return { app };
}
