# Run Backend Map

This directory owns run execution, persistence, finalization, and sidecar supervision.

- `store.mjs`: persisted run status, manifest, spool, result, and artifact helpers.
- `result-envelope.mjs`: normalized structured run result helpers.
- `finalization.mjs`: terminal run finalization flow and run-to-session projection logic.
- `sidecar.mjs`: detached run worker process entry.
- `sidecar-finalize.mjs`: sidecar terminal result persistence helpers.
- `supervisor.mjs`: detached sidecar spawn helper.
