# Current Features

This document lists the current shipped MelodySync feature surface and explicitly marks the retired legacy surfaces that should not drift back into the public product story.

## Product Surface

| Area | Current capability | Notes |
| --- | --- | --- |
| Auth | Single owner login | Token or password login |
| Sessions | Create, rename, pin, archive, restore, delete | Session is the main durable object |
| Runs | Detached execution runs | Run state persists on disk and survives browser disconnects |
| Messaging | Send messages, queue follow-ups while busy, cancel active runs | HTTP is canonical, WebSocket is invalidation only |
| Inputs | Text, file uploads, pasted images | Assets can be saved and reused in a session |
| Task flow | Fork session, delegate subtask, task-map / branch tracking | Keeps the session-first workflow model |
| Runtime preferences | Tool, model, effort, thinking | Stored per session |
| Session organization | Auto title, grouping, sidebar sorting helpers, flat task list | Sidebar stays a grouped work list; task structure lives in the map/tracker |
| UI | Phone + desktop web UI, reconnect refresh, build update prompt | No frontend build step required |
| Integrations | External message protocol, email/GitHub style connectors, remote capability monitor | These create or enrich sessions through the core session API |
| Deployment | Local self-hosting and guest instances | External access is operator-managed and documented separately |

## Retired Legacy Surfaces

| Removed area | Current status |
| --- | --- |
| Legacy app CRUD / template layer | Removed |
| User management surface | Removed |
| Session `apply-template` / `save-template` flows | Removed |
| Session-level scheduled triggers | Removed |
| Global `/api/triggers` control plane | Removed |
| Public share links / visitor mode | Removed |

## Durable Data Layout

Default layout:

- `brainRoot` stores portable assets such as `AGENTS.md` and `memory/`
- `runtimeRoot` stores machine-local runtime state such as `config/`, `email/`, `voice/`, `sessions/`, `hooks/`, `workbench/`, and `logs/`
- by default MelodySync uses `~/.melodysync` for the brain and `~/.melodysync/runtime` for the runtime

| Path | Purpose |
| --- | --- |
| `config/` | Owner auth config, runtime settings, push config, tool catalog |
| `email/` | Mailbox identity, outbound, and automation config |
| `voice/` | Local voice-ingress config and runtime artifacts |
| `memory/` | Bootstrap/project/skills/task memory |
| `sessions/` | Machine-readable session storage: `chat-sessions.json`, derived `SESSIONS.md`, append-only `history/`, durable `runs/`, and uploaded assets |
| `hooks/` | Hook enable state and custom hook design file |
| `workbench/` | Node settings, plans, branch contexts, summaries |

## Notes

- Legacy compatibility fields such as `appId` / `appName`, `sourceId` / `sourceName`, and `userId` / `userName` may still appear in stored session metadata.
- Those fields are not active product surfaces. They should be treated as passive metadata unless a future product decision explicitly revives them.
- Integrations and workbench capabilities still matter, but they layer on top of the core session/run model instead of replacing it.
- For internal review of which capabilities belong in the main flow, settings, hidden/internal surfaces, or deletion review, see `notes/current/feature-and-settings-inventory.md`.
