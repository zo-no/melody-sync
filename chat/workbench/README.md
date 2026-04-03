# Workbench Backend Map

This directory contains focused workbench backend modules.

Current split:

- `state-store.mjs`: load/save workbench durable state.
- `continuity-store.mjs`: mainline/branch continuity and task-cluster projections.
- `operation-records.mjs`: operation-record projection for the right rail.
- `exporters.mjs`: markdown, summary, obsidian, and other export-oriented output.
- `node-definitions.mjs`: canonical current node-kind exposure for bootstrap and HTTP clients.
- `node-settings-store.mjs`: persisted custom node-kind settings layered on top of the builtin node contract.
- `shared.mjs`: normalization helpers shared across workbench modules.

Boundary rules:

- Keep persistence and projection separate.
- Prefer adding new focused modules here rather than growing `chat/workbench-store.mjs`.
- Keep the current node-kind source of truth in `node-definitions.mjs`; frontend projection reads it through chat bootstrap and `/api/workbench/node-definitions`.
- Keep persisted custom node-kind editing in `node-settings-store.mjs`; do not mix it into task-map projection code.
- Keep task-map projection logic in `static/chat/workbench/task-map-model.js`, not in backend store modules.
