# Settings Frontend Map

This directory owns the shared settings overlay shell plus tab-specific settings surfaces.

- `ui.js`: shared settings overlay, open/close behavior, and top-tab switching between settings domains.
- `hooks/`: hooks lifecycle model plus the hooks tab content renderer.

Rules:

- Keep the overlay shell in `settings/ui.js`; do not re-embed modal open/close logic into each tab.
- Keep domain-specific settings content inside the owning domain directory.
- When a domain needs a settings tab, let the shared shell host it instead of adding another overlay.
