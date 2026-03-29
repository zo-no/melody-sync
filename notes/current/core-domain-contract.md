# Core Domain Contract

This note is the current domain baseline after the public share and visitor model was retired.

## Canonical Objects

### OwnerSession

The primary product object.

- one durable task thread
- owns user-visible conversation history
- owns task metadata such as `group`, `description`, `workflowState`, `workflowPriority`
- may point at source metadata, passive legacy metadata, and fork lineage

### Run

Execution state under a session.

- created per submitted turn or internal operation
- owns transient execution status, provider ids, and runtime bookkeeping
- does not replace session truth

### App

Reusable owner-side template.

- defines tool defaults and startup instructions
- may include welcome text and template context
- is not a public link, access scope, or publishing surface

### User

Owner-managed optional identity preset.

- used for categorization and seeded workflow starts
- scoped inside the owner instance

### ScheduledTrigger

Durable automation record attached to a session.

- schedules owner-side follow-up work
- dispatches back into the normal session/run pipeline

## Non-Objects

These are intentionally not part of the current contract:

- public share links
- read-only share snapshots
- visitor principals
- app-entry auth flows

If older notes mention those concepts, treat them as historical only.

## Core Invariants

1. Session is the durable user-facing thread.
2. Run is the execution attempt inside that thread.
3. Source metadata can label how a session entered the system, but it does not create a separate product surface.
4. All shipped chat surfaces assume owner auth.
5. Forks and delegated tasks create isolated child sessions rather than shared subthreads.

## Session Fields That Matter

- identity: `id`, `name`
- organization: `group`, `description`, `sidebarOrder`, `archived`
- runtime defaults: `tool`, `model`, `effort`, `thinking`
- source metadata: `sourceId`, `sourceName`
- passive legacy metadata: `appId`, `appName`
- identity metadata: `userId`, `userName`
- lifecycle: `created`, `updatedAt`, `activeRunId`
- task structure: `taskCard`, `rootSessionId`, `forkedFromSessionId`, `forkedFromSeq`

Legacy `visitor*` or share-related fields should be treated as stale data, not living product contract.

## Ownership And Access

Current access model is simple:

- one authenticated owner per instance
- all live chat surfaces and session operations are owner-scoped

The product no longer distinguishes between owner and visitor behavior.

## Practical Decision Rule

When deciding where new logic belongs:

- if it changes what the user sees over time, it belongs to `Session`
- if it changes one execution attempt, it belongs to `Run`
- if it changes how new sessions start, it belongs to `App`
- if it changes recurring dispatch, it belongs to `ScheduledTrigger`

## Source Of Truth

Use this note together with:

- `../../docs/project-architecture.md`
- `session-first-workflow-surfaces.md`
- `product-surface-lifecycle.md`
