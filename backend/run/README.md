# Run Backend Map

This directory is now the compatibility surface for the run module.

Canonical implementation homes:

- `../controllers/run/routes.mjs`: run transport adapter.
- `../services/run/finalization.mjs`: terminal run finalization flow and run-to-session orchestration.
- `../models/run/stores/run-store.mjs`: persisted run status, manifest, spool, result, and artifact helpers.
- `../models/run/state/result-envelope.mjs`: normalized structured run result helpers.
- `../runtime/run/sidecar.mjs`: detached run worker process entry.
- `../runtime/run/sidecar-finalize.mjs`: sidecar terminal result persistence helpers.
- `../runtime/run/supervisor.mjs`: detached sidecar spawn helper.
- `../runtime/run/process-runner.mjs`: process invocation assembly.
- `../runtime/providers/*.mjs`: provider-specific adapters and provider runtime monitoring.

Files in `backend/run/` should stay as compatibility re-export surfaces until the rest of the backend is migrated.
