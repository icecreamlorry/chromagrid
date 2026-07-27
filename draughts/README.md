# Draughts

Classic two-player **draughts** (English draughts / checkers) for LB Games —
asynchronous, on the shared rooms / accounts / push layer, using the shared
turn-based-table-game kit (per-move time controls, confirm-moves toggle, clocks).

## Playing

Create a game and pick a **per-move time control** (Unlimited, or 1 minute up to
3 days). Share the room code or challenge a friend. The seed decides who plays
the light pieces (and moves first).

- A **man** moves one square diagonally **forward**; **kings** (crowned on
  reaching the far row, shown with a gold ring) move one square in any diagonal
  direction.
- **Captures are compulsory** — if you can jump an enemy to the empty square
  beyond, you must, and a multi-jump must be completed. Build a jump chain by
  tapping each landing square (the piece hops and captured pieces vanish as you
  go); drag works for the first step.
- With **Confirm moves** on (default), build the move then press **Confirm**;
  turn it off in the burger menu to play the instant a move is complete.
- You win by capturing or trapping all of the opponent's pieces. A long spell
  with no captures and no man moves is a draw, as is agreement (**½ Draw**).

## Architecture

- `js/engine.js` — pure, deterministic English-draughts rules folded from the
  move log (`start` / `move` / `resign` / `timeout` / `draw-*`). Moves are jump
  paths (`payload.path`); the forced-capture and crown-ends-the-move rules are
  enforced in move generation. Thoroughly unit-tested.
- `js/board.js` — SVG board renderer (round pieces, king rings, highlights,
  legal-move dots, tap + drag), the same input pipeline as the chess board.
- `js/main.js` — screens, rooms, time-control setup, multi-jump move building,
  per-move clock + timeout, draw offers, resignation, notifications, rematch.
- `js/{config,net,notify}.js` — per-game identity over the shared layer.
- Shared kit: `shared/time-control.js`, `shared/move-confirm.js`.

No build step; vanilla ES modules.

## Tests

```
node draughts/test/engine.test.mjs   # rules: forced/multi captures, crowning, wins, draws, replay
```

## Icons

```
node draughts/tools/make-icons.mjs
```

## Database

Reuses the shared schema unchanged — the time control rides the `start` move and
is stamped on the host's player record. No new columns.
