# Workbench Frontend Map

This directory owns the structured task-workbench UI.

Files by role:

- `node-contract.js`: explicit task-map node-kind contract for the frontend projection layer.
- `task-map-model.js`: session/workbench snapshot to task-map projection.
- `quest-state.js`: session/workbench snapshot selectors and derived view state.
- `task-tracker-ui.js`: top tracker rendering.
- `task-map-ui.js`: task-map rendering and interaction.
- `task-list-ui.js`: workbench-side task list rendering.
- `branch-actions.js`: branch lifecycle buttons and action binding.
- `operation-record-ui.js`: right-rail operation-record rendering and open/close control.

Design rules:

- `workbench-ui.js` should stay a coordinator, not absorb renderer details again.
- Keep contracts and projection close to the workbench UI that consumes them.
- Put new visual rendering into a focused `*-ui.js` module.
- Put derived state in selectors like `quest-state.js`, not inline in render code.
