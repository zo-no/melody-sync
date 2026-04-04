# Hooks Contract Map

This directory defines the stable hook surface.

- `scopes.mjs`: lifecycle scopes such as `instance`, `session`, `run`, and `branch`.
- `phases.mjs`: user-facing lifecycle phases used by settings UI and flow explanations.
- `events.mjs`: concrete lifecycle event definitions and ordering.

Keep this directory focused on declarative contract data. Do not place registry or side-effect logic here.
