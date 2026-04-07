# Session History Storage Layout

Status: target physical layout for `sessions/history/<sessionId>/`.

This document translates the value model from `application-storage-architecture.md` into a concrete on-disk shape for session transcript history.

The design goal is simple:

- keep canonical transcript truth
- reduce file fan-out drastically
- keep append-only semantics
- avoid introducing a database
- make reads and migration mechanically simple

## Problem With The Current Shape

Today one session can create:

- one JSON file per event under `events/`
- one TXT file per deferred body under `bodies/`
- plus `meta.json`, `context.json`, and `fork-context.json`

This creates three different kinds of waste:

1. tiny-file overhead
   - too many inodes
   - block waste
   - slower backups and sync

2. duplicated payload storage
   - hidden reasoning and oversized hidden tool/context bodies can create durable payload files without being canonical truth

3. operational complexity
   - thousands of paths must stay consistent even though the logical data is one append-only transcript

The replacement should store the same durable truth in a much smaller number of denser files.

## Design Goals

### 1. One session should usually occupy 4-6 files, not hundreds or thousands

Normal session target:

- `meta.json`
- `context.json`
- `fork-context.json`
- one current event segment
- optional one current blob segment

Large sessions may have multiple closed segments, but growth should be proportional to transcript size, not event count.

### 2. The canonical event stream remains append-only

Committed transcript history stays immutable after write.

No event-in-place mutation.
No one-file-per-event fan-out.

### 3. Full bodies are stored only when they are needed for long-term truth or recoverability

Visible message bodies may deserve a full durable copy.
Some hidden bodies may still need one dense recoverable copy in the capability-first phase.

What the layout must avoid is duplicated full copies spread across many files and layers.

So the dense layout must support:

- inline canonical bodies
- preview-only event payloads
- optional externalized full bodies for large or recoverability-sensitive bodies

### 4. Reads remain simple

The filesystem shape should optimize for these operations:

- append one committed event
- load event tail
- stream full history in order
- load one large externalized body on demand

If a design needs many tiny indexes or complicated random-write behavior, it is wrong for MelodySync.

## Target Per-Session Layout

```text
sessions/history/<sessionId>/
  meta.json
  context.json
  fork-context.json
  segments/
    000001.events.jsonl
    000001.blobs.jsonl      # optional
    000002.events.jsonl
    000002.blobs.jsonl      # optional
```

### File roles

#### `meta.json`

Small canonical control file for the session transcript store.

It should contain:

- `latestSeq`
- `lastEventAt`
- `eventCount`
- `counts`
- active segment ids
- closed segment catalog with seq ranges and byte counts
- optional storage-format version

It should not contain per-event payloads.

#### `context.json`

Unchanged from current role.

Separate file because its lifecycle is not append-only transcript storage.

#### `fork-context.json`

Unchanged from current role.

Also separate because it is low-volume metadata with different write patterns.

#### `segments/<id>.events.jsonl`

Primary append-only transcript segment.

Each line is one normalized committed event.

This file is the dense replacement for today's `events/*.json`.

#### `segments/<id>.blobs.jsonl`

Optional append-only large-body segment.

Used for full recoverable bodies that are too large to inline in `events.jsonl`.

This is the dense replacement for today's `bodies/*.txt`.

If a session never needs large canonical bodies, this file does not exist.

## Event Record Shape

Each event line in `*.events.jsonl` should remain JSON and stay close to today's normalized event contract.

Target shape:

```json
{
  "seq": 128,
  "timestamp": 1760000000000,
  "type": "message",
  "role": "assistant",
  "content": "inline text or preview",
  "bodyMode": "inline",
  "bodyBytes": 412
}
```

Possible `bodyMode` values:

- `inline`
- `external`
- `preview_only`
- `none`

### `inline`

Used when the event body is small and canonical enough to keep directly in the event segment.

Examples:

- normal user messages
- normal assistant messages
- small tool input or output that is not worth separate storage

### `external`

Used when a full recoverable body is too large to inline efficiently.

The event record keeps:

- preview or clipped inline field
- `bodyBytes`
- `bodyRef`

Example:

```json
{
  "seq": 245,
  "type": "message",
  "role": "assistant",
  "content": "Preview text",
  "bodyMode": "external",
  "bodyBytes": 81234,
  "bodyRef": {
    "segment": "000002.blobs.jsonl",
    "key": "evt_245_content"
  }
}
```

### `preview_only`

Used when the full body is not worth durable storage, but a preview is useful in the transcript.

Examples:

- aggressively compacted hidden reasoning
- aggressively compacted hidden `tool_result`
- aggressively compacted hidden `tool_use`
- aggressively compacted hidden `template_context`

The event keeps:

- preview text
- `bodyBytes`
- `bodyTruncated: true`

No full external body is written.

This mode should be optional in the first capability-first rollout, not the default for all hidden bodies.

### `none`

Used when the event type has no meaningful body field.

## Blob Record Shape

Blob segments should also use JSONL to stay debuggable and easy to migrate.

One blob line:

```json
{
  "key": "evt_245_content",
  "seq": 245,
  "field": "content",
  "bytes": 81234,
  "value": "full canonical body text"
}
```

Why JSONL instead of a binary pack:

- easier inspection
- easier migration
- easier corruption recovery
- good enough if segment size is capped

MelodySync does not need a custom binary container yet.

## Segment Rotation

One segment pair should stay bounded.

Suggested defaults:

- rotate event segments around `2k-8k` events or `4-8 MB`
- rotate blob segments around `8-16 MB`

The exact number can be configurable later.

The important rule is:

- no unbounded single-file growth
- no one-file-per-event fallback

Closed segments are immutable.
New writes only go to the active segment pair.

## Write Path

### Append a normal inline event

1. load `meta.json`
2. choose active event segment
3. append one JSON line to `*.events.jsonl`
4. update `meta.json` atomically

### Append an event with external full body

1. write blob line to active `*.blobs.jsonl`
2. append event line with `bodyRef` into active `*.events.jsonl`
3. update `meta.json` atomically

If a crash happens after step 1 but before step 2, the orphan blob is harmless and can be GC'd.

### Append an event with preview-only body

1. compute preview
2. append one event line with `bodyMode=preview_only`
3. update `meta.json`

No blob file write happens.

## Read Path

### Load timeline tail

1. read `meta.json`
2. read tail of active event segment
3. if needed, walk backward into previous closed segments

This is much cheaper than listing thousands of event files.

### Load full history

1. read `meta.json`
2. stream event segments in seq order

No directory-wide per-event stat or path assembly is needed.

### Load one external body

1. load the event line
2. inspect `bodyRef`
3. read the referenced blob segment
4. locate the matching blob record

Because blob segments are bounded, scanning one segment is acceptable.

If later needed, MelodySync can add an in-memory offset cache without changing the on-disk format.

## File Count Target

### Small session

```text
meta.json
context.json
fork-context.json
segments/000001.events.jsonl
```

4 files.

### Session with large visible messages

```text
meta.json
context.json
fork-context.json
segments/000001.events.jsonl
segments/000001.blobs.jsonl
```

5 files.

### Long session with rotated segments

```text
meta.json
context.json
fork-context.json
segments/000001.events.jsonl
segments/000001.blobs.jsonl
segments/000002.events.jsonl
segments/000002.blobs.jsonl
```

Still single-digit file count for substantial history.

That is the right scale. File count should grow by segment, not by event.

## What Not To Store In Blob Segments

The blob segment is not a dumping ground.

Do not write these there by default:

- raw provider payloads
- duplicated copies of bodies already recoverable elsewhere

Blob segments are for large recoverable bodies, not for arbitrary raw spill.

## Compatibility With The Current Product Model

This layout preserves current product concepts:

- append-only committed history
- lazy body hydration
- preview bodies in list/index reads
- separate context and fork-context metadata

What changes is only the physical density and lifecycle behavior.

So the migration can be mostly storage-local, not a redesign of the transcript API.

## Migration Plan

### Phase 1

Stop creating new per-event and per-body files for new sessions.

### Phase 2

Add a reader that can read both:

- legacy `events/*.json` + `bodies/*.txt`
- new segmented history layout

### Phase 3

Ship a one-way migrator:

1. read legacy events in seq order
2. keep one dense recoverable copy for bodies that the current capability policy still needs
3. keep large visible canonical bodies in blob segments
4. emit dense segments
5. optionally introduce preview-only compaction later as a second-stage optimization
6. atomically switch `meta.json` to the new format version

### Phase 4

Garbage-collect legacy per-event directories after successful migration.

## Why This Is The Right Tradeoff

This design stays aligned with MelodySync's character:

- filesystem-first
- debuggable by humans
- append-only where possible
- no mandatory database
- simple crash recovery

At the same time, it fixes the current structural waste:

- fewer files
- denser durable truth
- clearer body-value rules
- better scan behavior
- less metadata duplication

## Bottom Line

The target for `sessions/history/<sessionId>/` is:

- one small metadata file
- two small context files
- one dense append-only event segment
- optional dense blob segment
- rotate by segment, never by event

That is the cleanest way to make MelodySync store more useful transcript truth in fewer files without turning the storage layer into a database project.
