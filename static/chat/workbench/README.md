# Workbench Frontend Map

This directory owns the structured task-workbench UI.

Files by role:

- `node-contract.js`: frontend node-kind contract that validates and exposes the backend-provided node definitions.
- `node-settings-model.js`: node-definition payload normalization plus lane/role/merge-policy labels for the node-settings tab.
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
- Keep node settings owned by the workbench domain even though they render inside the shared settings overlay.
- Put new visual rendering into a focused `*-ui.js` module.
- Put derived state in selectors like `quest-state.js`, not inline in render code.
