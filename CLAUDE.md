# LB Games — working notes for Claude

A family of vanilla-JS web games (Chromagrid, Wurdz, Scramblr, Splitz, Lexicorp,
Atlaz, Flagz, Atomyx, Buffz, Weiqi, Chess, Draughts, Backgammon) sharing one Supabase rooms/accounts/push
layer under `shared/`. No build step — static HTML + ES modules, served straight
from GitHub Pages (`icecreamlorry.github.io/lb-games`). Each game lives in its
own folder with `index.html`, `js/`, `css/style.css`, `sw.js`, `manifest`.

## ⚠️ New-game UI checklist — the bugs that keep coming back

These two layout bugs have been fixed in every game one at a time. **When you
add or restyle a game, do these up front and verify them, so we stop re-fixing
the same things.**

### 1. The floating hamburger menu (`#btn-menu`) must not overlap anything

`shared/account-ui.js` injects a **`position: fixed` hamburger button at the
top-right corner** (`#btn-menu`, z-index 970), on *every* screen. Any content a
screen puts in that corner will collide with it unless the screen reserves the
space. Required per game:

- **Game screen header** (and any other custom header, e.g. a tutorial header) —
  the header's own CSS must clear the corner:
  ```css
  .game-header {
    padding-right: 58px;                                   /* clear the 36px button */
    padding-top: calc(env(safe-area-inset-top, 0px) + 10px);
  }
  ```
- **Wide screens** — pull the button in beside the centred column instead of the
  far window corner (cosmetic, but every game does it). `N` = half the game
  column's max-width:
  ```css
  @media (min-width: 561px) {
    #screen-game:not(.hidden) ~ #btn-menu,
    #screen-game:not(.hidden) ~ #app-menu {
      right: max(calc(env(safe-area-inset-right, 0px) + 10px), calc(50% - N + 6px));
    }
  }
  ```
- **Lobby ("My Games")** — the shared card header clears the button via
  `shared/shared.css` (`#screen-lobby .bar { padding-right: 52px }`), so you get
  this for free **as long as** you don't override `.bar`.

Verify at ~412px wide that the button doesn't sit on the Leave/Resign/LOG OUT
buttons.

### 2. No horizontal scroll; screens are centred

Screens must not scroll sideways, and card-style screens (landing, lobby) must
be centred both ways. Required per game:

```css
html, body { height: 100%; overflow: hidden; }

/* Every card screen: FLEX-CENTRE it (all three properties) + clip overflow-x. */
#screen-landing, #screen-lobby {
  display: flex; align-items: center; justify-content: center;
  overflow-y: auto; overflow-x: hidden; padding: 20px;
}
```

- Cards use `width: min(420px, 92vw); max-width: 100%;` so they never exceed the
  viewport.
- Wide content (boards, tables, code) scrolls inside its own
  `overflow-x: auto` container — the page body never scrolls sideways.
- **Fixed-size boards/canvases in an `align-items: stretch` flex column** hug the
  left with a gap on the right: the panel stretches to the widest sibling (title,
  score bar) while the fixed-size board stays left-aligned inside it. Worst on a
  short viewport (iPhone Safari with toolbars) where the board shrinks to fit the
  height. Give the board's wrapper `align-self: center` so the panel hugs the
  board and centres (Chromagrid's `#grid-wrap`). Relatedly, an SVG/`<canvas>`
  with `width:100%` needs an ancestor with a *definite* width or it collapses to
  its 300px intrinsic size — don't leave the flex column on `margin:0 auto` alone
  (Weiqi's `.table` needs `width:100%`).

The classic mistake: setting only `justify-content: center` without
`display: flex` + `align-items: center`. That leaves the card top-left **and**
lets its fixed width push past the edge → both bugs at once.

## Shared layer (don't re-implement per game)

- `shared/rooms.js` + `shared/net.js` — rooms, moves, realtime, push. Each game's
  `js/net.js` calls `createNet(GAME_SLUG)`.
- `shared/account-ui.js` / `shared/lobby-ui.js` — auth modals, hamburger menu,
  the injected lobby card + account bar.
- `shared/boot.js` — the boot veil (lifts on `LBBoot.done()`, 8s failsafe).
- `shared/supabaseClient.js` imports supabase-js from a **CDN**, so the whole app
  graph only evaluates when that CDN is reachable. In a network-blocked sandbox
  the game screens won't boot; test game-independent pieces (engines, tutorials)
  in isolation instead.

### Turn-based table-game kit (Chess, Weiqi, Draughts, Backgammon, …)

The two-player board games share more than the rooms layer. Reuse these instead
of re-implementing per game — a new classic should mostly be a rules engine + a
board renderer over this kit:

- `shared/dice.js` — **deterministic seeded dice** for dice games (Backgammon).
  Rolls come from the room `seed` + a turn index (`rollDice`, `dicePips`,
  `openingRoll`), so both clients agree and no roll is ever stored in the log —
  the same purity trick the engines use for colours. Also exports `pipPositions`
  for drawing a die face. **Any future randomness in a folded-log engine must be
  seed-derived like this, never `Math.random()`.**

- `shared/time-control.js` — **per-move** time controls (`TIME_CONTROLS`,
  `TIME_LABELS/SHORT/SUBLABELS`, `TIME_ORDER`, `timeKeyFor`, `fmtClock`). The
  budget resets each turn (blitz *and* multi-day correspondence from one UI). The
  chosen seconds ride the `start` move (`payload.tpm`); the host's control key is
  stamped on `room.players[0].time` for the lobby.
  - `createMoveTimer({ elMy, elOpp, mySeat, context, onFlag })` runs the tick
    loop, renders both `.clock` spans, and calls `onFlag(seat)` once when a clock
    hits zero. `context()` returns `{ tpm, live, turn, anchorMs }`; anchor the
    clock to `room.last_move_at` on load and `Date.now()` on each applied move,
    and call `resetClaim()` when a move is applied. The engine needs a `timeout`
    move type (`{ player: flaggedSeat }` → other seat wins; either client may
    submit it — the DB move-index lock keeps it single).
- `shared/move-confirm.js` — the "confirm moves" preference (stage a preview,
  then Confirm / re-tap to play) with a burger-menu toggle. `confirmEnabled(slug,
  default)` + `injectConfirmToggle(slug, default, onChange)`. Weiqi defaults on
  (it always staged); Chess too.
- `shared/menu-toggle.js` — `addMenuToggle(...)` injects an on/off item into
  `#app-menu` (used by move-confirm; use it for any future per-game toggle).

Player panels are a two-row `.player-panel` (`.pp-row.pp-id` name on top,
`.pp-row.pp-meta` captures/clock/turn below) so a long name isn't cut off and
the turn pill never wraps — copy Chess/Weiqi's markup + the `.clock` styles.

- `shared/table-game.css` — **the whole game-shell layout** (landing, header +
  hamburger clearance, panels, clocks, overlays, modals, setup, lobby, controls,
  tutorial screen). All four table games `<link>` it after `shared.css`; each
  game's own `css/style.css` is then ONLY its board + piece rendering. Change a
  panel once here, not in 20 files. **Never re-add the layout per game, and never
  hardcode `font-family`/`--text`/`--panel` in a game — it all comes from here +
  the theme vars.**

**Colours + fonts are theme vars, always.** `shared.css` defines, per theme,
`--text` / `--muted` / `--good` / `--bad` / `--cyan-dark` and the content font
`--font-body`, plus the board-surface vars (`--sq-light/dark/edge`, `--cb-coord`,
`--goban-wood/edge/line`). A game must never define its own `:root { --text… }`
or `font-family: "Segoe UI"` — that's exactly what caused light-on-light under
the Pastel (light) theme and font drift between games. Light themes override
`--text`/`--muted` to dark ink; use `var(--font-body)` for all game text.

### Quiz-game kit (Atlaz, Flagz, Atomyx, Buffz, …)

The four seeded-quiz games share a layer too — reuse it for any new "guess from a
dataset against the clock, solo or in a room" game:

- `shared/quiz-engine.js` — the **pure, deterministic primitives**: `mulberry32`
  / `shuffleWith` / `seededShuffle` (one seeded RNG so every seat derives the
  same rounds from the room seed — never `Math.random()`), `expectedOrder` /
  `gradeOrder` for the "sort these" modes (pass your own `orderKey`), a
  `makeAnswerMatcher({ amp, saint, dropThe, packed })` factory for the type-the-
  name modes, and the `scoreOf` / `compareResults` / `rankSeats` / `winnerSeat`
  ranking (score desc, time asc; an equal *score* is a draw). Each game keeps
  only its own `buildRounds` + `MODES`/`DIFFS` tables and re-exports the shared
  bits so `test/engine.test.mjs` still imports everything from `js/engine.js`.
  Atlaz keeps its own sweep-aware ranking (the outlier).

- `shared/quiz-game.js` — **the whole landing/lobby/room/results flow controller**
  (`createQuizGame(cfg)`): screens, auth, lobby, presence, the prestart picker
  frame, countdown + per-round timer, results/ranking/persistence, spectating,
  the players strip, rematch, notifications and resume/boot. Each game passes a
  thin `cfg` describing only what differs — its engine tables, `loadData`, the
  picker rows (`buildCfgButtons` + `markSelected`), and how a picked config
  becomes a `start` payload + seeded rounds (`startPayload` / `payloadValid` /
  `buildRounds` / `resultMeta` / `historyDetail`). The DOM shell ids are shared
  across the games; only the play STAGE id is a cfg field (`stageId`). **Flagz,
  Atomyx and Buffz run on this** — their `main.js` is ~115–150 lines of config
  (down from ~800). **Atlaz stays on its own `main.js`**: it loads region
  geometry *asynchronously* at game start and uses mode-aware ranking + a jigsaw
  mode, which don't fit the synchronous controller without endangering the other
  three — it still shares `quiz-engine.js` + `quiz-game.css`.

- `shared/quiz-game.css` — **the whole quiz game-shell layout** (landing/lobby
  cards, buttons, chips, players strip, prompt bar, mode-config picker,
  countdown, results table, overlays, status). Linked after `shared.css` and
  before the game's own `css/style.css`, which is then ONLY the board/stage
  rendering (map, flag grid, periodic table, trivia card + the order/review rows
  that carry each game's artwork). The display font is one var, `--font-display`
  (defined here with the Fredoka `@import`) — never hardcode `'Fredoka'` in a
  game. Correct/incorrect `--ok-*`/`--bad-*` are fixed semantic colours (solid
  fill vs dashed border + ✓/✗ glyph, legible without hue), not theme vars.

## Per-game conventions

- Move log is the source of truth; engines are pure and deterministic and fold
  an ordered move log into state (`replayMoves`). Colours/first-player derive
  from the room `seed`.
- Per-game options (mode, board size, …) ride the `start` move payload — no new
  DB columns.
- Turn notifications, offline/online presence, and resignation come from the
  shared layer; Wurdz/Weiqi are the reference implementations.
- **Guests get a persistent per-device identity** (`shared/guest-id.js`,
  localStorage) so they can rejoin their seat with the room code after a browser
  close — never store the guest id in sessionStorage. For true auto-resume, keep
  the game's "resume this room" pointer in **localStorage for guests** (they have
  no server-side games list) and sessionStorage for signed-in players (they have
  the lobby). See Weiqi's `saveSession`/`readSession`/`clearSession`.
- Add each new game as a card in the root `index.html`, and give it engine tests
  under `<game>/test/*.mjs` (run with `node`).

## Git

Work on the designated feature branch, then fast-forward `main`
(`git fetch origin main && git checkout main && git merge --ff-only <branch> &&
git push origin main`). GitHub Pages serves `main`, so a push deploys it.
