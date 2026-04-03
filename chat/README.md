# Chat Backend Map

This directory holds the owner-facing backend for MelodySync.

Use this map before editing:

- `router.mjs`: top-level HTTP composition only. Keep routing thin.
- `routes/`: request/response adapters. Route files should not grow durable state logic.
- `session-manager.mjs`: session and run orchestration. Prefer extracting helpers instead of adding more inline lifecycle branches.
- `history.mjs`, `runs.mjs`, `session-meta-store.mjs`: durable truth for session events, run manifests, and session metadata.
- `compat/`: passive compatibility shims such as legacy app/source metadata normalization.
- `hooks/contract/`: lifecycle scope and event definitions.
- `hooks/runtime/`: hook registry, settings persistence, and builtin registration wiring.
- `hooks/`: builtin metadata, focused handlers, and compatibility export surfaces.
- `workbench/`: workbench persistence helpers, node settings, and read-side projections.
- `workbench-store.mjs`: compatibility shell and orchestration entry for workbench behavior. Prefer moving new focused logic into `workbench/`.

Edit rules:

- If a change is about durable truth, start from `session-meta-store.mjs`, `history.mjs`, `runs.mjs`, or `workbench/`.
- If a change is about lifecycle side effects, start from `hooks/` instead of inlining behavior into `session-manager.mjs`.
- If a change is about HTTP shape only, keep it inside `routes/`.
