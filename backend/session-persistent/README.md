# session-persistent

Persistent session helpers live here.

- `core.mjs`: digest building, normalization, runtime selection, scheduled and recurring trigger utilities.
- `scheduler.mjs`: background scanner that triggers due scheduled or recurring persistent sessions.
- `../services/session/persistent-service.mjs`: persistent-task promote/run orchestration, including optional branch-spawn execution.

This directory belongs to the long-lived session automation layer, not the main session runtime truth layer.
