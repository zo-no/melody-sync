# Compatibility Backend Map

This directory contains compatibility-only backend helpers.

- `apps.mjs`: legacy app-id normalization and builtin compatibility labels.
- `session-meta-compat.mjs`: passive compatibility mapping for `appId`, `appName`, `sourceId`, `sourceName`, and `user*` metadata.

Rules:

- New product logic should not start here.
- Keep this directory limited to compatibility shims and normalization needed by older stored session data or external payloads.
