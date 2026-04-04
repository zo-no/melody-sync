# Workbench Backend Map

This directory contains focused workbench backend modules.

Current split:

- `index.mjs`: thin workbench domain entry; re-exports continuity/branch orchestration and wraps project-record operations.
- `branch-lifecycle.mjs`: branch creation, merge-back, status changes, reminder snooze, and continuity sync.
- `queues.mjs`: shared serial queue coordinator for workbench writes.
- `state-store.mjs`: load/save workbench durable state.
- `continuity-store.mjs`: mainline/branch continuity and task-cluster projections.
- `operation-records.mjs`: operation-record projection for the right rail.
- `exporters.mjs`: markdown, summary, obsidian, and other export-oriented output.
- `project-records.mjs`: capture/project/node/summary/obsidian write operations that do not belong in branch-lifecycle orchestration.
- `node-definitions.mjs`: canonical current node-kind exposure for bootstrap and HTTP clients, including composition metadata such as capabilities, surface bindings, and default right-canvas view types.
- `node-settings-store.mjs`: persisted custom node-kind settings layered on top of the builtin node contract, including future-facing composition metadata.
- `task-map-plan-contract.mjs`: machine-readable contract for future hook/AI graph planning, including plan-capable hooks, node kinds, source types, right-canvas view types, and fallback behavior.
- `task-map-plans.mjs`: persisted optional task-map plan overlays that can replace or augment the default continuity projection; plan nodes can declare rich right-canvas views.
- `task-map-plan-service.mjs`: session-scoped formal write entry for manual/system plans. It resolves quest roots, constrains writable source types, and keeps plan writes on the shared sync path.
- `task-map-plan-sync.mjs`: shared persisted-plan sync layer. It compares previous/next plan sets and writes managed node bindings back into every affected session under the same root.
- `graph-model.mjs`: backend graph node/edge collection helpers shared by default continuity graph construction and plan overlay application.
- `task-map-graph-service.mjs`: session-scoped canonical graph read entry. It resolves a session back to its root quest, builds the default continuity graph, then applies persisted plans on top.
- `task-map-surface-service.mjs`: session-scoped canonical surface read entry. It projects graph nodes with `surfaceBindings` into stable slot payloads such as `composer-suggestions`.
- `task-map-plan-producers.mjs`: focused workflow-to-plan producers; currently used by `builtin.branch-candidates` to write candidate-node overlays from hook lifecycle state.
- `node-instance.mjs`: backend graph node-instance normalizer. It keeps plan nodes and future hook/AI-produced nodes on the same stable contract before persistence or downstream patching.
- `node-task-card.mjs`: backend helper that derives session-scoped task-card patches from node instances, with plan/manual/hook nodes taking precedence over default projection nodes for scalar bindings.
- `node-task-card-sync.mjs`: backend bridge from persisted task-map plans to `session.taskCard`. It lets hook/AI-produced node plans update managed task-card fields without teaching each hook its own patching rules, including managed candidate arrays and managed scalar bindings that would otherwise be restabilized away by the session layer.
- `shared.mjs`: normalization helpers shared across workbench modules.

Boundary rules:

- Keep persistence and projection separate.
- Prefer adding new focused modules here rather than growing `backend/workbench/index.mjs`.
- Keep branch lifecycle and continuity-sync logic in `branch-lifecycle.mjs`; `index.mjs` should mostly re-export or wire domain modules together.
- Keep shared workbench serialization in `queues.mjs`; avoid recreating ad hoc per-file queue maps.
- Keep capture/project/node/summary CRUD in `project-records.mjs`; `index.mjs` should stay focused on continuity and branch orchestration.
- Keep the current node-kind source of truth in `node-definitions.mjs`; frontend projection reads it through chat bootstrap and the settings-domain `/api/settings/nodes` surface.
- Keep persisted custom node-kind editing in `node-settings-store.mjs`; do not mix it into task-map projection code.
- Keep plan-generation metadata centralized in `task-map-plan-contract.mjs`; future hook/AI producers should read this contract instead of reassembling node + hook metadata ad hoc.
- Keep persisted task-map plans in `task-map-plans.mjs`; they are optional overlay data, not the durable workflow truth.
- Keep formal session-scoped plan writes in `task-map-plan-service.mjs`; route handlers and future AI/manual writers should not hand-roll root resolution or source-policy checks.
- Keep canonical session-scoped graph reads in `task-map-graph-service.mjs`; future AI/manual tooling should read the current quest graph there instead of rebuilding continuity + plan overlay ad hoc.
- Keep canonical session-scoped surface reads in `task-map-surface-service.mjs`; slot consumers should read node-backed surfaces there instead of reimplementing graph selectors in feature-specific code.
- Keep cross-plan writeback orchestration in `task-map-plan-sync.mjs`; producers should not open-code `read -> persist -> resync` loops.
- Keep backend graph node/edge helpers centralized in `graph-model.mjs`; default continuity projection and plan overlay should share one graph shape.
- Keep workflow-derived plan writers in focused producer files such as `task-map-plan-producers.mjs`, not inside hook handlers or `workbench-store`.
- Keep backend node-instance shape centralized in `node-instance.mjs`; avoid letting plan persistence and producer modules drift into separate plan-node payload formats.
- Keep task-card patch derivation centralized in `node-task-card.mjs`; hook/AI flows should not invent ad hoc patch precedence rules.
- Keep plan-to-session task-card writeback centralized in `node-task-card-sync.mjs`; producer and hook modules should pass managed binding keys, not hand-roll merge logic.
- Keep rich canvas rendering declarative in plan/node metadata. Backend stores node/view intent; frontend renderer owns actual DOM/iframe rendering.
- Keep task-map projection logic in `static/frontend/workbench/task-map-model.js`, not in backend store modules.
