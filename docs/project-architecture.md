# Project Architecture

This document describes the current shipped MelodySync architecture after share/visitor mode, App templates, user-management surfaces, and scheduled triggers were removed.

## Product Boundary

MelodySync is now an owner-operated AI task workspace.

- One authenticated owner controls the instance.
- `Session` is the durable work thread.
- `Run` is one detached execution attempt under a session.
- `sourceId` / `sourceName` remain as passive session metadata for connectors and categorization.
- `appId` / `appName` and `userId` / `userName` may still exist in stored data as compatibility metadata.
- Public share links, visitor mode, App templates, user-management surfaces, and scheduled triggers are not part of the current product.

## Runtime Topology

### Main process

`chat-server.mjs`

- boots the HTTP server
- wires auth, routes, static assets, websocket invalidation, and background recovery

### Core backend modules

`backend/router.mjs`

- top-level HTTP dispatcher
- serves auth/build/runtime/session APIs
- still contains some retired compatibility stubs that should be pruned during cleanup

`backend/session-manager.mjs`

- session CRUD
- history/event persistence
- prompt construction
- detached run orchestration
- fork/delegate flows
- session invalidation broadcasts

`backend/runner-sidecar.mjs`

- launches provider runtimes
- streams normalized output into the session event store
- coordinates timeout/finalize helpers through runtime monitor modules

### Frontend

`templates/chat.html`

- owner-facing chat shell

`static/frontend.js`

- loader for split frontend assets

`static/frontend/`

- `core/`: bootstrap payloads, app state, i18n/icons, layout, websocket invalidation, gestures, app init
- `session/`: HTTP fetch/update helpers, derived session state, tooling, composer, transcript rendering, and attached session surface
- `session-list/`: task-list contract, ordering contract, grouping model, sidebar list rendering, and sidebar shell behavior
- `settings/hooks/`: hook settings lifecycle model plus browser entry UI
- `settings/email/`: mailbox identity, outbound, and automation settings UI
- `settings/voice/`: local voice-ingress settings UI backed by `runtimeRoot/voice/config.json`
- `workbench/`: task-map contract/model plus focused workbench renderers
- `workbench/controller.js`: workbench-side coordinator that wires graph, surfaces, and node canvas


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
- optional passive legacy metadata such as `appId` / `appName` and `userId` / `userName`

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
2. `static/frontend.js` loads the split frontend.
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

For the value/retention contract that sits on top of this filesystem shape, also read `application-storage-architecture.md`.

Default runtime behavior:

- `general-settings.json` now points at a portable `brainRoot` plus a machine-local `runtimeRoot`
- MelodySync keeps `AGENTS.md` and `memory/` under the brain, while runtime state such as `config/`, `email/`, `voice/`, `sessions/`, `hooks/`, `workbench/`, and `logs/` lives under the runtime root
- if no storage root is configured, MelodySync falls back to the home-local layout (`~/.config/melody-sync` plus `~/.melodysync/memory`)
- isolated instances can still override this via `MELODYSYNC_INSTANCE_ROOT`, `MELODYSYNC_CONFIG_DIR`, and `MELODYSYNC_MEMORY_DIR`

Vault-backed app root shape:

- `config/` — auth, sessions cookie store, runtime selection, push config, general settings
- `email/` — mailbox identity, allowlist, outbound, and automation config
- `memory/` — bootstrap/project/skills/task memory
- `sessions/` — machine-readable session storage:
  - `chat-sessions.json` for the current session catalog
  - `SESSIONS.md` for the human-readable session index derived from that catalog
  - `history/<sessionId>/` for append-only session events and deferred bodies
  - `runs/<runId>/` for durable run manifests, spool output, and results
  - `images/`, `file-assets/`, `file-assets-cache/` for uploaded assets
- `hooks/` — hook enable state and custom hook definitions
- `workbench/` — node settings, plans, branch contexts, summaries
- `logs/` — runtime logs

## Current Constraints

- The system is owner-only. Do not reintroduce visitor/share assumptions into auth, routing, or frontend state.
- `backend/session-manager.mjs` is still the biggest complexity hotspot.
- Frontend state is split but still mostly global-script driven.
- Legacy `appId` / `appName` / `userId` / `userName` fields may still appear in stored session metadata, but they are not shipped product systems anymore.
- Workbench and integrations remain valuable, but they should stay layered on the core session/run path rather than drive the primary architecture.

## Where To Read Next

- `../README.md` / `../README.zh.md` for the operator-facing overview
- `current-features.md` for the current shipped feature surface
- `../notes/current/core-domain-contract.md` for the current domain model
- `setup.md` for deployment/setup flow
- `voice/` — local voice-ingress config, event log, pid file, launcher script, and runtime log
