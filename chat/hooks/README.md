# Hooks Backend Map

This directory owns MelodySync hook architecture.

Files by role:

- `contract/`: lifecycle scopes, user-facing phases, and lifecycle event definitions.
- `runtime/`: hook registry, persisted enable/disable state, and builtin registration wiring.
- `hook-contract.mjs`: compatibility export surface for the hook contract.
- `builtin-hook-catalog.mjs`: builtin hook metadata. Labels, ids, and supported targets belong here.
- `register-builtin-hooks.mjs` and `register-session-manager-hooks.mjs`: compatibility wrappers over `runtime/`.
- `*-hook.mjs`: focused hook handlers or factories. Keep them short and testable.
- `hook-settings-store.mjs`: compatibility wrapper over `runtime/settings-store.mjs`.

When adding or changing a hook:

1. Update `contract/` if the lifecycle scope or event surface itself changes.
2. Update `builtin-hook-catalog.mjs` for metadata.
3. Update or add the specific `*-hook.mjs` handler.
4. Register it in the appropriate `runtime/register-*.mjs` file.

Do not hide durable workflow truth in hooks. Hooks are lifecycle orchestration and side effects, not the system of record.
