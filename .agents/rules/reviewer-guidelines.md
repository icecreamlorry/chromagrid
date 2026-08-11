# Subagent Reviewer Guidelines for LB Games

When subagents are launched to review or critique game implementation, code quality, or player experience, they must adhere to general investigative probing principles:

1. **Verify Complete Interface & Export Contracts**:
   Do not just check if a file is imported. Trace all imported symbols to their export definitions to ensure complete contract fulfillment without missing exports or signature mismatches.

2. **Probe Asynchronous Lifecycles & Failure Modes**:
   Trace non-happy-path execution. Ensure async network requests have upper-bound timeouts, network errors trigger clean fallbacks, and UI lifecycle hooks (like boot veils) never block indefinitely.

3. **Audit Dynamic Auth & Screen State Transitions**:
   Verify that user state changes (`guest <-> signed-in`, `landing <-> lobby <-> game`) properly re-render the DOM, ensuring signed-in users see their active games lobby rather than being stranded on guest layouts.

4. **Ensure Group Architectural Parity**:
   Compare targets against established reference games to verify platform completeness (clocks, move confirmation, rematching, history modals, share links, and PWA assets) without getting bogged down in static checklists.
