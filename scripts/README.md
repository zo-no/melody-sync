# scripts

Script families are grouped by operational domain.

- `local-service/`: local MelodySync service lifecycle scripts, including ad-hoc chat-instance management
- `voice/`: voice connector, wake/capture helpers, speech workers, and voice runtime utilities
- `observer/`: proactive observer runtime and helper scripts
- `github-ci/`: GitHub CI auto-repair and triage automation scripts
- `agent-mail/`: agent mail CLI, worker, and webhook bridge

Keep `scripts/` root for shared docs and standalone utilities only. Avoid adding new family-level runtime scripts directly at the root.
