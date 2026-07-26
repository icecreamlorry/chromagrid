// Per-move time controls shared by the turn-based table games (Chess, Weiqi, and
// future titles like Checkers/Backgammon). A game stores the chosen control key
// on the host's room record (for the lobby) and the raw seconds on its `start`
// move (so a replay is self-describing); this module owns the option list, the
// clock formatting, and the tick / flag-fall machinery.
//
// The budget is PER MOVE and resets each turn — not a single game clock — which
// is what lets one UI serve both blitz and multi-day correspondence. The current
// mover's clock is anchored to the last move's server timestamp; when it hits
// zero the game concedes on time (each game decides how, via onFlag).

export const TIME_CONTROLS = {
  unlimited: 0,
  d3: 259200,
  d1: 86400,
  h1: 3600,
  m10: 600,
  m1: 60,
};
// Display order for pickers.
export const TIME_ORDER = ['unlimited', 'd3', 'd1', 'h1', 'm10', 'm1'];
export const TIME_LABELS = {
  unlimited: 'Unlimited — no timer',
  d3: '3 days / move',
  d1: '1 day / move',
  h1: '1 hour / move',
  m10: '10 min / move',
  m1: '1 min / move',
};
export const TIME_SHORT = {
  unlimited: 'Unlimited',
  d3: '3 days/move',
  d1: '1 day/move',
  h1: '1 hour/move',
  m10: '10 min/move',
  m1: '1 min/move',
};
export const TIME_SUBLABELS = {
  unlimited: 'No timer — play over days',
  d3: 'Relaxed correspondence',
  d1: 'A move or two a day',
  h1: 'Same-evening games',
  m10: 'Casual, sit-down pace',
  m1: 'Fast and sharp',
};

// Map a raw seconds value back to a control key (for display of a replayed game).
export function timeKeyFor(tpm) {
  for (const k of TIME_ORDER) if (TIME_CONTROLS[k] === (tpm || 0)) return k;
  return 'unlimited';
}

// A per-move budget as a compact clock string: days/hours when large, MM:SS when
// under an hour.
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec >= 86400) { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return `${d}d ${h}h`; }
  if (sec >= 3600) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return `${h}h ${m}m`; }
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Paint a pair of `.clock` spans (mine + opponent's). The active side (to move,
// while the game is live) counts down; the other shows the full per-move budget.
// Unlimited shows ∞. Games share the `.clock` / `.active` / `.low` classes.
export function renderClockPair(elMy, elOpp, { tpm, live, turn, mySeat, remainingSec }) {
  for (const [el, seat] of [[elMy, mySeat], [elOpp, 1 - mySeat]]) {
    if (!el) continue;
    if (!tpm) { el.textContent = '∞'; el.className = 'clock'; continue; }
    const active = live && turn === seat;
    const secs = active ? remainingSec : tpm;
    el.textContent = fmtClock(secs);
    el.className = 'clock' + (active ? ' active' : '') + (active && secs < 20 ? ' low' : '');
  }
}

// A move-clock controller. The game supplies:
//   elMy / elOpp   the two `.clock` elements (or null to skip rendering)
//   mySeat()       this client's seat (0/1)
//   context()      => { tpm, live, turn, anchorMs }  (live = started & !over & 2 players)
//   onFlag(seat)   called once when `seat`'s clock runs out — the game concedes
// Returns { start, stop, resetClaim, refresh }. Call resetClaim() whenever a
// move is applied (a new turn begins).
export function createMoveTimer({ elMy, elOpp, mySeat, context, onFlag, graceMs = 2500 }) {
  let timer = null;
  let claimed = false;

  function tick() {
    const ctx = context();
    if (!ctx) return;
    const deadline = ctx.anchorMs + (ctx.tpm || 0) * 1000;
    const remainingSec = Math.max(0, (deadline - Date.now()) / 1000);
    renderClockPair(elMy, elOpp, {
      tpm: ctx.tpm, live: ctx.live, turn: ctx.turn, mySeat: mySeat(), remainingSec,
    });
    if (!ctx.live || !ctx.tpm || claimed) return;
    // Flag ourselves the instant we hit zero; give the opponent a little grace
    // to absorb clock skew before we claim their flag.
    const threshold = ctx.turn === mySeat() ? 0 : -graceMs;
    if (deadline - Date.now() <= threshold) { claimed = true; onFlag(ctx.turn); }
  }

  return {
    start() { this.stop(); timer = setInterval(tick, 1000); tick(); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    resetClaim() { claimed = false; },
    refresh: tick,
  };
}
