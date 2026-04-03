# Chat Frontend Map

This directory is the no-build frontend for the owner chat surface.

Read this before moving code:

- `../chat.js`: split-loader entry. If an asset path changes, update the loader and `templates/chat.html` together.
- Root-level files are shared runtime modules only: bootstrap, realtime, compose, layout, and shell coordination.
- `session/`: session-scoped fetch/update helpers, derived state, and session surface rendering.
- `session-list/`: left sidebar task-list contract, ordering contract, list model, and list UI.
- `settings/hooks/`: hook-settings lifecycle model plus browser entry UI.
- `workbench/`: node contract, task-map model, tracker, quest-state selectors, operation-record rail, and branch action UI.
- `workbench-ui.js`: workbench shell/wiring. Prefer adding rendering logic to `workbench/` modules instead of this file.

Boundary rules:

- Keep contracts close to the domain that uses them.
- Keep model/projection separate from UI rendering.
- Keep `session/surface-ui.js` focused on the attached session surface, not sidebar list behavior.
