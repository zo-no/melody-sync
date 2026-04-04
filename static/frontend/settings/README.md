# Settings Frontend Map

This directory owns the shared settings overlay shell plus tab-specific settings surfaces.

- `ui.js`: shared settings overlay, open/close behavior, and top-tab switching between settings domains.
- `general/`, `email/`, `voice/`: owner-facing settings tabs for app root, email, and voice.
- `hooks/`: hooks lifecycle model plus the hooks tab content renderer.
- `nodes/`: node-kind settings tab content and normalization helpers.

Rules:

- Keep the overlay shell in `settings/ui.js`; do not re-embed modal open/close logic into each tab.
- Keep domain-specific settings content inside `settings/<domain>/`.
- When a domain needs a settings tab, let the shared shell host it instead of adding another overlay.
