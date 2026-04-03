# Session Frontend Map

This directory contains the session-scoped frontend chain.

- `tooling.js`: tool/model/thinking picker and session runtime-preference controls.
- `compose.js`: composer, attachments, pending-send state, and queued follow-up submission flow.
- `http-helpers.js`: shared HTTP helpers for session fetch/update work.
- `http-list-state.js`: session list refresh and list-state coordination layered on the HTTP client.
- `http.js`: canonical session fetch/update path for the no-build frontend.
- `state-model.js`: canonical session visual-state model used by the no-build frontend.
- `surface-ui.js`: attached-session rendering and session-row action helpers.

Keep this directory focused on the attached session lifecycle. Do not move session-list grouping or workbench projections here.
