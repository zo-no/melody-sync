# Session List Frontend Map

This directory owns the left sidebar task list.

Files by role:

- `contract.js`: canonical GTD group definitions and AI-mutable field contract.
- `order-contract.js`: canonical ordering-source contract shared with `../session/state-model.js`.
- `model.js`: canonical sidebar-entry classifier for visibility, grouping, persistent routing, badges, and branch semantics.
- `ui.js`: DOM rendering for the sidebar task list and archive section.
- `sidebar-ui.js`: sidebar open/close/collapse shell behavior and task-entry shortcuts.

Design rules:

- The sidebar is a task-entry surface, not a second task-map tree.
- `model.js` owns task-list policy. UI should ask it for entry semantics instead of re-deriving visibility or routing rules.
- Closed branch sessions (`resolved` / `merged`) should stay out of the sidebar; reopening them belongs to the task map.
- Keep grouping, placement, and badge logic in `model.js`.
- Keep list DOM behavior in `ui.js`.
- Keep shell open/close/collapse behavior in `sidebar-ui.js`.
- If you need relationship structure, use workbench/map data instead of rebuilding it here.
