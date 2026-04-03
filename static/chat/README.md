# Chat Frontend Map

This directory is the no-build frontend for the owner chat surface.

Read this before moving code:

- `../chat.js`: split-loader entry. If an asset path changes, update the loader and `templates/chat.html` together.
- `core/`: browser-wide runtime shell helpers: bootstrap payloads, icons/i18n, layout, websocket invalidation, gestures, and final app init.
- `session/`: session-scoped fetch/update helpers, derived state, and session surface rendering.
- `session-list/`: left sidebar task-list contract, ordering contract, list model, list UI, and sidebar shell interactions.
- `settings/`: shared settings overlay shell plus tab-specific settings surfaces such as `hooks/`.
- `workbench/`: node contract, node settings tab/model, task-map model, tracker, quest-state selectors, operation-record rail, and branch action UI.
- Root-level files should now be thin coordinators or explicit leftovers only:
  - `workbench-ui.js`: workbench shell/wiring
  - `timer.js`: isolated header timer surface
  - `__static_probe_*.js`: static-serving probe artifact

Prefer adding new files inside a domain directory instead of reviving the root.

Boundary rules:

- Keep contracts close to the domain that uses them.
- Keep model/projection separate from UI rendering.
- Keep `session/surface-ui.js` focused on the attached session surface, not sidebar list behavior.
- Keep browser-wide runtime helpers in `core/`, not in the root.
