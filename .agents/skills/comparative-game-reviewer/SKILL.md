---
name: comparative-game-reviewer
description: >-
  Mandatory comparative code quality and player experience audit runbook for LB Games.
  Use when launching subagents to review new or refactored games against established baseline implementations.
---

# Comparative Game Reviewer Skill & Runbook

This skill defines the mandatory review procedure for code reviewer and player reviewer subagents auditing new or refactored games in LB Games.

---

## 🎯 Review Objectives

1. **Prevent Silent Runtime & Boot Failures**: Verify that `window.LBBoot?.done()` is called on every boot path and all network room joins feature fast timeout wrappers (2.5s) so pages never hang behind the loading veil.
2. **Enforce Group Screen Routing**: Verify that signed-in visitors are routed to the **Active Games Lobby (`#screen-lobby`)** via `renderLobby()`, rather than being stranded on the guest landing card (`#screen-landing`).
3. **Line-by-Line Reference Diffing**: Compare every new game file against an established baseline reference in the same group:
   - **Table Games Group Reference**: `backgammon/js/main.js`, `chess/js/main.js`, `weiqi/js/main.js`
   - **Quiz Games Group Reference**: `flagz/js/main.js`, `atlaz/js/main.js`, `buffz/js/main.js`

---

## 📋 The 9 Mandatory Platform Contracts Checklist

Every subagent auditing a game MUST verify all 9 contracts:

### Contract 1: Boot Veil & Fast Timeout
- `window.LBBoot?.done()` is invoked across ALL branches of `boot()` (online, offline solo, error, default landing).
- Room join/resume attempts use a `Promise.race([joinRoom(...), timeoutPromise])` with a 2.5s limit so network latency never blocks boot.

### Contract 2: Signed-In Lobby & Screen Routing
- Has `showScreen('landing'|'lobby'|'game')` helper.
- `onAuthChange` calls `handleAuthChange(user)`:
  - If signed in: calls `showScreen('lobby')` and `renderLobby()`.
  - If signed out: calls `showScreen('landing')`.
- `renderLobby()` fetches active rooms via `fetchMyRooms(app.userId)`, filters dismissed games via `filterDismissed`, and builds active cards.

### Contract 3: Time Controls & Live Clocks
- Setup modal uses standardized Table/Quiz keys (`unlimited`, `d3`, `d1`, `h1`, `m10`, `m1`).
- Instantiates `createMoveTimer` from `shared/time-control.js` to tick player panel clocks (`#my-clock`, `#opp-clock`).

### Contract 4: Move Confirmation Toggle
- Calls `injectConfirmToggle(GAME_SLUG, true, ...)` from `shared/move-confirm.js` to add the move confirm toggle to the burger menu.

### Contract 5: Rematch Proposals
- Imports `createRematch` from `shared/rematch.js` and instantiates `rematch.start()` and `rematch.follow(code)`.

### Contract 6: Game History Integration
- Imports `<script type="module" src="../shared/lobby-ui.js"></script>` in HTML.
- Wires `openHistory({ userId, gameSlug })` from `shared/history.js` to `#btn-lobby-history`.

### Contract 7: Dismissed Games Support
- Imports `filterDismissed`, `dismissGame`, `makeDismissControl` from `shared/dismissed-games.js`.

### Contract 8: Deep Link Sharing & Copy Handler
- Calls `takeRoomParam()` from `shared/deep-link.js` during boot.
- Attaches a click-to-copy handler to `$('room-code-chip')` using `roomShareUrl(code)`.

### Contract 9: PWA Manifests & App Assets
- `manifest.webmanifest` exists with correct `short_name`, `theme_color`, and icon paths.
- `sw.js` and `js/notify.js` exist.
- `icons/` folder contains `icon.svg`, `apple-touch-icon.png`, `icon-192.png`, and `icon-512.png`.
- HTML `<head>` includes PWA meta tags, `<link rel="manifest">`, `<meta name="theme-color">`, and `data-theme="maritime"`.

---

## 🧪 E2E Simulation Test Requirements

- Verify that `node <game>/test/engine.test.mjs` and `node <game>/test/e2e.test.mjs` exist and pass with 0 failures.
- E2E simulation test must cover complete gameplay from move 1 to victory/draw game-over evaluation.
