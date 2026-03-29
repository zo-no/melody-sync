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

- [`chat/router.mjs`](chat/router.mjs): main HTTP surface
- [`chat/session-manager.mjs`](chat/session-manager.mjs): session and run orchestration
- [`chat/runs.mjs`](chat/runs.mjs): durable run manifests, spool, status, result
- [`chat/runner-supervisor.mjs`](chat/runner-supervisor.mjs): detached runner launcher
- [`chat/runner-sidecar.mjs`](chat/runner-sidecar.mjs): detached executor entry
- [`chat/provider-runtime-monitor.mjs`](chat/provider-runtime-monitor.mjs): provider timeout / termination monitoring
- [`chat/runner-sidecar-finalize.mjs`](chat/runner-sidecar-finalize.mjs): run finalization helpers
- [`chat/history.mjs`](chat/history.mjs): append-only event store
- [`chat/session-meta-store.mjs`](chat/session-meta-store.mjs): session metadata persistence
- [`chat/session-api-shapes.mjs`](chat/session-api-shapes.mjs): API projection helpers
- [`chat/workbench-store.mjs`](chat/workbench-store.mjs): task/workbench state layered on sessions

### Frontend

- [`templates/chat.html`](templates/chat.html): main shell
- [`static/chat.js`](static/chat.js): versioned loader
- [`static/chat/bootstrap.js`](static/chat/bootstrap.js): bootstrap/runtime globals
- [`static/chat/bootstrap-data.js`](static/chat/bootstrap-data.js): bootstrap payload helpers
- [`static/chat/bootstrap-session-catalog.js`](static/chat/bootstrap-session-catalog.js): session/source/user catalog helpers
- [`static/chat/session-http.js`](static/chat/session-http.js): canonical session HTTP client
- [`static/chat/realtime.js`](static/chat/realtime.js): WS invalidation / reconnect logic
- [`static/chat/session-surface-ui.js`](static/chat/session-surface-ui.js): session detail rendering
- [`static/chat/session-list-ui.js`](static/chat/session-list-ui.js): session list rendering
- [`static/chat/sidebar-ui.js`](static/chat/sidebar-ui.js): sidebar interactions
- [`static/chat/compose.js`](static/chat/compose.js): composer interactions
- [`static/chat/workbench-ui.js`](static/chat/workbench-ui.js): task/workbench UI

### Shared

- [`lib/auth.mjs`](lib/auth.mjs): auth and cookies
- [`lib/config.mjs`](lib/config.mjs): runtime paths and defaults
- [`lib/tools.mjs`](lib/tools.mjs): tool catalog and discovery
- [`lib/runtime-selection.mjs`](lib/runtime-selection.mjs): persisted tool/model/effort selection

## Durable Data

Important files under the active instance root:

- `auth.json`
- `chat-sessions.json`
- `chat-history/`
- `chat-runs/`
- `assets/`
- `tools.json`

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
