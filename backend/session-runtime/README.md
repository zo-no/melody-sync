# Session Runtime

This folder contains the extracted runtime helpers that back MelodySync's session core.

- `session-state.mjs`: normalized session truth helpers
- `agent-result-envelope.mjs`: structured agent result normalization
- `session-compaction.mjs`: compaction prompt and parsing helpers
- `session-fork-context.mjs`: prepared fork-context projection helpers

These modules are intentionally pure or near-pure helpers so `session-manager` and `run-finalization` can stay focused on orchestration.
