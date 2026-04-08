# session-persistent

Persistent session helpers live here.

- `core.mjs`: digest building, normalization, runtime selection, recurring schedule utilities.
- `scheduler.mjs`: background scanner that triggers due recurring persistent sessions.

This directory belongs to the long-lived session automation layer, not the main session runtime truth layer.
