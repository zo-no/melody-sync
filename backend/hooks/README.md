# Hooks Backend Map

This directory owns MelodySync hook architecture.

Files by role:

- `contract/`: lifecycle scopes, user-facing phases, event definitions, and the canonical hook contract surface.
- `runtime/`: hook registry, persisted enable/disable state, and builtin registration wiring.
- `index.mjs`: canonical hook entry that registers builtin/custom hooks and re-exports the registry surface.
- `registry.mjs`: canonical registry re-export surface for callers that only need event registration helpers.
- `builtin-hook-catalog.mjs`: builtin hook metadata. Labels, ids, and supported targets belong here.
- `register-builtin-hooks.mjs` and `register-session-manager-hooks.mjs`: compatibility wrappers over `runtime/`.
- `*-hook.mjs`: focused hook handlers or factories. Keep them short and testable.
- `hook-settings-store.mjs`: compatibility wrapper over `runtime/settings-store.mjs`.
- custom hook design file: the runtime can also load JSON-defined local shell hooks from the current MelodySync app root, typically `<app-root>/hooks/custom-hooks.json` (or `custom-hooks.json` under explicit config overrides).

When adding or changing a hook:

1. Update `contract/` if the lifecycle scope or event surface itself changes.
2. Update `builtin-hook-catalog.mjs` for metadata.
3. Update or add the specific `*-hook.mjs` handler.
4. Register it in the appropriate `runtime/register-*.mjs` file.
5. For user-owned local scripts, prefer `custom-hooks.json` over adding a new builtin hook.

Do not hide durable workflow truth in hooks. Hooks are lifecycle orchestration and side effects, not the system of record.
