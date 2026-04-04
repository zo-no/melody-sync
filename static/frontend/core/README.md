# Core Frontend Runtime Map

This directory holds browser-wide runtime helpers for the owner chat shell.

Files by role:

- `bootstrap-data.js`: reads and writes inline bootstrap payloads from `window`.
- `app-state.js`: keeps the browser-level current-session/session-list snapshot.
- `bootstrap.js`: boot globals, build refresh UI, and shared startup helpers.
- `bootstrap-session-catalog.js`: session status/catalog helpers used during boot and refresh flows.
- `i18n.js`: translations and DOM hydration for localized text.
- `icons.js`: inline icon registry and DOM hydration.
- `layout-tooling.js`: responsive layout and viewport/keyboard coordination.
- `realtime.js`: websocket invalidation and reconnect loop.
- `realtime-render.js`: live transcript rendering and viewport preservation.
- `gestures.js`: mobile swipe shortcuts for shell navigation.
- `init.js`: final app bootstrap that starts tools, sessions, and realtime.

Boundary rules:

- Keep browser-wide runtime helpers here.
- Do not put session-specific fetch/update logic here; that belongs in `../session/`.
- Do not put sidebar task semantics here; that belongs in `../session-list/`.
- Keep `init.js` thin: orchestration only, not new domain rules.
