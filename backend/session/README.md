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
