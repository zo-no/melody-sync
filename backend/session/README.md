# Session Backend Map

This directory owns session-facing projections and lightweight domain helpers.

- `naming.mjs`: session naming, grouping, and source label helpers.
- `workflow-state.mjs`: workflow state and priority normalization.
- `agreements.mjs`: active session agreements normalization and prompt block shaping.
- `folder.mjs`: session folder canonicalization and inspection helpers.
- `routing.mjs`: multi-workstream turn routing heuristics.
- `activity.mjs`: derived run/queue/rename/compact activity helpers.
- `api-shapes.mjs`: session list/detail API projections.
- `display-events.mjs`: transcript display-event shaping and block projection.
- `route-utils.mjs`: session route parsing helpers.
- `list-index.mjs`: markdown session index projection.
- `continuation.mjs`: derived continuity and handoff text builders.
- `task-card.mjs`: task-card normalization and compatibility projection helpers.
- `meta-store.mjs`: durable session metadata persistence and index updates.
- `organizer.mjs`: explicit organize-task prompt and result parsing.
- `deletion-journal.mjs`: deletion journaling into the Obsidian vault.
- `run-health.mjs`: run failure inference, detached-run termination synthesis, and context-threshold diagnostics.
- `manager.mjs`: session and run orchestration entrypoint for the session domain.
- `../models/session/queries/session-query.mjs`: session read-side reconciliation, timeline projection, and list/detail queries delegated from the manager.
- `../services/session/event-read-service.mjs`: session event/source-context read orchestration for HTTP controllers.
- `../follow-up-queue.mjs`: follow-up queue serialization, dedupe, and dispatch-text helpers shared by session orchestration.
- `visibility.mjs`: internal-role and exposure predicates for session metadata.
- `invalidation.mjs`: owner WebSocket invalidation broadcasts for session/catalog refreshes.
- `../services/session/attachment-storage-service.mjs`: attachment save/load helpers so HTTP intake and orchestration do not own raw file persistence.
