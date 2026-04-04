# Workbench Frontend Map

This directory owns the structured task-workbench UI.

Files by role:

- `node-contract.js`: frontend node-kind contract that validates and exposes the backend-provided node definitions and composition metadata.
- `node-effects.js`: shared node semantics for task-map projection and rendering, including counts, interaction, edge, surface, capability, and view-type rules.
- `node-instance.js`: stable graph node-instance contract. It normalizes capabilities, surface bindings, task-card bindings, view metadata, and origin metadata before nodes hit any renderer or surface consumer.
- `graph-model.js`: shared graph node/edge collection helpers used by both default continuity projection and task-map-plan overlays.
- `graph-client.js`: canonical backend quest-graph client. It reads `/api/workbench/sessions/:id/task-map-graph` and normalizes that payload back into the frontend projection shape.
- `node-capabilities.js`: capability helpers plus a workbench action controller so renderer code can execute node actions without hardcoding branch/session mutations inline.
- `task-map-plan.js`: optional graph-plan overlay that can replace or augment the default continuity projection without touching renderer code; augment mode now also merges matching node ids so hook-generated plans can enrich default nodes instead of duplicating them, and surface-node selectors can reuse the merged graph in non-map UI like composer suggestions.
- `surface-projection.js`: workbench-owned selectors that project node surfaces into non-map UI slots such as composer suggestions without leaking graph-plan details into session modules.
- `node-task-card.js`: frontend helper that folds node-instance metadata into deterministic task-card patches, with plan/manual/hook nodes overriding projection nodes for scalar bindings.
- `task-map-clusters.js`: synthetic cluster and branch-lineage helpers that prepare continuity-backed quest sources before projection.
- `task-map-mock-presets.js`: isolated mock/demo task-map augmentation so the real projection file does not own demo graph mutations.
- `task-map-model.js`: session/workbench snapshot to task-map projection.
- `quest-state.js`: session/workbench snapshot selectors and derived view state.
- `task-tracker-ui.js`: top tracker rendering.
- `node-rich-view-ui.js`: focused rich-view renderer for markdown/html/iframe node surfaces inside the task map.
- `node-canvas-ui.js`: dedicated right-rail node canvas renderer. It owns the selected rich-view node surface so `view.type` no longer has to be rendered inline inside graph nodes.
- `task-map-ui.js`: task-map rendering and interaction.
- `task-list-ui.js`: workbench-side task list rendering.
- `branch-actions.js`: branch lifecycle buttons and action binding.
- `operation-record-ui.js`: right-rail operation-record rendering and open/close control.

Design rules:

- `controller.js` should stay a coordinator, not absorb renderer details again.
- Keep contracts and projection close to the workbench UI that consumes them.
- Treat `backend/workbench/node-definitions.mjs` as the canonical current node source; `node-contract.js` should read bootstrap/API-fed definitions and keep a safe fallback for isolated tests.
- Keep node behavior centralized in `node-effects.js`; avoid adding new `kind === ...` branches directly in `task-map-model.js` or `task-map-ui.js`.
- Keep graph node-instance shape centralized in `node-instance.js`; avoid letting `task-map-model.js`, `task-map-plan.js`, `surface-projection.js`, and `node-capabilities.js` drift into separate node payload formats.
- Keep graph node/edge collection shape centralized in `graph-model.js`; avoid letting `task-map-model.js` and `task-map-plan.js` drift into separate quest graph formats.
- Keep canonical graph reads centralized in `graph-client.js`; `controller.js` should prefer the backend graph payload before falling back to local continuity reconstruction.
- Keep quest-source helpers in `task-map-clusters.js` and mock/demo graph injection in `task-map-mock-presets.js`; `task-map-model.js` should stay focused on default continuity projection.
- Treat `view.type` as the right-rail node-canvas contract. The canvas renderer decides safe embedding; task-map nodes only provide structure, selection, and capability entry points.
- Keep optional graph overrides centralized in `task-map-plan.js`; default continuity projection should stay available as the fallback path.
- Treat hook-generated `taskMapPlan` overlays as node metadata enrichers first. If a hook wants to enrich an existing default node, reuse the same node id and let the plan merge path attach summary/view/surface metadata.
- Treat `taskCardBindings` as contract metadata first. They describe which task-card fields a node is allowed to bind back to; they should not be applied ad hoc inside render code.
- Keep task-card patch precedence consistent with backend `backend/workbench/node-task-card.mjs`: plan/manual/hook nodes may override projection-backed scalar bindings; renderer order should not decide semantic authority.
- Preserve node `origin` metadata (`projection` vs `plan`) when enriching or replacing graph nodes. Future AI/hook flows need that provenance to stay debuggable.
- Treat `/api/workbench/task-map-plan-contract` as the canonical backend contract for future hook/AI graph planning inputs.
- Treat `GET/POST/DELETE /api/workbench/sessions/:id/task-map-plans` as the formal session-scoped plan entry. UI and future AI/manual tooling should write plan metadata there instead of patching workbench state files directly.
- Treat `GET /api/workbench/sessions/:id/task-map-graph` as the canonical backend quest-graph read entry. Consumers that need the current graph should read that payload instead of reconstructing continuity + plan overlay on their own.
- Treat `GET /api/workbench/sessions/:id/task-map-surfaces/:slot` as the canonical backend surface read entry. Slot consumers should prefer that payload when they do not need the whole graph.
- Keep runtime node rendering logic here; owner-facing node settings now live in `static/frontend/settings/nodes/`.
- Put new visual rendering into a focused `*-ui.js` module.
- Put derived state in selectors like `quest-state.js`, not inline in render code.
