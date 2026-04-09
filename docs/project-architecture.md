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
- owns request/response caching, compression, and final route handoff
- no longer owns page-build calculation or template projection logic

`backend/session/manager.mjs`

- session CRUD
- history/event persistence
- prompt construction
- detached run orchestration
- fork/delegate flows
- session invalidation broadcasts

`backend/run/sidecar.mjs`

- launches provider runtimes
- streams normalized output into the session event store
- coordinates timeout/finalize helpers through runtime monitor modules

`backend/controllers/session/message-request.mjs`

- parses JSON and multipart session message submissions
- normalizes uploaded/existing/external attachment request payloads before service orchestration

`backend/services/session/http-message-service.mjs`

- resolves attachment references for HTTP message posts
- submits session turns through the canonical session/run path without keeping that orchestration in the route

`backend/services/session/message-submission-service.mjs`

- owns the canonical submit-message/run-start flow used by manager, follow-up queue flushes, branching, and persistent-session execution
- keeps busy-session queueing, prompt assembly, run creation, and first-user-turn side effects out of the manager entry surface

`backend/services/session/organizer-service.mjs`

- owns organizer closeout patching and automatic post-run naming/grouping so those flows do not stay embedded in the manager

`backend/services/session/task-card-service.mjs`

- owns task-card stabilization and branch-candidate closeout shaping shared by metadata mutation, session read projections, and detached-run finalization

`backend/services/session/result-asset-publication-service.mjs`

- owns result-file asset publication and transcript-message emission for completed runs

`backend/services/session/graph-ops-service.mjs`

- owns assistant graph reference resolution and attach/promote/archive application so workbench-triggered task-graph mutations do not stay embedded in the manager

`backend/services/session/compaction-service.mjs`

- owns context-compaction queueing, worker-session reuse/creation, auto-compact threshold evaluation, and compaction-result application for detached-run finalization

`backend/controllers/session/post-routes.mjs`

- handles session creation plus POST-based session actions such as message submit, delegate, fork, and persistent-run entrypoints

`backend/controllers/session/patch-routes.mjs`

- handles session metadata/runtime/workflow PATCH updates

`backend/controllers/session/delete-routes.mjs`

- handles permanent session deletion

`backend/controllers/session/read-catalog-routes.mjs`

- handles session list and detail HTTP reads, including archived catalog variants and summary-ref projections

`backend/controllers/session/read-event-routes.mjs`

- handles session event-oriented HTTP reads including visible/all events, source context, immutable event blocks, and event bodies

`backend/services/session/attachment-storage-service.mjs`

- owns attachment file persistence and saved-upload resolution so session orchestration and HTTP intake can share one storage boundary

`backend/session/visibility.mjs`

- owns session exposure and internal-role predicates so orchestration, projections, and invalidation share one visibility policy

`backend/session/invalidation.mjs`

- owns owner-facing session invalidation broadcasts so the session manager does not couple directly to WebSocket client plumbing

`backend/controllers/http/static-routes.mjs`

- handles versioned frontend/static asset lookup and file responses outside the authenticated app flow

`backend/controllers/http/authenticated-routes.mjs`

- coordinates authenticated request dispatch across sessions, runs, workbench, settings, hooks, system routes, and the chat page shell

`backend/controllers/assets/read-routes.mjs`

- handles file-asset HTTP reads including metadata lookup and download redirects

`backend/controllers/assets/write-routes.mjs`

- handles file-asset HTTP mutations including upload-intent creation and finalize writes

`backend/controllers/hooks/read-routes.mjs`

- handles legacy hook alias reads that mirror the canonical settings/hooks surface

`backend/controllers/hooks/write-routes.mjs`

- handles legacy hook alias writes while keeping request validation and alias branching out of the route shim

`backend/controllers/public/auth-routes.mjs`

- handles public auth entrypoints including token login, password login, and logout

`backend/controllers/public/page-routes.mjs`

- handles public page responses such as the login shell and build-info payload

`backend/controllers/run/read-routes.mjs`

- handles run HTTP reads including per-run payload lookup with session access enforcement

`backend/controllers/run/write-routes.mjs`

- handles run HTTP mutations such as cancel, including refreshed-state fallbacks when a cancel races with completion

`backend/controllers/settings/read-routes.mjs`

- handles settings HTTP reads including general, email, voice, hooks, node settings, and the catalog payload

`backend/controllers/settings/write-routes.mjs`

- handles settings HTTP mutations including general/email/voice updates plus hook and node-setting writes

`backend/controllers/system/read-routes.mjs`

- handles system HTTP reads including tools/models, filesystem browsing, uploaded media, push public key, and auth session introspection

`backend/controllers/system/write-routes.mjs`

- handles system HTTP mutations including runtime selection persistence, push subscription writes, and completion sound triggers

`backend/controllers/workbench/read-routes.mjs`

- handles workbench HTTP reads including tracker, task-map, and legacy node-definition aliases

`backend/controllers/workbench/write-routes.mjs`

- handles workbench HTTP mutations and legacy node-definition writes
- keeps request parsing and mutation branching out of the route export shim

`backend/services/system/page-build-service.mjs`

- computes service/frontend build metadata
- caches shell/template file reads
- resolves versioned frontend/static assets
- watches frontend/template changes and broadcasts build invalidation

`backend/services/system/config-reload-service.mjs`

- owns deferred process restart when settings require config reload
- keeps process-management behavior out of route dispatch

`backend/views/system/page-template.mjs`

- projects chat/login HTML template placeholders
- centralizes shell-safe bootstrap JSON serialization

`backend/shared/http/response-cache.mjs`

- provides shared ETag, compression, and cached response writers
- keeps transport-level caching/compression logic out of route dispatch

`backend/shared/http/request-body.mjs`

- centralizes JSON request-body parsing for HTTP controllers
- removes repetitive request parsing from route modules

### Frontend

`templates/chat.html`

- owner-facing chat shell

`frontend-src/frontend.js`

- loader for split frontend assets

`frontend-src/`

- `core/`: bootstrap payloads, app state, i18n/icons, layout, websocket invalidation, gestures, app init
- `session/`: HTTP fetch/update helpers, derived session state, tooling, composer, transcript rendering, and attached session surface
- `session-list/`: task-list contract, ordering contract, grouping model, sidebar list rendering, and sidebar shell behavior
- `settings/hooks/`: hook settings lifecycle model plus browser entry UI
- `settings/email/`: mailbox identity, outbound, and automation settings UI
- `settings/voice/`: local voice-ingress settings UI backed by `runtimeRoot/voice/config.json`
- `workbench/`: task-map contract/model plus focused workbench renderers
- `workbench/controller.js`: workbench-side coordinator that wires graph, surfaces, and node canvas

## AI-Oriented Read Order

Use the smallest entrypoint set that matches the change you want to make.

- session/run behavior: `AGENTS.md`, `backend/session/README.md`, `backend/run/README.md`, `backend/session/manager.mjs`
- persistence or storage layout: `docs/application-storage-architecture.md`, `lib/config.mjs`, `backend/session/meta-store.mjs`, `backend/run/store.mjs`
- routing and HTTP surfaces: `backend/router.mjs`, `backend/routes/`
- hooks and settings: `backend/hooks/README.md`, `backend/settings/README.md`
- workbench/task-map flows: `backend/workbench/index.mjs`, `frontend-src/workbench/`

Do not treat `.melody-sync-runtime/releases/` or `.playwright-cli/` as source-of-truth code. They are runtime snapshots or tool artifacts and should not be hand-edited during normal feature work.

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

- metadata in `sessions/chat-sessions.json`
- event timeline in `sessions/history/<sessionId>/`

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

- `sessions/runs/<runId>/status.json`
- `sessions/runs/<runId>/manifest.json`

## Main Flows

### Boot and load

1. Browser loads `chat.html`.
2. `frontend-src/frontend.js` loads the split frontend.
3. Frontend calls `/api/auth/me`, `/api/tools`, `/api/sessions`, and related owner APIs.
4. WebSocket connects to `/ws`.
5. The selected session is hydrated by HTTP, then kept fresh by invalidation messages.

### Send a message

1. Frontend posts to `/api/sessions/:id/messages`.
2. `backend/session/manager.mjs` records the user event, creates a run, and spawns a detached runner.
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
- owner/bootstrap config such as auth, auth sessions, push config, tool catalog, and runtime selection live in `~/.config/melody-sync`
- if no storage root is configured, MelodySync falls back to the home-local layout (`~/.config/melody-sync`, `~/.melodysync`, and `~/.melodysync/runtime`)
- isolated instances can still override this via `MELODYSYNC_INSTANCE_ROOT`, `MELODYSYNC_CONFIG_DIR`, and `MELODYSYNC_MEMORY_DIR`
- when split layout is active, MelodySync copy-migrates legacy runtime directories still found under the brain root into the runtime root on startup

Vault-backed app root shape:

- `~/.config/melody-sync/` — auth, auth sessions, runtime selection, push config, bootstrap general settings
- `<runtimeRoot>/config/` — app-scoped general settings, provider runtime homes, hook/workbench runtime config
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
- `backend/session/manager.mjs` is still the biggest complexity hotspot.
- Frontend source is now unified under `frontend-src/`, but runtime state is still mostly global-script driven and some shipped surfaces are React-backed alongside vanilla modules.
- Legacy `appId` / `appName` / `userId` / `userName` fields may still appear in stored session metadata, but they are not shipped product systems anymore.
- Workbench and integrations remain valuable, but they should stay layered on the core session/run path rather than drive the primary architecture.

## Where To Read Next

- `../README.md` / `../README.zh.md` for the operator-facing overview
- `current-features.md` for the current shipped feature surface
- `../notes/current/core-domain-contract.md` for the current domain model
- `setup.md` for deployment/setup flow
- `voice/` — local voice-ingress config, event log, pid file, launcher script, and runtime log
