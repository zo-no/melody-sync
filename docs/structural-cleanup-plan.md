# Structural Cleanup Plan

This document is the execution contract for cleaning up MelodySync in place.

The goal is to reduce maintenance cost and remove stale product residue without changing the shipped runtime shape.

## Guardrails

- Keep the current single-service, single-port runtime centered on `chat-server.mjs`.
- Keep the product session-first.
- Keep HTTP as the canonical state path and WebSocket as invalidation only.
- Prefer low-intrusion refactors over framework rewrites.
- Prefer folder-first decomposition so a human maintainer can locate code by responsibility without reading the whole system first.
- Do not revive App/template/share/visitor/trigger surfaces unless explicitly requested.

## Protected Main Flow

Every cleanup step must preserve this path:

1. owner auth
2. session list load and selection
3. session detail hydration
4. send message with text/files/images
5. detached run execution and history reconciliation
6. refresh/restart recovery

If a change risks this flow, stop and split the work into a safer slice.

## Current Product Boundary

Keep as shipped:

- owner auth
- session CRUD and organization
- message sending, attachments, pasted images, busy follow-up queue, cancel run
- detached runs with durable recovery
- runtime preferences per session
- fork, delegate, continuation
- workbench/task metadata layered on sessions
- integration surfaces that enter through the core session API

Treat as passive compatibility metadata, not product concepts:

- `appId` / `appName`
- `sourceId` / `sourceName`
- `userId` / `userName`

Retire or delete:

- App CRUD and App templates
- User management surfaces
- session-level scheduled triggers
- visitor/share/public-link logic
- stale source/user/settings tab state still hanging off the frontend
- dead compatibility stubs that no longer back a shipped flow
- experimental rewrite scaffolds such as the root `apps/` directory

## Folder Structure Goal

The refactor should not stop at deleting code. The repository layout should become easier for a human contributor to reason about.

Target principle:

- one folder should map to one major responsibility
- core session/run code should be visibly separate from integrations and one-off utilities
- frontend files should be grouped by runtime concern instead of growing as a flat pile
- route entrypoints should be thin and easy to scan

Target backend shape:

```text
backend/
  routes/
    auth.mjs
    sessions.mjs
    runs.mjs
    assets.mjs
    workbench.mjs
    system.mjs
  sessions/
    lifecycle.mjs
    messages.mjs
    history-view.mjs
    fork-delegate.mjs
    naming.mjs
    runtime-preferences.mjs
  runs/
    store.mjs
    supervisor.mjs
    sidecar.mjs
    finalize.mjs
    runtime-monitor.mjs
  workbench/
    store.mjs
    branching.mjs
    summaries.mjs
  integrations/
    github/
    email/
    voice/
  shared/
    api-shapes.mjs
    route-utils.mjs
```

Target frontend shape:

```text
frontend/
  core/
    bootstrap.js
    init.js
    navigation.js
    i18n.js
  sessions/
    catalog.js
    http.js
    list-ui.js
    surface-ui.js
    state-model.js
  realtime/
    socket.js
    render.js
  composer/
    session/compose.js
    attachments.js
  tooling/
    session/tooling.js
    layout.js
  workbench/
    ui.js
    workbench/task-map-model.js
  shared/
    icons.js
    http-helpers.js
```

Transition rule:

- do not reshuffle the whole tree in one step
- first create the target folders
- then move one responsibility at a time behind behavior-preserving imports
- only delete the old flat entrypoints after the new locations are stable

## Phase Plan

### Phase 0: Baseline Freeze

Purpose: create one source of truth before deleting code.

Checklist:

- align canonical docs on the current session-first boundary
- remove experimental rewrite scaffolds from the main repo
- keep unrelated worktree changes untouched
- document protected flows and cut targets in one checklist

Exit criteria:

- current docs agree on what the product is
- cleanup work has a written contract

### Phase 1: Function Pruning

Purpose: delete retired surfaces and dead state without changing core behavior.

Targets:

- frontend stale settings/user/app/source filter state
- retired route families and `410 Gone` shells that no longer need to exist
- obsolete commands and docs for retired features
- direct-upload or other dead request paths

Primary files:

- `templates/chat.html`
- `frontend/core/bootstrap.js`
- `frontend/core/bootstrap-session-catalog.js`
- `frontend/session-list/sidebar-ui.js`
- `frontend/core/i18n.js`
- `backend/router.mjs`
- `backend/compat/apps.mjs`
- `backend/users.mjs`
- `lib/trigger-command.mjs`

Exit criteria:

- no shipped UI depends on retired App/User/Trigger concepts
- session main flow still passes manual smoke checks

### Phase 2: Backend Decomposition

Purpose: split large backend modules by responsibility while preserving API behavior.

Targets:

- create the target `backend/routes/`, `backend/sessions/`, `backend/runs/`, and `backend/workbench/` folders
- split `backend/session-manager.mjs`
- thin `backend/router.mjs` into focused route registrars
- isolate workbench logic behind a narrower facade

Suggested split:

- session metadata and CRUD
- message submission
- run lifecycle and reconciliation
- fork/delegate flows
- session enhancements and naming helpers

Exit criteria:

- no single backend module remains the only place where unrelated responsibilities mix
- route entrypoints stay behavior-compatible
- the backend tree is navigable by responsibility, not by historical accident

### Phase 3: Frontend State Convergence

Purpose: make frontend state explicit and smaller without introducing a new framework.

Canonical frontend state buckets:

- session catalog
- active session snapshot
- run/activity state
- local UI preferences

Rules:

- create grouped frontend folders before moving logic out of the flat `frontend/` root
- `frontend/session/http.js` stays the canonical fetch/update path
- realtime code only invalidates or refreshes
- deleted filters and settings must not linger in globals or translations

Exit criteria:

- frontend state paths are explainable from the four buckets above
- reload/reconnect behavior stays intact
- a maintainer can find session, realtime, composer, and workbench code without guessing filenames

### Phase 4: Peripheral Isolation

Purpose: keep non-core capability while reducing core-path noise.

Targets:

- workbench remains available but no longer drives core chat assumptions
- connector and automation code becomes clearly peripheral
- source metadata remains descriptive, not structural

Exit criteria:

- a new contributor can trace the main session flow without first understanding every connector

### Phase 5: Final Cleanup And Verification

Purpose: remove leftover contradictions and lock the simpler shape in place.

Checklist:

- trim conflicting notes
- update tests around removed surfaces
- add or refresh smoke coverage for the protected main flow
- refresh canonical docs after code settles

Exit criteria:

- docs, tests, and shipped code describe the same product boundary

## Verification Standard

Run after each phase:

- owner login works
- session list loads
- session detail opens
- send message works
- active run state refreshes correctly
- completed runs reconcile into durable history
- browser refresh preserves session state

## Phase 0 Status

Done in the current cleanup pass:

- created this cleanup contract
- aligned current docs away from App/User/Trigger-as-current-object language
- marked the experimental rewrite scaffold for deletion from the main repo

Next:

- prune retired surfaces from the actual code path
- then split large backend files without changing session behavior
