# Remote Capability Monitor

The remote capability monitor is a recurring MelodySync automation flow that scouts the remote-control coding-agent space and feeds the result back into a reviewable MelodySync session.

It is meant to answer a focused question continuously:

- what are direct competitors and adjacent tools shipping for remote control of local coding agents,
- what changed recently,
- and which of those changes are worth adapting inside MelodySync.

## Primary tracked surfaces

The monitor is designed to follow exact, machine-readable sources where possible.

Current examples:

- `slopus/happy`
- `slopus/happy-cli`
- `anthropics/claude-code`
- `Claude Code Remote Control` news coverage
- `openai/codex`

The `Happy` project matters here because it is an explicit remote-control product surface:

- `slopus/happy` — mobile and web client for Claude Code and Codex
- `slopus/happy-cli` — local CLI bridge / wrapper for remote control of local coding tools

## How it fits MelodySync

This monitor should not stop at local logs or standalone notifications.

The intended flow is:

1. fetch and score source updates
2. write a local report and JSON summary
3. create or reuse one stable MelodySync review session for the automation
4. submit the digest into that session
5. let the AI produce the review/proposal inside MelodySync
6. optionally notify the owner with a deep link into that session

That makes the real review surface a normal MelodySync session instead of an external dashboard.

## Session/source pattern

A good monitor rollout uses a dedicated automation source, for example `Agent Radar`, with:

- a system prompt focused on competitive/product judgment
- stable source metadata such as `sourceId`, `sourceName`, and `group`
- a stable session identity via `externalTriggerId`
- one recurring review thread for the automation

This keeps the automation:

- reviewable
- resumable
- easy to follow up on
- grouped cleanly in the owner UI

## Shared vs local split

Shared logic lives in the repo:

- `scripts/remote-capability-monitor.mjs`

Machine-local setup stays outside the repo:

- source tuning
- notifier channels
- scheduler setup
- auth/token files
- concrete source/session IDs for that machine

## Local config shape

Typical local config includes:

```json
{
  "bootstrapHours": 72,
  "reportDir": "~/.melodysync/research/remote-capability-monitor",
  "notification": {
    "notifierPath": "~/.melodysync/scripts/send-multi-channel-reminder.mjs",
    "channels": []
  },
  "melodysync": {
    "baseUrl": "http://127.0.0.1:7760",
    "authFile": "~/.config/melody-sync/auth.json",
    "sessionFolder": "~/code/melody-sync",
    "session": {
      "sourceId": "agent-radar",
      "sourceName": "Agent Radar",
      "group": "Automation",
      "externalTriggerId": "automation:agent-radar:remote-capability-scout"
    }
  },
  "sources": []
}
```

The current script reads the `melodysync` config block and stores state under MelodySync paths.

## Source types

Supported source types:

- `google_news_rss`
- `rss`
- `atom`

Per-source tuning can include:

- `lookbackHours`
- `maxItems`
- `baseWeight`
- `target`
- `mustMatchAny`
- `mustMatchAll`
- `lowConfidence`

## Outputs

Typical outputs are:

- state in `~/.config/melody-sync/remote-capability-monitor/`
- reports in `~/.melodysync/research/remote-capability-monitor/`
- a stable MelodySync review session for the automation
- optional deep-link notifications

## Operational rule

When the monitor is connected to a MelodySync review session, that session should be treated as the primary review surface.

Notifications are helpful, but they should point back to the session rather than replace it.
