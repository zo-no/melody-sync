# Core Domain Contract

This note is the current domain baseline for the shipped session-first product.

## Canonical Objects

### Session

The primary product object.

- one durable task thread
- owns user-visible conversation history
- owns task metadata such as `group`, `description`, `workflowState`, and `workflowPriority`
- carries runtime defaults and fork lineage
- may include source labels and passive compatibility metadata

### Run

Execution state under a session.

- created per submitted turn or internal operation
- owns transient execution status, provider ids, and runtime bookkeeping
- reconciles back into session history
- does not replace session truth

## Layered Concerns

These matter operationally, but they do not replace the core Session/Run model:

- source metadata such as `sourceId` / `sourceName`
- runtime preferences such as `tool`, `model`, `effort`, `thinking`
- workbench/task metadata layered on a session
- connector-specific metadata needed to route external events into a session

## Non-Objects

These are intentionally not part of the current contract:

- App CRUD and App templates
- User management surfaces
- ScheduledTrigger as a first-class product object
- public share links
- read-only share snapshots
- visitor principals
- app-entry auth flows

If older notes mention those concepts as current product surfaces, treat them as stale.

## Core Invariants

1. `Session` is the durable user-facing thread.
2. `Run` is one execution attempt inside that thread.
3. Source metadata can label how a session entered the system, but it does not create a separate product surface.
4. All shipped chat surfaces assume owner auth.
5. Forks and delegated tasks create isolated child sessions rather than shared subthreads.
6. HTTP is the canonical state path; realtime delivery only signals that the browser should refresh.

## Session Fields That Matter

- identity: `id`, `name`
- organization: `group`, `description`, `sidebarOrder`, `archived`
- runtime defaults: `tool`, `model`, `effort`, `thinking`
- source metadata: `sourceId`, `sourceName`
- passive compatibility metadata: `appId`, `appName`, `userId`, `userName`
- lifecycle: `created`, `updatedAt`, `activeRunId`
- task structure: `taskCard`, `rootSessionId`, `forkedFromSessionId`, `forkedFromSeq`

Legacy `visitor*`, share-related, or template-only fields should be treated as stale data, not living product contract.

## Ownership And Access

Current access model is simple:

- one authenticated owner per instance
- all live chat surfaces and session operations are owner-scoped

The product no longer distinguishes between owner and visitor behavior.

## Practical Decision Rule

When deciding where new logic belongs:

- if it changes what the user sees over time, it belongs to `Session`
- if it changes one execution attempt, it belongs to `Run`
- if it is only descriptive metadata for connectors or compatibility, keep it layered on `Session`
- if it tries to recreate App/User/Trigger product surfaces, it probably does not belong in the current boundary

## Source Of Truth

Use this note together with:

- `../../docs/project-architecture.md`
- `../../docs/current-features.md`
- `../../docs/structural-cleanup-plan.md`
- `session-first-workflow-surfaces.md`
- `product-surface-lifecycle.md`
