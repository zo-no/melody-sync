# AGENTS.md — MelodySync Project Context

This file is the repo-local context for coding agents. Keep it aligned with the shipped product, not historical experiments.

## What This Repo Is

MelodySync is a local-first AI workbench for one owner. The core durable object is a `Session`; each session can accumulate messages, files, run state, task metadata, and follow-up work across refreshes and restarts.

Current product boundaries:

- single owner
- session-first workflow
- detached runs with durable reconciliation
- vanilla JS frontend with no build step
- Node.js backend with built-ins plus `ws`
- App templates, public share/visitor mode, and session-level scheduled triggers are removed

The shipped feature surface lives in [`docs/current-features.md`](docs/current-features.md).

## Runtime Shape

```text
Browser / mobile shell
  -> chat-server.mjs (default port 7760)
  -> HTTP APIs + WS invalidation hints
  -> session metadata + event history + run state on disk
  -> detached runner sidecars for tool execution
```

- Default port comes from [`lib/config.mjs`](lib/config.mjs) and is `7760`
- Restarts are acceptable because sessions and runs reconcile from durable state
- Use `MELODYSYNC_INSTANCE_ROOT` for isolated local/dev runtimes

## High-Signal Code Map

### Backend

- [`backend/router.mjs`](backend/router.mjs): main HTTP surface plus response/cache/static dispatch
- [`backend/controllers/session/access.mjs`](backend/controllers/session/access.mjs): session access guard factory for HTTP routes
- [`backend/controllers/session/delete-routes.mjs`](backend/controllers/session/delete-routes.mjs): session delete HTTP controller
- [`backend/controllers/session/message-request.mjs`](backend/controllers/session/message-request.mjs): multipart/JSON message request parsing for session message posts
- [`backend/controllers/session/patch-routes.mjs`](backend/controllers/session/patch-routes.mjs): session patch HTTP controller
- [`backend/controllers/session/post-routes.mjs`](backend/controllers/session/post-routes.mjs): session create/action/message HTTP controller
- [`backend/controllers/system/read-routes.mjs`](backend/controllers/system/read-routes.mjs): system HTTP read controller
- [`backend/controllers/system/write-routes.mjs`](backend/controllers/system/write-routes.mjs): system HTTP mutation controller
- [`backend/controllers/workbench/read-routes.mjs`](backend/controllers/workbench/read-routes.mjs): workbench HTTP read controller
- [`backend/controllers/workbench/write-routes.mjs`](backend/controllers/workbench/write-routes.mjs): workbench HTTP mutation controller
- [`backend/session/manager.mjs`](backend/session/manager.mjs): session and run orchestration
- [`backend/run/store.mjs`](backend/run/store.mjs): durable run manifests, spool, status, result
- [`backend/run/supervisor.mjs`](backend/run/supervisor.mjs): detached runner launcher
- [`backend/run/sidecar.mjs`](backend/run/sidecar.mjs): detached executor entry
- [`backend/provider-runtime-monitor.mjs`](backend/provider-runtime-monitor.mjs): provider timeout / termination monitoring
- [`backend/run/sidecar-finalize.mjs`](backend/run/sidecar-finalize.mjs): run finalization helpers
- [`backend/history.mjs`](backend/history.mjs): append-only event store
- [`backend/session/meta-store.mjs`](backend/session/meta-store.mjs): session metadata persistence
- [`backend/session/api-shapes.mjs`](backend/session/api-shapes.mjs): API projection helpers
- [`backend/services/settings/http-service.mjs`](backend/services/settings/http-service.mjs): settings read/update orchestration for HTTP routes
- [`backend/services/hooks/http-service.mjs`](backend/services/hooks/http-service.mjs): legacy hook alias orchestration layered on hook settings
- [`backend/services/session/http-message-service.mjs`](backend/services/session/http-message-service.mjs): attachment resolution plus HTTP message submission orchestration
- [`backend/services/system/config-reload-service.mjs`](backend/services/system/config-reload-service.mjs): deferred process restart scheduling for config changes
- [`backend/services/system/page-build-service.mjs`](backend/services/system/page-build-service.mjs): service/frontend build info, template file cache, and static asset resolution
- [`backend/views/system/page-template.mjs`](backend/views/system/page-template.mjs): chat/login shell placeholder projection and script-safe bootstrap serialization
- [`backend/shared/http/response-cache.mjs`](backend/shared/http/response-cache.mjs): shared HTTP ETag/compression/cached response writers
- [`backend/shared/http/request-body.mjs`](backend/shared/http/request-body.mjs): shared JSON request-body parsing for HTTP controllers
- [`backend/workbench/index.mjs`](backend/workbench/index.mjs): task/workbench domain entry layered on sessions

### Frontend

- [`templates/chat.html`](templates/chat.html): main shell
- [`frontend-src/frontend.js`](frontend-src/frontend.js): versioned loader
- [`frontend-src/core/bootstrap.js`](frontend-src/core/bootstrap.js): bootstrap/runtime globals
- [`frontend-src/core/bootstrap-data.js`](frontend-src/core/bootstrap-data.js): bootstrap payload helpers
- [`frontend-src/core/bootstrap-session-catalog.js`](frontend-src/core/bootstrap-session-catalog.js): session/source/user catalog helpers
- [`frontend-src/core/realtime.js`](frontend-src/core/realtime.js): WS invalidation / reconnect logic
- [`frontend-src/core/realtime-render.js`](frontend-src/core/realtime-render.js): transcript refresh/render helpers
- [`frontend-src/session/http.js`](frontend-src/session/http.js): canonical session HTTP client
- [`frontend-src/session/tooling.js`](frontend-src/session/tooling.js): runtime/tool/model controls
- [`frontend-src/session/compose.js`](frontend-src/session/compose.js): composer interactions
- [`frontend-src/session/transcript-ui.js`](frontend-src/session/transcript-ui.js): transcript/event rendering and attachment UI
- [`frontend-src/session/surface-ui.js`](frontend-src/session/surface-ui.js): session detail rendering
- [`frontend-src/session/state-model.js`](frontend-src/session/state-model.js): session derived state helpers
- [`frontend-src/session-list/model.js`](frontend-src/session-list/model.js): session list grouping, badges, and lightweight branch semantics
- [`frontend-src/session-list/ui.js`](frontend-src/session-list/ui.js): session list rendering
- [`frontend-src/session-list/sidebar-ui.js`](frontend-src/session-list/sidebar-ui.js): sidebar interactions
- [`frontend-src/workbench/controller.js`](frontend-src/workbench/controller.js): workbench coordinator

### Shared

- [`lib/auth.mjs`](lib/auth.mjs): auth and cookies
- [`lib/config.mjs`](lib/config.mjs): runtime paths and defaults
- [`lib/tools.mjs`](lib/tools.mjs): tool catalog and discovery
- [`lib/runtime-selection.mjs`](lib/runtime-selection.mjs): persisted tool/model/effort selection

## Durable Data

Important files under the active instance root:

- `AGENTS.md`
- `config/`
- `memory/`
- `sessions/chat-sessions.json`
- `sessions/history/`
- `sessions/runs/`
- `hooks/custom-hooks.json`
- `workbench/`
- `logs/`

## Working Rules

1. Keep the product session-first. Do not reintroduce App/template/share abstractions unless explicitly requested.
2. Prefer low-intrusion refactors: smaller modules, cleaner boundaries, same behavior.
3. HTTP is canonical. WebSocket is an invalidation hint, not the source of truth.
4. When removing a feature, update code, tests, and canonical docs together.
5. Treat old fields like `appId` / `appName` as passive compatibility metadata unless the product explicitly revives that concept.
6. Edit source modules, not generated/runtime artifacts. `.melody-sync-runtime/releases/` are immutable release snapshots and `.playwright-cli/` files are tool output, not source.

## Fast Path By Change Type

- session or run semantics: start with [`backend/session/README.md`](backend/session/README.md), [`backend/run/README.md`](backend/run/README.md), then open [`backend/session/manager.mjs`](backend/session/manager.mjs)
- storage and retention: read [`docs/application-storage-architecture.md`](docs/application-storage-architecture.md), then inspect [`backend/session/meta-store.mjs`](backend/session/meta-store.mjs) and [`backend/run/store.mjs`](backend/run/store.mjs)
- HTTP or route changes: start at [`backend/router.mjs`](backend/router.mjs), then narrow into `backend/routes/`
- hooks or settings: start at [`backend/hooks/README.md`](backend/hooks/README.md) or [`backend/settings/README.md`](backend/settings/README.md)
- workbench changes: start at [`backend/workbench/index.mjs`](backend/workbench/index.mjs) and then the matching `frontend-src/workbench/` module

This keeps AI-assisted edits close to the real domain entrypoints and reduces drift caused by opening historical notes or runtime snapshots first.

## Read These First

1. [`README.md`](README.md) / [`README.zh.md`](README.zh.md)
2. [`docs/current-features.md`](docs/current-features.md)
3. [`docs/project-architecture.md`](docs/project-architecture.md)
4. [`notes/current/core-domain-contract.md`](notes/current/core-domain-contract.md)
5. [`notes/current/core-domain-implementation-mapping.md`](notes/current/core-domain-implementation-mapping.md)
