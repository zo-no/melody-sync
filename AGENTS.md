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
- Use `REMOTELAB_INSTANCE_ROOT` for isolated local/dev runtimes

## High-Signal Code Map

### Backend

- [`backend/router.mjs`](backend/router.mjs): main HTTP surface
- [`backend/session-manager.mjs`](backend/session-manager.mjs): session and run orchestration
- [`backend/runs.mjs`](backend/runs.mjs): durable run manifests, spool, status, result
- [`backend/runner-supervisor.mjs`](backend/runner-supervisor.mjs): detached runner launcher
- [`backend/runner-sidecar.mjs`](backend/runner-sidecar.mjs): detached executor entry
- [`backend/provider-runtime-monitor.mjs`](backend/provider-runtime-monitor.mjs): provider timeout / termination monitoring
- [`backend/runner-sidecar-finalize.mjs`](backend/runner-sidecar-finalize.mjs): run finalization helpers
- [`backend/history.mjs`](backend/history.mjs): append-only event store
- [`backend/session-meta-store.mjs`](backend/session-meta-store.mjs): session metadata persistence
- [`backend/session-api-shapes.mjs`](backend/session-api-shapes.mjs): API projection helpers
- [`backend/workbench/index.mjs`](backend/workbench/index.mjs): task/workbench domain entry layered on sessions

### Frontend

- [`templates/chat.html`](templates/chat.html): main shell
- [`static/frontend.js`](static/frontend.js): versioned loader
- [`static/frontend/core/bootstrap.js`](static/frontend/core/bootstrap.js): bootstrap/runtime globals
- [`static/frontend/core/bootstrap-data.js`](static/frontend/core/bootstrap-data.js): bootstrap payload helpers
- [`static/frontend/core/bootstrap-session-catalog.js`](static/frontend/core/bootstrap-session-catalog.js): session/source/user catalog helpers
- [`static/frontend/core/realtime.js`](static/frontend/core/realtime.js): WS invalidation / reconnect logic
- [`static/frontend/core/realtime-render.js`](static/frontend/core/realtime-render.js): transcript refresh/render helpers
- [`static/frontend/session/http.js`](static/frontend/session/http.js): canonical session HTTP client
- [`static/frontend/session/tooling.js`](static/frontend/session/tooling.js): runtime/tool/model controls
- [`static/frontend/session/compose.js`](static/frontend/session/compose.js): composer interactions
- [`static/frontend/session/transcript-ui.js`](static/frontend/session/transcript-ui.js): transcript/event rendering and attachment UI
- [`static/frontend/session/surface-ui.js`](static/frontend/session/surface-ui.js): session detail rendering
- [`static/frontend/session/state-model.js`](static/frontend/session/state-model.js): session derived state helpers
- [`static/frontend/session-list/model.js`](static/frontend/session-list/model.js): session list grouping, badges, and lightweight branch semantics
- [`static/frontend/session-list/ui.js`](static/frontend/session-list/ui.js): session list rendering
- [`static/frontend/session-list/sidebar-ui.js`](static/frontend/session-list/sidebar-ui.js): sidebar interactions
- [`static/frontend/workbench/controller.js`](static/frontend/workbench/controller.js): workbench coordinator

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

## Read These First

1. [`README.md`](README.md) / [`README.zh.md`](README.zh.md)
2. [`docs/current-features.md`](docs/current-features.md)
3. [`docs/project-architecture.md`](docs/project-architecture.md)
4. [`notes/current/core-domain-contract.md`](notes/current/core-domain-contract.md)
5. [`notes/current/core-domain-implementation-mapping.md`](notes/current/core-domain-implementation-mapping.md)
