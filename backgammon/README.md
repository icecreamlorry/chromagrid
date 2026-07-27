# Backgammon

Two-player **backgammon** for LB Games — asynchronous, on the shared rooms /
accounts / push layer, using the shared turn-based-table-game kit (per-move time
controls, clocks) and the shared **dice** module.

## Fair dice without a server

Because the engine is pure and both clients must agree on every roll, the dice
are **not** a per-client random. Each turn's dice are derived from the room seed
plus a turn index (`shared/dice.js`), so both players compute the same faces and
nobody can pick favourable rolls — and no dice value is ever written to the move
log. The opening roll (which decides who starts) comes from the same source and
never lands on doubles.

## Playing

Create a game and pick a **per-move time control** (Unlimited, or 1 minute up to
3 days). Share the room code or challenge a friend.

- Move all 15 of your checkers around into your **home board** (bottom-right) and
  **bear them off**; first to bear off all 15 wins (double for a **gammon**,
  triple for a **backgammon**).
- Each turn shows your two dice (four moves on **doubles**). Tap a checker then a
  highlighted point; you must use as many dice as you legally can. **Undo** steps
  back, **Done** submits (or passes when you're stuck). With **Confirm moves**
  off (burger menu) the turn plays automatically once it's forced complete.
- Landing on a lone enemy checker **hits** it to the **bar**; a player on the bar
  must re-enter before anything else. You can't land on a point held by two or
  more enemy checkers.

## Architecture

- `js/engine.js` — pure, deterministic rules folded from the move log (`start` /
  `move` / `resign` / `timeout`). A turn is one log entry of checker steps; the
  engine validates bar entry, hitting, bearing off (with overshoot) and enforces
  **maximum dice usage**. Dice come from `shared/dice.js`. Thoroughly unit-tested.
- `js/board.js` — SVG renderer (points, stacked checkers, bar, bear-off tray,
  dice, highlights) + tap input.
- `js/main.js` — screens, rooms, time-control setup, the roll → move → undo →
  done turn builder, per-move clock + timeout, resignation, notifications,
  rematch, gammon/backgammon result.
- `js/{config,net,notify}.js` — per-game identity over the shared layer.

No build step; vanilla ES modules. The doubling cube is intentionally left out
of this first version.

## Tests

```
node backgammon/test/engine.test.mjs   # dice, bar entry, hitting, bearing off, maximal usage, gammon/backgammon
node shared/test/dice.test.mjs         # the shared seeded dice
```

## Icons

```
node backgammon/tools/make-icons.mjs
```

## Database

Reuses the shared schema unchanged — the time control rides the `start` move and
is stamped on the host's player record. No new columns.
