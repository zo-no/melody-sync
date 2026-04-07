# Application Storage Architecture

Status: target contract for MelodySync's app-data storage model.

This document defines what MelodySync should persist, what it should only keep temporarily, and what it should stop storing by default.

The project is intentionally filesystem-first. The goal is not to introduce a database. The goal is to make the filesystem layout obey a clear value model:

- canonical user-visible truth is durable
- resumability state is durable only while it is needed
- projections are rebuildable
- caches and raw captures are bounded
- logs are diagnostic, not archival
- durable storage should maximize useful information per file instead of exploding into many tiny files

## Why this needs to exist

The current system already separates major top-level areas such as `config/`, `sessions/`, `memory/`, `workbench/`, and `logs/`.

The remaining problem is not path discovery. It is storage semantics:

- canonical session truth, run-time raw capture, provider-owned raw session logs, and diagnostics have all tended to accumulate with the same "keep it forever" bias
- some payloads have been duplicated across history, run spool, artifacts, and provider-managed homes
- hidden reasoning and oversized tool payloads have historically consumed durable storage without being product truth

MelodySync needs one shared contract for deciding whether a value is:

1. worth keeping as canonical product data
2. worth keeping temporarily for recovery or debugging
3. worth deriving instead of persisting
4. not worth storing at all

## Core Principles

### 1. Canonical-first

Every durable datum must have exactly one canonical owner.

Examples:

- session catalog truth lives in `sessions/chat-sessions.json`
- canonical transcript truth lives in `sessions/history/<sessionId>/`
- machine memory truth lives in `memory/`
- workflow truth lives in `workbench/`

If the same logical value appears elsewhere, that other copy is a projection, cache, preview, or debug capture.

### 2. Persist for value, not for convenience

MelodySync should only keep full payloads when at least one of these is true:

- the user can directly see or depend on that exact content later
- the content is required to recover an interrupted or active workflow
- the content is an explicit user artifact or export
- the content is a bounded diagnostic trace with an explicit retention policy

If none of those are true, the system should keep a preview, summary, metric, or pointer instead of a full copy.

### 3. Runtime capture is not archive

Raw provider output, spool files, shell snapshots, and API traces are operational capture.

They are useful during execution, reconciliation, failure diagnosis, and short-horizon debugging.

They are not long-term product truth and must never silently become an archive layer.

### 4. Derived views should be rebuildable

If a file can be deterministically rebuilt from canonical truth, it should be treated as a projection.

Typical examples:

- `SESSIONS.md`
- view-oriented summaries
- token or usage summaries derived from raw provider traces
- UI-oriented preview bodies

Derived files may be cached, but they should not be the only copy of important state.

### 5. Retention must be class-based

MelodySync should not rely on a global "delete old files" rule.

Retention must depend on storage class:

- canonical truth: keep until explicit delete/archive
- operational truth: keep while active, then bounded retention
- projections: rebuildable, short retention or on-demand regeneration
- caches: size-bound or TTL-bound
- logs and raw captures: strict TTL and size caps

### 6. Prefer dense files over file fan-out

Too many tiny files are a storage bug even when byte counts look moderate.

They cost:

- filesystem block overhead
- directory scan overhead
- slower backup/sync behavior
- more duplicated metadata than useful payload

So MelodySync should prefer:

- append-only segment files over one-file-per-event when lifecycle matches
- one manifest/index plus dense payload segments over thousands of tiny body files
- stable references and offsets inside a segment over path explosion

The design target is not only "store less text". It is also "store the same durable truth in fewer, denser files".

## Storage Decision Rule

Before persisting a new payload, MelodySync should answer these questions in order:

1. Is this the canonical source of user-visible truth?
2. Is this required to resume or finalize active work after restart?
3. Is this an explicit user artifact that should remain available later?
4. Is this only a projection that can be rebuilt?
5. Is this only a diagnostic capture?

The write result should be one of five classes:

- `canonical`
- `operational`
- `projection`
- `cache`
- `diagnostic`

If a payload does not cleanly fit one of those classes, MelodySync should not persist it until the ownership is clarified.

## Storage Classes

| Class | Meaning | Examples | Default retention |
| --- | --- | --- | --- |
| `canonical` | Product truth the user would consider "their data" | session catalog, transcript history, memory, user-authored artifacts, durable workbench state | indefinite until explicit delete/archive |
| `operational` | Truth needed to finish or recover active work | active run manifest/status/result, queue state, provider resume ids | keep while active; bounded after finalization |
| `projection` | Rebuildable materialized view | `SESSIONS.md`, previews, summaries, denormalized indexes | rebuild or short TTL |
| `cache` | Re-fetchable or re-computable acceleration layer | file asset cache, download cache, thumbnail cache | size/TTL bounded |
| `diagnostic` | Debug-only traces and logs | API logs, provider raw sessions, shell snapshots, raw spool payload mirrors | strict TTL and size caps |

## Current App Root, Interpreted By Value

The current top-level layout is already workable. The missing piece is value classification.

### `config/`

Use for small operator and system configuration truth only.

Good fits:

- auth and session cookies
- general settings
- runtime selection defaults
- push and connector configuration

Bad fits:

- large logs
- raw provider transcripts
- session event bodies
- long-lived runtime capture

`config/` should stay small, reviewable, and mostly JSON metadata.

### `memory/`

This is canonical user-level machine memory.

Persist here:

- bootstrap pointers
- stable local collaboration rules
- reusable project pointers
- durable task notes worth reopening later

Do not use `memory/` for runtime spill, temporary debugging notes, or duplicated session history.

### `sessions/`

This is the main product data domain and should be interpreted in sublayers.

#### `sessions/chat-sessions.json`

Canonical session catalog truth.

Keep durable:

- session metadata
- grouping and archive flags
- workflow/task card metadata
- queue pointers
- provider resume ids when still relevant

Do not stuff per-turn payloads or raw execution traces here.

#### `sessions/history/<sessionId>/`

Canonical transcript truth.

This is where MelodySync should keep the normalized event stream that represents the conversation and its durable machine-readable context.

For the target physical layout that reduces file fan-out, also read `session-history-storage-layout.md`.

Rules:

- visible user/assistant messages are worth storing in full
- hidden reasoning is not canonical truth, so the main history view should stay preview-oriented even if the full body remains recoverable from dense externalized storage
- oversized hidden tool input/output or template context should not create duplicate long-form copies across multiple surfaces; one recoverable dense copy is acceptable when ability requires it
- provider raw JSON should never be mirrored here wholesale; only normalized salient events belong here

This directory is append-only truth, not a dump of every transient runtime payload.

#### `sessions/runs/<runId>/`

Run storage must be split conceptually into two layers even if the current filesystem shape remains the same.

Control plane:

- `manifest.json`
- `status.json`
- `result.json`

Capture plane:

- `spool.jsonl`
- `artifacts/`

Rules:

- while a run is active, both control and capture layers may be needed
- once a run is finalized into canonical session history, the capture layer is no longer product truth
- after finalization, control-plane files are useful only for short-horizon audit and debugging unless some explicit recovery requirement still depends on them
- storage policy should therefore keep finalized run control files for bounded retention and aggressively age out capture files

The run directory is operational state, not long-term history.

#### `sessions/images/` and `sessions/file-assets/`

These are user-visible artifacts, not debug spill.

They become canonical only when referenced by canonical session/workbench state or by an explicit export.

Needed policy:

- reachable assets are durable
- unreferenced temporary assets are GC candidates
- generated previews belong in cache, not beside canonical originals

#### `sessions/file-assets-cache/`

Pure cache. Never treat it as truth.

Use size caps and TTL.

### `workbench/`

Workbench storage is canonical when it represents durable user workflow state.

Examples:

- nodes
- branch contexts
- task-map plans
- node settings

But generated summaries and presentation-oriented projections should be treated as projections unless they are explicitly user-authored.

Workbench should follow the same rule as sessions: one canonical durable model, plus rebuildable projections.

### `hooks/`, `email/`, `voice/`

These directories currently mix small durable config with runtime traces.

Target rule:

- config JSON remains canonical
- runtime pid files, logs, transient events, and launch artifacts are operational or diagnostic
- runtime event logs should not accumulate indefinitely beside canonical config

Over time, MelodySync should move transient voice and connector traces toward `logs/` or another bounded runtime surface.

### `logs/`

Logs are diagnostic only.

They should be:

- time-bounded
- size-bounded
- rotation-friendly
- safe to delete without changing product truth

`logs/` must never contain the only copy of meaningful user state.

### `config/provider-runtime-homes/`

Treat provider-managed homes as isolated runtime sandboxes, not as MelodySync's application data store.

Rules:

- keep only the minimum needed to run the provider in a managed environment
- never rely on provider raw session files as MelodySync truth
- if a provider emits raw sessions, shell snapshots, or other traces, treat them as diagnostic capture with short retention
- auth linkage is configuration; raw provider traces are not

The right long-term product state from provider runs is:

- normalized history events
- bounded run operational state
- provider resume ids
- summarized usage or metrics when needed

Not the provider's own full raw transcript archive.

## What Is Worth Saving

The following are worth saving durably by default:

- user-authored or assistant-authored visible messages
- machine memory files that encode durable collaboration knowledge
- workflow state the user expects to resume later
- explicit uploaded/generated assets that remain referenced
- minimal run metadata required for active recovery

The following should not be saved durably in duplicated full form by default:

- hidden reasoning traces mirrored across multiple durable surfaces
- raw provider JSONL transcripts
- oversized hidden tool input/output mirrors
- duplicated long-form spool lines when structured JSON is already available
- API request/response traces beyond bounded diagnostics
- transient shell snapshots

For these, MelodySync should store one of:

- preview
- size/count metadata
- normalized event
- usage summary
- explicit opt-in archive

## Write-Time Rules

### Rule 1: normalize before persisting

Persist normalized events and value-oriented fields, not raw provider protocol objects, unless a bounded diagnostic layer explicitly owns that raw capture.

### Rule 2: store large text once

If a large payload must be durable, keep exactly one full canonical copy.

Any other surface should keep only:

- preview text
- byte count
- stable reference

### Rule 3: hidden does not imply valuable

Hidden event types are often useful for operator context and UI thought blocks, but that does not make them canonical.

By default:

- visible message content is durable
- hidden reasoning should stay preview-first in the main history view
- hidden tool/context bodies should not create redundant full copies across history, run capture, and provider capture

In the current capability-first phase, full recoverability may still be preserved through one externalized dense copy until compaction and retention contracts are tightened further.

### Rule 4: provider isolation must not create a second archive

Managed provider homes may contain provider-owned state for execution, but MelodySync should not silently convert that into a second transcript archive.

### Rule 5: every non-canonical write needs an expiry story

If a new file is not canonical truth, the code that writes it should also define:

- TTL
- size budget
- cleanup trigger
- safe delete condition

## Read-Time Rules

### Read canonical truth first

For any user-facing view, MelodySync should prefer:

1. session catalog
2. canonical history
3. durable workflow state

Only then should it consult operational or diagnostic layers.

### Operational layers should enrich, not redefine, truth

Examples:

- active run spool may project an in-flight turn
- provider usage summaries may enrich a run with context-token data
- diagnostics may explain failure

But these should not replace the durable transcript as the primary source of completed session truth.

## Retention Policy

MelodySync should eventually ship explicit defaults per storage class.

Recommended direction:

- canonical session/memory/workflow truth: no automatic deletion
- finalized run control plane: keep for a medium retention window
- run capture plane: keep short
- provider raw sessions and shell snapshots: keep very short
- diagnostic logs: rotate daily, delete aggressively
- caches: bound by total size and recency
- unreferenced temporary assets: delete by reachability plus age

The exact numbers can remain configurable, but the class boundaries should not.

## Lifecycle Model

### Session data

1. write normalized canonical event
2. attach previews or external bodies only when the event class truly needs them
3. keep projections rebuildable

### Run data

1. create run control state
2. capture raw spool only while execution/finalization needs it
3. materialize final normalized events into canonical history
4. downgrade run files from active operational truth to bounded post-finalization debug state
5. clean capture files on retention

### Provider runtime data

1. use isolated managed home for execution
2. copy or link only minimal config/auth into that home
3. treat emitted raw provider traces as debug capture
4. summarize the value MelodySync actually needs back into its own truth model
5. prune provider-home traces independently of session truth

## Migration Direction

This design does not require an immediate directory rewrite.

The recommended rollout is:

1. introduce a storage-class registry in code and documentation
2. keep current paths, but classify every writer as canonical, operational, projection, cache, or diagnostic
3. stop full-fidelity persistence for hidden and duplicated payloads
4. reduce file fan-out by moving same-lifecycle tiny files toward segmented storage where practical
5. split run retention into control-plane retention and capture-plane retention
6. bound provider-runtime-home raw capture
7. add reachability-aware asset GC
8. add explicit archive/export flows for users who truly want long-term raw capture

## Immediate Implications For Current Code

The following modules are on the critical path for this contract:

- `lib/config.mjs`
- `backend/history.mjs`
- `backend/runs.mjs`
- `backend/session-manager.mjs`
- `backend/runtime-policy.mjs`
- `backend/api-request-log.mjs`
- `lib/storage-maintenance.mjs`

The design target is:

- `history.mjs` owns canonical transcript persistence
- `runs.mjs` owns active operational run state and bounded capture
- `runtime-policy.mjs` owns provider-home isolation, not durable product storage
- `storage-maintenance.mjs` enforces retention for non-canonical classes

## Bottom Line

MelodySync should persist data according to value:

- keep canonical user and workflow truth
- keep operational recovery state only while it has operational value
- regenerate projections
- bound caches
- aggressively expire diagnostics and provider raw capture

If a payload is not user truth, not required for restart-safe recovery, and not part of an explicit archive, MelodySync should not keep the full copy by default.
