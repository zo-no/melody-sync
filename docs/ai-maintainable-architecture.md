# AI-Maintainable Architecture Proposal

This note proposes a target architecture for MelodySync that keeps the current product shape but reduces the amount of repo-specific rediscovery future AI agents need to do before making safe changes.

## Why this exists

The current repo ships useful behavior, but several maintenance costs are higher than they need to be:

- product naming and runtime defaults still drift between `MelodySync` and `MelodySync`
- a few large files carry too many responsibilities
- several background behaviors are implicit side effects of session completion
- frontend behavior depends on ordered global scripts instead of explicit module contracts
- project-specific workflow logic lives inside shipped core modules

The result is a codebase that works, but is expensive for both humans and AI agents to modify safely.

## Design goals

- keep the product centered on `Principal -> App -> Session -> Run -> ShareSnapshot`
- preserve the single-owner, filesystem-first deployment model
- keep the frontend lightweight and framework-free if desired
- make background work explicit and observable
- reduce cross-feature coupling so a model can work in one slice without loading the whole repo
- make naming, config, ports, and data roots come from one canonical source

## Main problems to fix

### 1. Canonical identity is not actually canonical

The repo still mixes old and new identity:

- docs and notes still refer to `MelodySync`
- some docs still describe port `7690`
- runtime code defaults to `7760`
- runtime config now defaults cleanly to `~/.config/melody-sync`

This makes setup, debugging, and automated edits ambiguous.

### 2. Core lifecycle logic is concentrated in god modules

The main chat lifecycle is spread across large files that each carry multiple domains:

- `backend/session-manager.mjs`
- `backend/router.mjs`
- `backend/workbench/index.mjs`

This raises blast radius. A small change to one feature often requires understanding session state, run orchestration, persistence, background suggestions, and UI contracts at the same time.

### 3. Async follow-up work is implicit

Label generation, workflow-state suggestion, auto-compaction, completion push, and reply self-check are triggered from session-run completion rather than represented as explicit job records.

That makes behavior harder to reason about, retry, test, and disable.

### 4. Frontend contracts are order-dependent

The main chat page loads many scripts in sequence and relies on globals on `window`.

That keeps the build simple, but it also hides dependency boundaries and makes safe refactors harder.

### 5. Product core and operator-specific workflow are mixed

Workbench and local workflow code currently mixes:

- durable product concepts
- branch/task orchestration
- personal knowledge-management assumptions
- file export helpers

These should not all live in the same core domain layer.

## Framework options

There are several credible ways to improve maintainability, but they do not all have the same risk profile.

### Option A: Keep the current stack, but enforce stronger boundaries

What changes:

- split route modules and service modules
- introduce explicit job handling
- move frontend code to ES module boundaries
- canonicalize config and naming

Pros:

- lowest migration risk
- preserves current deployment shape
- avoids a large rewrite before domain boundaries are cleaned up
- easiest path to no-behavior-change refactors

Cons:

- still leaves some framework conveniences on the table
- requires discipline because the architecture is enforced by repo structure, not a framework

### Option B: Add a lightweight backend framework only

Candidates:

- Fastify
- Hono

What changes:

- move HTTP routing, request parsing, and response shaping onto a mature router/plugin model
- keep the domain, runtime, storage, and frontend largely intact

Pros:

- good fit if the biggest pain is route sprawl and request handling
- better plugin boundaries, middleware composition, and schema-driven handlers
- lower risk than a full-stack rewrite

Cons:

- still requires a route migration pass
- does not solve core domain coupling by itself
- introduces framework conventions without removing existing domain debt automatically

Recommended stance:

- this is the only framework adoption path worth considering in the near term
- if adopted, do it after route and service boundaries are already cleaner

### Option C: Adopt a full backend framework

Candidates:

- NestJS
- AdonisJS

Pros:

- strong structure, DI, modules, testing patterns

Cons:

- high migration cost
- lots of ceremony relative to the current product shape
- likely to slow down local, single-owner iteration unless the team is already committed to that style
- does not map cleanly onto the current filesystem-first, low-dependency character of the project

Recommendation:

- not worth it for this repo right now

### Option D: Adopt a frontend framework

Candidates:

- React
- Vue
- Svelte

Pros:

- stronger component boundaries
- easier state-driven rendering over time

Cons:

- forces a build pipeline and larger deployment surface
- high churn for a UI that already ships as a no-build mobile-friendly surface
- risks mixing a frontend rewrite with unfinished domain refactoring

Recommendation:

- avoid this as the first maintainability move

### Option E: No major framework, but add mature supporting libraries

Useful additions:

- schema validation for request payloads
- a structured logger
- a tiny durable job queue abstraction
- a consistent test harness for HTTP route modules

This can deliver much of the maintainability gain without forcing a platform rewrite.

## Recommendation

The best no-behavior-change path is:

1. keep the current stack for now
2. finish the domain and route boundary cleanup
3. optionally adopt a lightweight backend framework later if the HTTP layer still feels expensive
4. avoid a frontend framework or full backend framework until the product boundaries are already stable

## Proposed target architecture

Keep one deployable service, but split the code by domain and responsibility.

```text
melody-sync/
├── server/
│   ├── http/
│   │   ├── app.mjs
│   │   ├── middleware/
│   │   ├── routes/
│   │   │   ├── auth-routes.mjs
│   │   │   ├── session-routes.mjs
│   │   │   ├── run-routes.mjs
│   │   │   ├── app-routes.mjs
│   │   │   ├── workbench-routes.mjs
│   │   │   └── asset-routes.mjs
│   │   └── presenters/
│   └── realtime/
│       └── ws-invalidation.mjs
├── domain/
│   ├── auth/
│   ├── principals/
│   ├── apps/
│   ├── sessions/
│   ├── runs/
│   ├── shares/
│   ├── workbench/
│   └── jobs/
├── services/
│   ├── session-service.mjs
│   ├── run-service.mjs
│   ├── workbench-service.mjs
│   ├── share-service.mjs
│   └── job-dispatcher.mjs
├── integrations/
│   ├── tools/
│   ├── voice/
│   ├── github/
│   └── mail/
├── infra/
│   ├── config/
│   ├── store/
│   ├── files/
│   ├── process/
│   └── logging/
├── ui/
│   ├── bootstrap/
│   ├── features/
│   │   ├── sessions/
│   │   ├── composer/
│   │   ├── workbench/
│   │   ├── settings/
│   │   └── realtime/
│   └── shared/
└── docs/
```

## Domain boundaries

### Auth and principal

Responsible for:

- token and password auth
- owner or visitor principal resolution
- session cookie issuance

Not responsible for:

- session loading
- app lookup
- route-specific business logic

### Sessions

Responsible for:

- durable thread identity
- message append rules
- archive and presentation metadata
- session-level continuity metadata

Not responsible for:

- how a tool process is spawned
- post-run background suggestions
- workbench projection storage

### Runs

Responsible for:

- creating a run attempt
- tracking state transitions
- storing spool and result files
- resuming or cancelling execution

Not responsible for:

- direct HTTP response shaping
- session naming
- workflow suggestions

### Jobs

Introduce a first-class `Job` record for follow-up work.

Examples:

- `session_label_suggestion`
- `session_workflow_suggestion`
- `reply_self_check`
- `auto_compaction`
- `push_completion`

Every background task should have:

- `id`
- `type`
- `subjectType`
- `subjectId`
- `status`
- `attempts`
- `payload`
- `lastError`
- `scheduledAt`
- `startedAt`
- `finishedAt`

This makes background behavior inspectable, retryable, and testable.

### Workbench

Treat workbench as a separate bounded context, not an extension of session manager.

It can depend on session APIs, but it should own its own:

- capture model
- project model
- node model
- branch context model
- summary projection model

Any operator-specific export targets, such as local knowledge-base output, should live behind explicit adapters rather than hardcoded paths in the domain layer.

## Frontend target

Keep vanilla JS, but move from global ordered scripts to explicit ES module boundaries.

Suggested shape:

- one bootstrap entry
- one shared state container for HTTP-derived state
- feature modules that register themselves against the shared container
- one DOM binding layer per feature
- no feature should reach into another feature's private DOM or globals

The goal is not a framework rewrite. The goal is explicit import boundaries.

## Configuration rules

Create one canonical config module and one migration module.

Rules:

- one brand name only in shipped docs and runtime
- one canonical default port only
- one canonical config root only
- legacy paths are migration inputs, not active defaults forever
- startup should log the chosen identity and data roots once

Suggested approach:

- `infra/config/runtime-config.mjs` resolves canonical values
- `infra/config/migrate-legacy-config.mjs` imports old data once
- after migration, runtime reads only the new root

## Testing rules

The current tests already cover a lot, but the architecture should make test scope narrower.

Add test layers:

- unit tests for pure domain logic
- service tests for session or run orchestration with fake stores
- route tests for HTTP contracts only
- integration tests for end-to-end flows
- explicit job-runner tests for background behavior

Important rule:

- teardown must fully stop spawned processes, file watchers, timers, and job loops before temp directories are removed

## Migration plan

### Phase 0: Canonical cleanup

- pick one brand name
- pick one port
- pick one config root
- mark legacy names and paths as migration-only

### Phase 1: Extract stable seams

- split `backend/router.mjs` into route modules
- split `backend/session-manager.mjs` into session service, run service, and job triggers
- move workbench storage behind its own service

### Phase 2: Introduce the job system

- represent all post-run async behavior as explicit jobs
- add a small durable job queue
- make startup rehydrate pending jobs cleanly

### Phase 3: Frontend contract hardening

- replace implicit globals with imported modules
- reduce direct DOM coupling
- define one boot payload contract

### Phase 4: Integration isolation

- move voice, mail, GitHub, and similar helpers under `integrations/`
- keep shipped core independent from operator-specific adapters

## What this buys AI maintenance

- smaller files with clearer ownership
- fewer hidden side effects
- easier prompt scoping for future agents
- less need to read unrelated code before making a safe change
- better chances that tests fail in the module being changed, not somewhere downstream

## Non-goals

- no mandatory framework rewrite
- no database migration unless filesystem persistence becomes a real bottleneck
- no change to the single-owner deployment model
- no attempt to remove the existing product concepts that already fit the shipped system

## Practical next step

If this proposal is used as the refactor baseline, the first concrete implementation pass should be:

1. canonicalize naming, port, and config root
2. extract route modules from `backend/router.mjs`
3. extract a `job-dispatcher` from `backend/session-manager.mjs`
4. move workbench-specific state and exports behind a dedicated service boundary
