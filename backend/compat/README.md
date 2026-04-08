# Compatibility Backend Map

This directory contains compatibility-only backend helpers.

There are currently no active runtime modules here. Source/session metadata normalization has been moved into `backend/session-source/`.

Rules:

- New product logic should not start here.
- Keep this directory limited to compatibility shims and normalization needed by older stored session data or external payloads.
