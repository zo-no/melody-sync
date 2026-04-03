# Session List Frontend Map

This directory owns the left sidebar task list.

Files by role:

- `contract.js`: canonical GTD group definitions and AI-mutable field contract.
- `order-contract.js`: canonical ordering-source contract shared with `../session/state-model.js`.
- `model.js`: lightweight grouping, badge, and branch-semantic selectors.
- `ui.js`: DOM rendering for the sidebar task list and archive section.

Design rules:

- The sidebar is a task-entry surface, not a second task-map tree.
- Keep grouping and badge logic in `model.js`.
- Keep DOM behavior in `ui.js`.
- If you need relationship structure, use workbench/map data instead of rebuilding it here.
