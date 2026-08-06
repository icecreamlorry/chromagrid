# Rummikub

A 2–4 player Rummikub for LB Games — real-time or over days, with a per-move
timer. Runs on the shared rooms/accounts/push layer under `shared/` and the
turn-based table-game shell (`shared/table-game.css`); only the rules engine and
the tile/table rendering are game-specific.

## How it works

- **Deterministic, hidden hands.** `js/engine.js` is pure: the 106-tile pool
  (1–13 in four colours, two each, plus two jokers) is shuffled from the room
  `seed` and dealt by replaying the move log, so every client reconstructs the
  identical pool, all racks and the table. Hidden racks are a UI convention —
  the client just never draws another player's tiles. This is the same trick
  Wurdz uses to deal hidden letters; no tile is stored per-deal in the log.
- **Player count** (2–4) is fixed by the `start` move's payload, so
  `replayMoves(seed, moves) -> { turn, gameOver, started }` needs no extra
  argument and the shared "your turn" dashboard treats it as an ordinary
  `replay` game. When the host starts, the room's `max_players` is trimmed to
  the players present so nobody can grab a seat mid-game.
- **Moves:** `start`, `play` (`{ table, played }` — the new arrangement of sets
  plus the tiles taken from your rack; the engine validates set legality,
  conservation and the ≥30 opening meld), `draw`, `pass` (only when the pool is
  empty), `resign` and `timeout`. Resign/timeout eliminate a seat and the rest
  play on; the last player standing, or the first to empty their rack, wins.

## Tests

```
node rummikub/test/engine.test.mjs
```

## Icons

Source of truth is `icons/icon.svg`; the PNGs are rendered from it by
`tools/render-icons.mjs` (never hand-edit them).
