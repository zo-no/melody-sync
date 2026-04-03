# Workbench Backend Map

This directory contains focused workbench backend modules.

Current split:

- `state-store.mjs`: load/save workbench durable state.
- `continuity-store.mjs`: mainline/branch continuity and task-cluster projections.
- `operation-records.mjs`: operation-record projection for the right rail.
- `exporters.mjs`: markdown, summary, obsidian, and other export-oriented output.
- `shared.mjs`: normalization helpers shared across workbench modules.

Boundary rules:

- Keep persistence and projection separate.
- Prefer adding new focused modules here rather than growing `chat/workbench-store.mjs`.
- Frontend node kinds and task-map projection are not defined here. Those contracts stay in `static/chat/workbench/node-contract.js` and `static/chat/workbench/task-map-model.js`.
