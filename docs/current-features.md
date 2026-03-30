# Current Features

This document lists the current shipped MelodySync feature surface after App templates, user-management surfaces, share/visitor mode, and session-level scheduled triggers were removed.

## Product Surface

| Area | Current capability | Notes |
| --- | --- | --- |
| Auth | Single owner login | Token or password login |
| Sessions | Create, rename, pin, archive, restore, delete | Session is the main durable object |
| Runs | Detached execution runs | Run state persists on disk and survives browser disconnects |
| Messaging | Send messages, queue follow-ups while busy, cancel active runs | HTTP is canonical, WebSocket is invalidation only |
| Inputs | Text, file uploads, pasted images | Assets can be saved and reused in a session |
| Task flow | Fork session, delegate subtask, task/workbench tracking | Keeps the session-first workflow model |
| Runtime preferences | Tool, model, effort, thinking | Stored per session |
| Session organization | Auto title, grouping, sidebar sorting helpers | Includes the built-in hidden session organizer flow |
| UI | Phone + desktop web UI, reconnect refresh, build update prompt | No frontend build step required |
| Integrations | External message protocol, Feishu/email/GitHub style connectors, remote capability monitor | These create or enrich sessions through the core session API |
| Deployment | Local self-hosting, Cloudflare Tunnel, Tailscale, guest instances | Instance root can be isolated per runtime |

## Removed Features

| Removed area | Current status |
| --- | --- |
| App CRUD and App templates | Removed |
| User management surface | Removed |
| Session `apply-template` / `save-template` flows | Removed |
| Session-level scheduled triggers | Removed |
| Global `/api/triggers` control plane | Removed |
| Public share links / visitor mode | Removed |

## Durable Data Layout

| Path | Purpose |
| --- | --- |
| `auth.json` | Owner auth config |
| `tools.json` | Tool catalog |
| `chat-sessions.json` | Session metadata |
| `chat-history/` | Per-session event store |
| `chat-runs/` | Per-run status and manifests |
| `assets/` | Uploaded/generated assets |

## Notes

- `appId` / `appName`, `sourceId` / `sourceName`, and `userId` / `userName` may still appear in stored session metadata for compatibility or connector tagging.
- Those fields are not active product surfaces. They should be treated as passive metadata unless a future product decision explicitly revives them.
- Integrations and workbench capabilities still matter, but they layer on top of the core session/run model instead of replacing it.
