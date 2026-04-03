# Workbench Frontend Map

This directory owns the structured task-workbench UI.

Files by role:

- `node-contract.js`: frontend node-kind contract that validates and exposes the backend-provided node definitions and composition metadata.
- `node-effects.js`: shared node semantics for task-map projection and rendering, including counts, interaction, edge, surface, capability, and view-type rules.
- `node-settings-model.js`: node-definition payload normalization plus lane/role/merge-policy labels for the node-settings tab.
- `task-map-plan.js`: optional graph-plan overlay that can replace or augment the default continuity projection without touching renderer code; augment mode now also merges matching node ids so hook-generated plans can enrich default nodes instead of duplicating them.
- `task-map-model.js`: session/workbench snapshot to task-map projection.
- `quest-state.js`: session/workbench snapshot selectors and derived view state.
- `task-tracker-ui.js`: top tracker rendering.
- `task-map-ui.js`: task-map rendering and interaction.
- `node-settings-ui.js`: task-map node settings tab content mounted inside the shared settings overlay.
- `task-list-ui.js`: workbench-side task list rendering.
- `branch-actions.js`: branch lifecycle buttons and action binding.
- `operation-record-ui.js`: right-rail operation-record rendering and open/close control.

Design rules:

- `workbench-ui.js` should stay a coordinator, not absorb renderer details again.
- Keep contracts and projection close to the workbench UI that consumes them.
- Treat `chat/workbench/node-definitions.mjs` as the canonical current node source; `node-contract.js` should read bootstrap/API-fed definitions and keep a safe fallback for isolated tests.
- Keep node behavior centralized in `node-effects.js`; avoid adding new `kind === ...` branches directly in `task-map-model.js` or `task-map-ui.js`.
- Treat `view.type` as the right-canvas rendering contract. The renderer decides layout and safe embedding; plans decide what to show.
- Keep optional graph overrides centralized in `task-map-plan.js`; default continuity projection should stay available as the fallback path.
- Treat hook-generated `taskMapPlan` overlays as node metadata enrichers first. If a hook wants to enrich an existing default node, reuse the same node id and let the plan merge path attach summary/view/surface metadata.
- Treat `/api/workbench/task-map-plan-contract` as the canonical backend contract for future hook/AI graph planning inputs.
- Keep node settings owned by the workbench domain even though they render inside the shared settings overlay.
- Put new visual rendering into a focused `*-ui.js` module.
- Put derived state in selectors like `quest-state.js`, not inline in render code.
