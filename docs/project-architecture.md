# Project Architecture

This document describes the current shipped MelodySync architecture after share/visitor mode, App templates, and scheduled triggers were removed.

## Product Boundary

MelodySync is now an owner-operated AI task workspace.

- One authenticated owner controls the instance.
- `Session` is the durable work thread.
- `Run` is one detached execution attempt under a session.
- `sourceId` / `sourceName` remain as passive session metadata for connectors and categorization.
- Public share links, visitor mode, App templates, and scheduled triggers are not part of the current product.

## Runtime Topology

### Main process

`chat-server.mjs`

- boots the HTTP server
- wires auth, routes, static assets, websocket invalidation, and background recovery

### Core backend modules

`chat/router.mjs`

- top-level HTTP dispatcher
- serves auth/build/runtime/session APIs
- keeps removed admin surfaces on explicit `410 Gone`

`chat/session-manager.mjs`

- session CRUD
- history/event persistence
- prompt construction
- detached run orchestration
- fork/delegate flows
- session invalidation broadcasts

`chat/runner-sidecar.mjs`

- launches provider runtimes
- streams normalized output into the session event store
- coordinates timeout/finalize helpers through runtime monitor modules

### Frontend

`templates/chat.html`

- owner-facing chat shell

`static/chat.js`

- loader for split frontend assets

`static/chat/`

- `bootstrap*.js`: boot data, session catalog, navigation, startup state
- `session-http*.js`: HTTP fetch/update helpers and attach/refresh logic
- `realtime*.js`: websocket lifecycle and live rendering
- `tooling.js`: tool/model/thinking picker and session controls
- `compose.js`: composer, attachments, queued follow-ups
- `workbench-ui.js`: task/workbench surface

## Core Domain Objects

### AuthSession

Represents the logged-in owner browser.

Current shape:

- `role: 'owner'`
- cookie-backed auth session created by `lib/auth.mjs`

### Session

Represents a durable task thread.

Key fields:

- `id`
- `name`
- `tool`
- `sourceId`, `sourceName`
- `group`, `description`
- `workflowState`, `workflowPriority`
- `forkedFromSessionId`, `rootSessionId`
- optional passive legacy metadata such as `appId` / `appName`

Persistence:

- metadata in `chat-sessions.json`
- event timeline in `chat-history/<sessionId>/`

### Run

Represents one execution attempt under a session.

Key fields:

- `id`
- `sessionId`
- `requestId`
- `state`
- `tool`, `model`, `effort`, `thinking`
- provider resume ids such as `codexThreadId` or `claudeSessionId`

Persistence:

- `chat-runs/<runId>/status.json`
- `chat-runs/<runId>/manifest.json`

## Main Flows

### Boot and load

1. Browser loads `chat.html`.
2. `static/chat.js` loads the split frontend.
3. Frontend calls `/api/auth/me`, `/api/tools`, `/api/sessions`, and related owner APIs.
4. WebSocket connects to `/ws`.
5. The selected session is hydrated by HTTP, then kept fresh by invalidation messages.

### Send a message

1. Frontend posts to `/api/sessions/:id/messages`.
2. `session-manager.mjs` records the user event, creates a run, and spawns a detached runner.
3. Provider output is normalized into session events.
4. Session invalidation broadcasts tell owner clients to refresh the affected thread.

### Queue follow-up while busy

1. If a session already has an active run, new requests can enter `followUpQueue`.
2. Queue state is stored in session metadata.
3. When the active run finishes, the queued turn is dispatched automatically.

### Fork or delegate

1. Source session is read from durable history plus context-head snapshots.
2. A child session is created with copied history/context as needed.
3. The new session becomes its own durable thread with isolated future runs.

## Persistence Layout

Default root: `~/.config/remotelab/`

- `auth.json` — owner auth config
- `tools.json` — tool catalog
- `chat-sessions.json` — session metadata
- `chat-history/` — per-session event and body storage
- `chat-runs/` — per-run state and manifests
- `assets/` — uploaded/generated files

An isolated instance can override this via `REMOTELAB_INSTANCE_ROOT`, `REMOTELAB_CONFIG_DIR`, and `REMOTELAB_MEMORY_DIR`.

## Current Constraints

- The system is owner-only. Do not reintroduce visitor/share assumptions into auth, routing, or frontend state.
- `chat/session-manager.mjs` is still the biggest complexity hotspot.
- Frontend state is split but still mostly global-script driven.
- Legacy `appId` / `appName` fields may still appear in stored session metadata, but they are not a shipped App system anymore.

## Where To Read Next

- `../README.md` / `../README.zh.md` for the operator-facing overview
- `current-features.md` for the current shipped feature surface
- `../notes/current/core-domain-contract.md` for the current domain model
- `setup.md` for deployment/setup flow
