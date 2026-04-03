# Hooks Runtime Map

This directory owns hook registration, enable/disable state, and bootstrap wiring.

- `registry.mjs`: in-memory hook registry and event dispatch.
- `settings-store.mjs`: persisted enable/disable state.
- `register-builtins.mjs`: repo-level builtin hook registration.
- `register-session-manager-hooks.mjs`: builtin hooks that need session-manager dependencies.

Keep runtime wiring here. Keep hook metadata in `../builtin-hook-catalog.mjs` and keep handler logic in focused `../*-hook.mjs` files.
