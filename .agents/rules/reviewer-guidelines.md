# Subagent Reviewer Guidelines for LB Games

When launching subagents to review or critique game implementation, code quality, or player experience:

1. **Always Use Baseline Comparison**:
   Subagents MUST compare target code against established reference games (`backgammon`, `chess`, `weiqi` for Table games; `flagz`, `atlaz`, `buffz` for Quiz games).

2. **Audit Runtime Lifecycle & Boot Veil Timing**:
   Subagents MUST verify that `window.LBBoot?.done()` is called immediately and that all room resume network calls use a 2.5s timeout wrapper (`Promise.race`).

3. **Audit Signed-In Home / Lobby Navigation**:
   Subagents MUST verify that logged-in users are presented with `#screen-lobby` and `renderLobby()`, displaying active game cards and "your turn" badges.

4. **Audit All 9 Shared System Integrations**:
   Subagents MUST audit PWA manifests, icons, time controls, live clock ticking, move confirmation, rematching, history modals, deep links, and dismissed game controls.
