# Workbench Backend Map

This directory contains focused workbench backend modules.

Current split:

- `state-store.mjs`: load/save workbench durable state.
- `continuity-store.mjs`: mainline/branch continuity and task-cluster projections.
- `operation-records.mjs`: operation-record projection for the right rail.
- `exporters.mjs`: markdown, summary, obsidian, and other export-oriented output.
- `node-definitions.mjs`: canonical current node-kind exposure for bootstrap and HTTP clients, including composition metadata such as capabilities, surface bindings, and default right-canvas view types.
- `node-settings-store.mjs`: persisted custom node-kind settings layered on top of the builtin node contract, including future-facing composition metadata.
- `task-map-plan-contract.mjs`: machine-readable contract for future hook/AI graph planning, including plan-capable hooks, node kinds, source types, right-canvas view types, and fallback behavior.
- `task-map-plans.mjs`: persisted optional task-map plan overlays that can replace or augment the default continuity projection; plan nodes can declare rich right-canvas views.
- `task-map-plan-producers.mjs`: focused workflow-to-plan producers; currently used by `builtin.branch-candidates` to write candidate-node overlays from hook lifecycle state.
- `shared.mjs`: normalization helpers shared across workbench modules.

Boundary rules:

- Keep persistence and projection separate.
- Prefer adding new focused modules here rather than growing `chat/workbench-store.mjs`.
- Keep the current node-kind source of truth in `node-definitions.mjs`; frontend projection reads it through chat bootstrap and `/api/workbench/node-definitions`.
- Keep persisted custom node-kind editing in `node-settings-store.mjs`; do not mix it into task-map projection code.
- Keep plan-generation metadata centralized in `task-map-plan-contract.mjs`; future hook/AI producers should read this contract instead of reassembling node + hook metadata ad hoc.
- Keep persisted task-map plans in `task-map-plans.mjs`; they are optional overlay data, not the durable workflow truth.
- Keep workflow-derived plan writers in focused producer files such as `task-map-plan-producers.mjs`, not inside hook handlers or `workbench-store`.
- Keep rich canvas rendering declarative in plan/node metadata. Backend stores node/view intent; frontend renderer owns actual DOM/iframe rendering.
- Keep task-map projection logic in `static/chat/workbench/task-map-model.js`, not in backend store modules.
