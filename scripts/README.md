# scripts

Script families are grouped by operational domain.

- `local-service/`: local MelodySync service lifecycle scripts, including ad-hoc chat-instance management
- `voice/`: voice connector, wake/capture helpers, speech workers, and voice runtime utilities
- `observer/`: proactive observer runtime and helper scripts
- `github-ci/`: GitHub CI auto-repair and triage automation scripts
- `agent-mail/`: agent mail CLI, worker, and webhook bridge
- `agents/`: standalone agent installers and agent-specific helper CLIs
- `analysis/`: reporting, inspection, and research-oriented scripts
- `build/`: repo build and generation helpers
- `local-actions/`: local one-off action demos and utilities
- `dev/`: development-only artifacts and experiments

Keep `scripts/` root for shared docs only. Avoid adding new runtime or tooling files directly at the root.
