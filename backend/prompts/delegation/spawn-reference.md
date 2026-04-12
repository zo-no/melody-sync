# Session Spawn Reference

Full command reference for spawning child sessions:

```bash
# Independent side session (fire and forget)
melodysync session-spawn --task "<focused task>" --json

# Waited subagent (block until result)
melodysync session-spawn --task "<focused task>" --wait --json

# Hidden waited subagent (suppress visible handoff, return only final reply)
melodysync session-spawn --task "<focused task>" --wait --internal --output-mode final-only --json
```

Prefer the hidden final-only variant when repo-wide search, multi-hop investigation, or other exploratory work would otherwise flood the current session with noisy intermediate output.

Keep spawned-session handoff minimal. Usually the focused task plus the parent session id is enough. If extra context is required, let the child fetch it from the parent session instead of pasting a long recap.

If the `melodysync` command is unavailable in PATH, use:
```bash
node "$MELODYSYNC_PROJECT_ROOT/cli.js" session-spawn --task "<focused task>" --json
```
