# Backend Map

This directory holds the owner-facing backend for MelodySync.

Read this first:

- `ARCHITECTURE.md`: target backend structure, migration constraints, and canonical layer boundaries.

Use this map before editing:

- `entry/`: backend runtime and auth entry implementations. Root `chat-server.mjs`, `generate-token.mjs`, and `set-password.mjs` are now thin launch shims only.
- `router.mjs`: top-level HTTP composition only. Keep routing thin.
- `routes/`: request/response adapters. Route files should not grow durable state logic.
- `settings/`: canonical settings-domain adapters that shape owner-facing `general`, `email`, `voice`, `hooks`, and `nodes` payloads for the shared settings overlay.
- `session/manager.mjs`: session and run orchestration. Prefer extracting helpers instead of adding more inline lifecycle branches.
- `services/session/creation-service.mjs`, `services/session/deletion-service.mjs`, `services/session/prompt-service.mjs`, `services/session/fork-context-service.mjs`, `services/session/branching-service.mjs`, `services/session/metadata-service.mjs`, `services/session/task-card-service.mjs`, `services/session/workflow-runtime-service.mjs`, `services/session/message-submission-service.mjs`, `services/session/follow-up-queue-service.mjs`, `services/session/organizer-service.mjs`, `services/session/result-asset-publication-service.mjs`, `services/session/graph-ops-service.mjs`, `services/session/compaction-service.mjs`, `services/session/detached-run-sync-service.mjs`, `services/session/detached-run-observer-service.mjs`, `services/session/persistent-service.mjs`: extracted session orchestration helpers for create/reuse, permanent deletion cleanup, prompt shaping, prepared fork context, fork/delegate flows, pure metadata mutations, task-card stabilization plus branch-candidate closeout shaping, workflow/runtime preference updates, message-submit/run-start orchestration, queued follow-up dispatch/runtime cleanup, organizer closeout/auto-labeling, result-asset publishing, assistant graph apply flows, compaction queue/finalization flows, detached-run spool/result reconciliation, detached-run observer/startup restore orchestration, and persistent-session lifecycle flows.
- `result-assets.mjs`: result-file discovery and attachment publishing helpers used by run finalization and follow-up flows.
- `history.mjs`, `run/store.mjs`, `session/meta-store.mjs`: durable truth for session events, run manifests, and session metadata.
- `controllers/run/`, `services/run/`, `models/run/`, `runtime/run/`, `runtime/providers/`: canonical run-module migration targets. `run/`, `routes/runs.mjs`, `adapters/`, `process-runner.mjs`, and `provider-runtime-monitor.mjs` remain compatibility surfaces during migration.
- `hooks/contract/`: lifecycle scope and event definitions.
- `hooks/runtime/`: hook registry, settings persistence, and builtin registration wiring.
- `hooks/index.mjs`: canonical hook entry surface for bootstrap/runtime callers.
- `hooks/`: builtin metadata, focused handlers, and compatibility export surfaces.
- `workbench/`: workbench persistence helpers, node settings, and read-side projections.
- `workbench/index.mjs`: canonical workbench entry for continuity and branch orchestration layered on focused `workbench/` modules.

Edit rules:

- Preserve external behavior during refactors: routes, WS event names, payload shapes, persistence formats, settings keys, and root entry names should stay stable unless explicitly approved.
- If a change is about durable truth, start from `session/meta-store.mjs`, `history.mjs`, `run/store.mjs`, or `workbench/`.
- If a change is about lifecycle side effects, start from `hooks/` instead of inlining behavior into `session/manager.mjs`.
- If a change is about HTTP shape only, keep it inside `routes/`.
- When in doubt about placement, prefer the target structure in `ARCHITECTURE.md`: controllers -> services -> models -> views, with runtime, contracts, and shared kept explicit.
