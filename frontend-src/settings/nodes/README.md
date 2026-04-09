# Node Settings Frontend Map

This directory owns the node settings tab inside the shared settings overlay.

- `model.js`: node-definition payload normalization and label helpers for the node settings form.
- `ui.js`: settings-tab rendering and CRUD actions for custom node kinds.

Rules:

- Keep node settings mounted through the shared settings overlay, not through a separate workbench modal.
- Keep the settings-facing fetch contract under `/api/settings/nodes`.
- Keep runtime node rendering logic in `frontend-src/workbench/`; this directory is only for the owner-facing settings surface.
