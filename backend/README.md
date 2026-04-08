# Backend Map

This directory holds the owner-facing backend for MelodySync.

Use this map before editing:

- `router.mjs`: top-level HTTP composition only. Keep routing thin.
- `routes/`: request/response adapters. Route files should not grow durable state logic.
- `settings/`: canonical settings-domain adapters that shape owner-facing `general`, `email`, `voice`, `hooks`, and `nodes` payloads for the shared settings overlay.
- `session-manager.mjs`: session and run orchestration. Prefer extracting helpers instead of adding more inline lifecycle branches.
- `result-assets.mjs`: result-file discovery and attachment publishing helpers used by run finalization and follow-up flows.
- `history.mjs`, `runs.mjs`, `session/meta-store.mjs`: durable truth for session events, run manifests, and session metadata.
- `compat/`: passive compatibility shims such as legacy app/source metadata normalization.
- `hooks/contract/`: lifecycle scope and event definitions.
- `hooks/runtime/`: hook registry, settings persistence, and builtin registration wiring.
- `hooks/index.mjs`: canonical hook entry surface for bootstrap/runtime callers.
- `hooks/`: builtin metadata, focused handlers, and compatibility export surfaces.
- `workbench/`: workbench persistence helpers, node settings, and read-side projections.
- `workbench/index.mjs`: canonical workbench entry for continuity and branch orchestration layered on focused `workbench/` modules.

Edit rules:

- If a change is about durable truth, start from `session/meta-store.mjs`, `history.mjs`, `runs.mjs`, or `workbench/`.
- If a change is about lifecycle side effects, start from `hooks/` instead of inlining behavior into `session-manager.mjs`.
- If a change is about HTTP shape only, keep it inside `routes/`.
