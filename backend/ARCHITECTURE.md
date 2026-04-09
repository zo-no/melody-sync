# Backend Architecture Blueprint

This document defines the target backend architecture for MelodySync.

The goal is a behavior-preserving rearchitecture:

- keep external behavior stable
- improve internal boundaries
- make modules easier to read, change, and parallelize

This is not a feature rewrite.

## Frozen external behavior

During the migration, the following must remain stable unless explicitly approved:

- HTTP route paths
- WebSocket event names
- API payload shapes
- session/run persistence formats
- settings keys and owner-facing settings payloads
- root launch shims and script entry names
- provider selection semantics

Internal file layout, service boundaries, and orchestration structure may change.

## Target top-level structure

```text
backend/
  entry/
  controllers/
    auth/
    assets/
    hooks/
    run/
    session/
    settings/
    system/
    workbench/
  services/
    hooks/
    run/
    session/
    settings/
    workbench/
  models/
    hooks/
      state/
    run/
      queries/
      state/
      stores/
    session/
      queries/
      state/
      stores/
    settings/
      stores/
    workbench/
      queries/
      state/
      stores/
  views/
    hooks/
    run/
    session/
    settings/
    workbench/
  runtime/
    providers/
    run/
    session/
  contracts/
    hooks/
    run/
    session/
    settings/
    workbench/
  shared/
    assets/
    fs/
    logging/
    notifications/
    utils/
```

## Layer responsibilities

### `entry/`

Process startup only.

- server bootstrap
- auth/token entrypoints
- root shims delegate here

No business rules.

### `controllers/`

Transport adapters only.

- parse request input
- call services
- return HTTP/WS responses

Controllers must not:

- read stores directly
- assemble domain trees
- call providers directly

### `services/`

Use-case orchestration.

Services are the main brain of the system.

They:

- coordinate queries and stores
- assemble domain trees
- invoke runtime side effects
- request projections from views

They do not own durable truth.

### `models/`

Durable truth and read models.

#### `stores/`

- persistence
- file read/write
- durable record mutation

#### `queries/`

- read-side access
- shaped domain reads
- no transport formatting

#### `state/`

- normalization
- domain rules
- entity/state helpers

Models do not return transport payloads.

### `views/`

Projection only.

In MelodySync, backend views are not HTML templates. They are:

- API payload projections
- display event projections
- surface and node payload projections

Views turn domain results into outward-facing shapes.

### `runtime/`

Execution mechanisms.

- sidecar
- process supervision
- prompt runtime
- session compaction
- persistent scheduling
- provider adapters

Runtime executes technical work. It does not decide product behavior.

### `contracts/`

Stable module boundaries.

- API contracts
- node kind contracts
- hook contracts
- run result contracts

### `shared/`

Generic infrastructure used by multiple modules.

- fs helpers
- asset helpers
- logging
- push/notifications
- generic utilities

Shared must stay generic. Domain-specific helpers do not belong here.

## Canonical request flow

The default backend flow is:

1. controller receives input
2. service orchestrates the use case
3. model query/store loads durable truth
4. service assembles the domain tree
5. view projects the outward-facing shape
6. controller returns the response

For side effects:

1. service decides whether work should happen
2. runtime/provider executes the technical operation
3. service merges the result back into the domain flow

## Fetching vs tree building vs projection

These responsibilities must stay separate.

### Fetching

Belongs in:

- `models/<feature>/queries/`
- `models/<feature>/stores/`

This layer reads raw truth.

### Domain tree building

Belongs in:

- `services/<feature>/`

This layer assembles business structure:

- session continuity trees
- workbench task graphs
- branch/mainline relationships

### Projection tree building

Belongs in:

- `views/<feature>/`

This layer converts domain structures into:

- list payloads
- detail payloads
- display events
- workbench surface payloads

## Feature modules

### `session`

Core session lifecycle and durable truth.

Owns:

- session metadata
- history
- naming/routing
- continuation
- task card state
- workflow state
- session-facing display projections

### `workbench`

Task graph and branch/workbench behavior.

Owns:

- graph model
- plans
- continuity records
- branch lifecycle
- surface projection
- node/task-card sync

### `run`

Execution and run result lifecycle.

Owns:

- run manifests
- run dispatch/finalization/health
- sidecar/supervision
- provider result envelopes

### `settings`

Owner-facing configuration adapter module.

Owns:

- general/email/voice/hooks/nodes settings payload shaping
- settings persistence adapters

It does not own other modules' business truth.

### `hooks`

Lifecycle orchestration module.

Owns:

- hook contracts
- hook registry/runtime wiring
- builtin hook orchestration

It does not own session or workbench durable truth.

## Model invocation boundary

Calling Codex, Claude, or any other model is split across two layers:

- `services/*`: decide whether and how to call a model
- `runtime/providers/*`: execute the actual provider call

That means:

- controllers do not call models
- models do not call models
- views do not call models

## Current file families and target homes

This is the migration intent for the current backend layout.

### Transport and entry

- `backend/entry/*` -> keep under `entry/`
- `backend/routes/*` -> move under `controllers/<feature>/`
- `backend/router.mjs` -> thin controller composition entry
- `backend/ws.mjs`, `backend/ws-clients.mjs`, `backend/middleware.mjs` -> transport/controller support

### Session

- `backend/session/*` -> split across `services/session/`, `models/session/`, `views/session/`, `contracts/session/`
- `backend/history.mjs` -> `models/session/stores/`
- `backend/session-runtime/*` -> `runtime/session/`
- `backend/session-prompt/*` -> `runtime/session/`
- `backend/session-persistent/*` -> `runtime/session/`
- `backend/session-source/*` -> `models/session/state/` or `contracts/session/` depending on final semantics

### Workbench

- `backend/workbench/*` -> split across `services/workbench/`, `models/workbench/`, `views/workbench/`, `contracts/workbench/`

### Run and providers

- `backend/run/*` -> split across `services/run/`, `models/run/`, `runtime/run/`, `contracts/run/`
- `backend/adapters/*` -> `runtime/providers/`
- `backend/process-runner.mjs` -> `runtime/run/`
- `backend/provider-runtime-monitor.mjs` -> `runtime/providers/`
- `backend/codex-session-metrics.mjs` -> `runtime/providers/` or `shared/logging/` depending on final use

### Settings and hooks

- `backend/settings/*` -> split across `controllers/settings/`, `services/settings/`, `models/settings/`, `views/settings/`, `contracts/settings/`
- `backend/hooks/*` -> split across `controllers/hooks/`, `services/hooks/`, `models/hooks/`, `runtime/hooks/`, `contracts/hooks/`

### Shared infrastructure

- `backend/fs-utils.mjs` -> `shared/fs/`
- `backend/file-assets.mjs`, `backend/result-assets.mjs`, `backend/attachment-utils.mjs` -> `shared/assets/`
- `backend/api-request-log.mjs` -> `shared/logging/`
- `backend/push.mjs`, `backend/completion-sound.mjs`, `backend/completion-speech-queue.mjs`, `backend/xfyun-completion-tts.mjs` -> `shared/notifications/`
- `backend/models.mjs`, `backend/normalizer.mjs`, `backend/ui-language.mjs` -> `shared/utils/` unless later absorbed by a feature module

## Migration order

Use this order to preserve behavior while improving structure:

1. Freeze external contracts
2. Extract projections into `views/`
3. Split stores/queries/state inside `models/`
4. Move orchestration into `services/`
5. Isolate runtime/provider execution in `runtime/`
6. Thin out `router.mjs` and the remaining large orchestrators

## Large-file reduction targets

These are the primary refactor pressure points:

- `backend/router.mjs`
- `backend/session/manager.mjs`

Both should end as thin orchestration/composition files, not durable logic sinks.

## Definition of done

The architecture migration is successful when:

- the frozen external behavior still matches
- features are readable without scanning the entire backend root
- stores, tree builders, and projections are no longer mixed together
- model invocation boundaries are explicit
- `router.mjs` and `session/manager.mjs` are no longer catch-all files
