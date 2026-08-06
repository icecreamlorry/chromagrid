// Deterministic 2–4 player Rummikub engine.
//
// Like the other room games, this is PURE and folds an ordered move log into a
// game state, so the database move log is the single source of truth and
// reconnecting is just "replay the moves". The 106-tile pool is shuffled from
// the room seed and dealt by replaying the log, so every client reconstructs the
// identical pool, all racks and the table — exactly the trick Wurdz uses to
// deal hidden letters. Hidden hands are a UI convention only: a client simply
// doesn't draw another player's rack. No tile is ever stored per-deal in the log.
//
// The player count (2–4) is fixed by the `start` move's payload rather than
// passed in, so replayMoves(seed, moves) needs no extra argument and the shared
// "your turn" dashboard reads it as an ordinary `replay` game (state.turn is the
// seat to move, like Chess/Draughts).
//
// Tiles are compact strings: `${colour}${number}` (e.g. 'r7', 'k13') or 'j' for
// a joker. Colours are k(black) r(red) b(blue) o(orange), numbers 1–13, two of
// each numbered tile + two jokers = 106. A "set" is an ordered array of tiles
// (runs read left-to-right); the "table" is an array of sets.

export const COLORS = ['k', 'r', 'b', 'o'];
export const NUMBERS = 13;
export const JOKER = 'j';
export const RACK_SIZE = 14;      // tiles dealt to each player
export const MELD_MIN = 30;       // minimum value of a player's opening meld
export const JOKER_PENALTY = 30;  // a joker left in the rack costs 30 at the end
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const isJoker = (t) => t === JOKER;
export const tileColor = (t) => t[0];
export const tileNum = (t) => Number(t.slice(1));
// Value of a loose tile when tallying a rack at the end of the game.
export const tileValue = (t) => (isJoker(t) ? JOKER_PENALTY : tileNum(t));

// The full 106-tile pool, before shuffling.
export function makePool() {
  const pool = [];
  for (const color of COLORS) {
    for (let n = 1; n <= NUMBERS; n++) { pool.push(`${color}${n}`, `${color}${n}`); }
  }
  pool.push(JOKER, JOKER);
  return pool;
}

// Small, fast seeded PRNG so both clients shuffle identically (the same
// mulberry32 the other engines use; kept inline per the per-engine convention).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function makeShuffledPool(seed) {
  return shuffle(makePool(), mulberry32(seed >>> 0));
}

// ---- Set validation ---------------------------------------------------------

// Classify a set as a valid group or run and return its point value, or
// { valid:false }. A group is 3–4 tiles of one number in distinct colours; a
// run is 3+ consecutive numbers of one colour. Jokers stand in for any tile —
// in a run a joker takes the value of the slot it occupies (by position), in a
// group it takes the group's number. Value counts jokers at their stand-in
// value (used for the opening-meld total).
export function classifySet(set) {
  if (!Array.isArray(set) || set.length < 3) return { valid: false };
  const reals = set.filter((t) => !isJoker(t));
  if (!reals.length) return { valid: false }; // an all-joker set is ambiguous

  // Group: all reals share a number, all reals have distinct colours, ≤ 4 tiles.
  if (set.length <= COLORS.length) {
    const num = tileNum(reals[0]);
    const colors = reals.map(tileColor);
    if (reals.every((t) => tileNum(t) === num) && new Set(colors).size === colors.length) {
      return { valid: true, kind: 'group', value: num * set.length };
    }
  }

  // Run: one colour, positions form a consecutive ascending sequence in 1–13.
  const color = tileColor(reals[0]);
  if (reals.every((t) => tileColor(t) === color)) {
    let start = null;
    for (let i = 0; i < set.length; i++) {
      if (!isJoker(set[i])) { start = tileNum(set[i]) - i; break; }
    }
    const end = start + set.length - 1;
    if (start >= 1 && end <= NUMBERS) {
      let sum = 0; let ok = true;
      for (let i = 0; i < set.length; i++) {
        const expected = start + i;
        if (!isJoker(set[i]) && tileNum(set[i]) !== expected) { ok = false; break; }
        sum += expected;
      }
      if (ok) return { valid: true, kind: 'run', value: sum };
    }
  }
  return { valid: false };
}

export const isValidSet = (set) => classifySet(set).valid;

// Best-effort canonical ordering for a set the player has assembled, so tiles
// dropped in any order still read (and validate) as a run/group when possible.
// Returns a re-ordered copy; if the tiles can't form a valid set it returns them
// unchanged (the UI then shows the set as invalid). Runs come back ascending
// with jokers slotted into their gaps; groups come back in colour order.
export function arrangeSet(tiles) {
  const jokers = tiles.filter(isJoker).length;
  const reals = tiles.filter((t) => !isJoker(t));
  if (!reals.length) return tiles.slice();
  const L = tiles.length;

  // Run: one colour, distinct numbers, fits a consecutive window of length L.
  const color = tileColor(reals[0]);
  if (reals.every((t) => tileColor(t) === color)) {
    const nums = reals.map(tileNum).sort((a, b) => a - b);
    const distinct = nums.every((n, i) => i === 0 || n !== nums[i - 1]);
    if (distinct) {
      const min = nums[0], max = nums[nums.length - 1];
      const lo = Math.max(1, max - L + 1), hi = Math.min(min, NUMBERS - L + 1);
      if (max - min <= L - 1 && lo <= hi) {
        const start = hi; // pack toward the high end so jokers tend to sit low/inside
        const have = new Set(nums);
        const out = []; let jleft = jokers;
        for (let i = 0; i < L; i++) {
          const n = start + i;
          if (have.has(n)) out.push(`${color}${n}`);
          else if (jleft > 0) { out.push(JOKER); jleft -= 1; }
          else return tiles.slice(); // can't happen if counts match
        }
        if (isValidSet(out)) return out;
      }
    }
  }

  // Group: same number, distinct colours — order by the canonical colour order.
  const num = tileNum(reals[0]);
  if (reals.every((t) => tileNum(t) === num)) {
    const byColor = reals.slice().sort((a, b) => COLORS.indexOf(tileColor(a)) - COLORS.indexOf(tileColor(b)));
    const out = [...byColor, ...Array(jokers).fill(JOKER)];
    if (isValidSet(out)) return out;
  }
  return tiles.slice();
}

// ---- Play validation --------------------------------------------------------

function tally(tiles) {
  const m = new Map();
  for (const t of tiles) m.set(t, (m.get(t) || 0) + 1);
  return m;
}
function tallyEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
const flatten = (table) => table.flat();

// Validate a proposed play: `newTable` (array of sets) replacing the current
// table, using `played` tiles taken from the mover's rack. Returns
// { ok:true, meldPoints } or { ok:false, error }.
//
// Rules enforced: every set on the new table is valid; tile conservation
// (new table = old table + the tiles played from your rack, nothing removed or
// conjured); the played tiles are actually in your rack; at least one tile is
// played; and, until you've melded, your opening play may only ADD brand-new
// sets worth ≥ 30 (no rearranging the existing table).
export function validatePlay(state, player, newTable, played) {
  if (!Array.isArray(newTable) || !Array.isArray(played)) return { ok: false, error: 'Malformed play.' };
  if (!played.length) return { ok: false, error: 'Play at least one tile, or draw.' };

  for (const set of newTable) {
    if (!isValidSet(set)) return { ok: false, error: 'Every group and run on the table must be valid.' };
  }

  // Conservation: the new table is exactly the old table plus your played tiles.
  const before = tally([...flatten(state.table), ...played]);
  const after = tally(flatten(newTable));
  if (!tallyEqual(before, after)) return { ok: false, error: 'Tiles don’t add up — you can only add tiles from your rack.' };

  // The played tiles must all be in your rack.
  const rackCount = tally(state.racks[player]);
  for (const [t, n] of tally(played)) {
    if ((rackCount.get(t) || 0) < n) return { ok: false, error: 'You don’t hold all those tiles.' };
  }

  // Opening meld: the existing sets must survive untouched and the new sets
  // (made only of your played tiles) must total at least MELD_MIN.
  if (!state.melded[player]) {
    const remaining = newTable.map((s) => s.join(','));
    for (const s of state.table) {
      const i = remaining.indexOf(s.join(','));
      if (i === -1) return { ok: false, error: 'Not until you’ve melded — your first play can’t rearrange the table.' };
      remaining.splice(i, 1);
    }
    const meldPoints = remaining.reduce((sum, k) => sum + classifySet(k.split(',')).value, 0);
    if (meldPoints < MELD_MIN) return { ok: false, error: `Your opening meld must total ${MELD_MIN}+ (this is ${meldPoints}).` };
    return { ok: true, meldPoints };
  }
  return { ok: true, meldPoints: 0 };
}

// ---- State ------------------------------------------------------------------

export function newGameState(seed) {
  return {
    seed,
    pool: makeShuffledPool(seed),
    numPlayers: 0,         // set by the `start` move (2–4)
    racks: [],             // one rack per player
    table: [],             // array of sets (each an ordered array of tiles)
    melded: [],            // has each player made their opening meld?
    out: [],               // has each player resigned / timed out (skipped in rotation)?
    turn: null,            // seat to move once started
    started: false,
    moveCount: 0,
    passes: 0,             // consecutive passes (only possible once the pool is empty)
    tpm: 0,                // seconds per move (from the start move) for the clock
    gameOver: false,
    winner: null,          // a seat index, or 'tie'
    endDetail: null,
    lastMove: null,
  };
}

function rackValue(rack) { return rack.reduce((s, t) => s + tileValue(t), 0); }

function removeTiles(rack, tiles) {
  for (const t of tiles) {
    const i = rack.indexOf(t);
    if (i === -1) throw new Error(`Tile ${t} not in rack`);
    rack.splice(i, 1);
  }
}

// Seats still in the game (not resigned / timed out).
function activeSeats(state) {
  const a = [];
  for (let s = 0; s < state.numPlayers; s++) if (!state.out[s]) a.push(s);
  return a;
}
// The next active seat clockwise from `from`.
function nextSeat(state, from) {
  for (let i = 1; i <= state.numPlayers; i++) {
    const s = (from + i) % state.numPlayers;
    if (!state.out[s]) return s;
  }
  return from;
}

function standings(state) {
  return activeSeats(state)
    .map((seat) => ({ seat, value: rackValue(state.racks[seat]) }))
    .sort((a, b) => a.value - b.value);
}
// Winner among the active seats by fewest points left in hand ('tie' if level).
function lowestRackWinner(state) {
  const rows = standings(state);
  if (!rows.length) return 'tie';
  return (rows.length > 1 && rows[1].value === rows[0].value) ? 'tie' : rows[0].seat;
}

function finishOut(state, winner, reason) {
  state.gameOver = true;
  state.winner = winner;
  state.endDetail = { reason, standings: standings(state) };
}
// After a seat drops out (resign/timeout): if one or none remain, end the game.
function finishIfLastStanding(state) {
  const act = activeSeats(state);
  if (act.length <= 1) { finishOut(state, act.length === 1 ? act[0] : 'tie', 'last-standing'); return true; }
  return false;
}

// ---- Apply / replay ---------------------------------------------------------

export function applyMove(state, move) {
  if (move.move_index !== state.moveCount) {
    throw new Error(`Move ${move.move_index} applied out of order (expected ${state.moveCount})`);
  }
  const player = move.player;
  const payload = move.payload || {};

  switch (move.type) {
    case 'start': {
      const n = payload.players || 2;
      if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`Bad player count ${n}`);
      state.numPlayers = n;
      state.racks = Array.from({ length: n }, () => []);
      state.melded = new Array(n).fill(false);
      state.out = new Array(n).fill(false);
      for (let i = 0; i < RACK_SIZE; i++) for (let s = 0; s < n; s++) state.racks[s].push(state.pool.shift());
      state.turn = Math.floor(mulberry32((state.seed ^ 0x5f3759df) >>> 0)() * n);
      state.started = true;
      state.tpm = payload.tpm || 0;
      state.lastMove = { type: 'start', player, first: state.turn };
      break;
    }
    case 'play': {
      if (player !== state.turn) throw new Error('Move played out of turn in log');
      const { table: newTable, played } = payload;
      const result = validatePlay(state, player, newTable, played);
      if (!result.ok) throw new Error(`Invalid play in move log: ${result.error}`);
      removeTiles(state.racks[player], played);
      state.table = newTable.map((s) => s.slice());
      state.melded[player] = true;
      state.passes = 0;
      state.lastMove = { type: 'play', player, count: played.length, meldPoints: result.meldPoints };
      if (state.racks[player].length === 0) finishOut(state, player, 'out'); // emptied rack — instant win
      else state.turn = nextSeat(state, player);
      break;
    }
    case 'draw': {
      if (player !== state.turn) throw new Error('Move played out of turn in log');
      if (!state.pool.length) throw new Error('Cannot draw from an empty pool');
      state.racks[player].push(state.pool.shift());
      state.passes = 0;
      state.lastMove = { type: 'draw', player, poolLeft: state.pool.length };
      state.turn = nextSeat(state, player);
      break;
    }
    case 'pass': {
      if (player !== state.turn) throw new Error('Move played out of turn in log');
      // Only reachable once the pool is empty and a player has no legal play.
      state.passes += 1;
      state.lastMove = { type: 'pass', player };
      state.turn = nextSeat(state, player);
      // A full round of passes (every active player) with no progress ends it.
      if (state.passes >= activeSeats(state).length) finishOut(state, lowestRackWinner(state), 'stalemate');
      break;
    }
    case 'resign': {
      state.out[player] = true;
      state.passes = 0;
      state.lastMove = { type: 'resign', player };
      if (!finishIfLastStanding(state) && state.turn === player) state.turn = nextSeat(state, player);
      break;
    }
    case 'timeout': {
      const flagged = payload.player;
      state.out[flagged] = true;
      state.passes = 0;
      state.lastMove = { type: 'timeout', player: flagged };
      if (!finishIfLastStanding(state) && state.turn === flagged) state.turn = nextSeat(state, flagged);
      break;
    }
    default:
      throw new Error(`Unknown move type: ${move.type}`);
  }
  state.moveCount += 1;
  return state;
}

export function replayMoves(seed, moves) {
  const state = newGameState(seed);
  const ordered = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const m of ordered) {
    if (m.type === 'rematch') continue; // cross-cutting control move, not gameplay
    applyMove(state, m);
  }
  return state;
}
