# Settings Backend Map

This directory owns the canonical settings-domain helpers that power the shared settings overlay.

- `general-store.mjs`: persisted machine/app-root settings store and runtime bootstrap helpers.
- `email-store.mjs`: persisted mailbox and outbound-email settings store.
- `voice-store.mjs`: persisted voice connector settings store.
- `registry.mjs`: machine-readable list of settings sections shown in the UI.
- `general.mjs`: canonical app-root settings payload and persistence helpers for the General tab.
- `email.mjs`: canonical email settings payload and persistence helpers for the Email tab.
- `voice.mjs`: canonical voice settings payload and persistence helpers for the Voice tab.
- `hooks.mjs`: canonical hooks settings payload and enable/disable updates for the Hooks tab.
- `nodes.mjs`: canonical node-kind settings payload and CRUD helpers for the Nodes tab.

Rules:

- Keep `/api/settings*` as the canonical settings surface for owner-facing configuration.
- Domain logic can stay in `hooks/`, `workbench/`, or other feature folders, but settings-facing payloads should be adapted here.
- Do not leak raw feature-domain route shapes into the shared settings UI when a settings-specific projection can keep the contract clearer.
