---
name: comparative-game-reviewer
description: >-
  General comparative audit runbook and probing methodology for LB Games subagents.
  Focuses on interface integrity, failure-mode tracing, state transition probing,
  and architectural parity rather than static bug checklists.
---

# Comparative Game Reviewer — Probing & Audit Methodology

This runbook guides subagent reviewers in conducting deep, probing audits of new or refactored games in LB Games. The goal is to discover unknown bugs, architectural divergence, and runtime edge-case failures by analyzing system dynamics rather than checking static bug lists.

---

## 🔬 Core Probing Principles

Subagents auditing code must evaluate targets using four general investigative lenses:

### 1. 🔌 Interface & Contract Integrity
Do not assume that an imported module or utility behaves like its reference counterpart.
- **Trace Import-to-Export Signatures**: When a file imports symbols from a sibling config, net, or shared module, verify that the exported interface is fully satisfied without missing named exports, incomplete re-exports, or signature mismatches.
- **Dependency Completeness**: Ensure module dependencies expose the complete contract expected by shared framework wrappers (e.g. `quiz-game.js`, `table-game.css`, `lobby-ui.js`).

### 2. ⚡ Async Lifecycle & Failure Mode Tracing
Happy-path code often hides critical runtime bricking bugs. Actively probe non-ideal runtime scenarios:
- **Network Latency & Timeout Boundaries**: Trace every `await` or async network request (Supabase room fetches, session hydration, deep links). Ask: *If this request hangs or fails, does the UI recover, fallback gracefully, or block screen lifecycle hooks (like boot veils) indefinitely?*
- **Auth & State Transitions**: Trace user state changes (`guest -> signed-in`, `signed-in -> signed-out`, `in-game -> leave`). Does the application render the appropriate screen layout (`landing`, `lobby`, `game`) dynamically without stranding the user on an unrendered or stale DOM section?
- **Session & Deep Link Recovery**: Trace clean boots vs page refreshes vs deep-linked room joins (`?room=CODE`). Ensure fallback paths resolve cleanly if the target room no longer exists or network connection is degraded.

### 3. 🏛️ Architectural & Group Parity
Compare the target codebase against established reference titles in the same family (`backgammon`/`chess`/`weiqi` for Table Games; `flagz`/`atlaz`/`buffz` for Quiz Games).
- **Functional Completeness**: Ask: *Does this title provide the same platform capabilities (session persistence, rematch proposals, live clocks, history modals, copyable room links, PWA assets) as mature reference titles in its group?*
- **Layout & Overlay Architecture**: Ensure the DOM hierarchy includes standard overlays (setup, countdown, gameover/results) and responsiveness controls required by shared platform styles.

### 4. 🎯 Adversarial Inspection Mindset
Subagents must mentally attempt to "break" the game flow during review by simulating edge cases:
- Rapid clicking on action buttons before state resolves.
- Opening game pages while offline or with degraded connectivity.
- Navigating between landing, lobby, and active games across auth transitions.

---

## 📜 Audit Output Format

Subagents should structure their review findings into three clear sections:
1. **Architectural & Interface Divergences**: Missing or broken module contracts, export mismatches, or layout deviations.
2. **Lifecycle & Failure Mode Vulnerabilities**: Potential hangs, unhandled promise rejections, missing timeouts, or invalid screen transitions.
3. **Player Experience & UX Gaps**: Missing interactive feedback, unhandled offline fallbacks, or broken deep-link share handlers.
