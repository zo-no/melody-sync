# Core Domain Implementation Mapping

This is the lightweight current mapping for the shipped session-first architecture.

For the shipped architecture, start with `../../docs/project-architecture.md`.

## Current Object Map

| Domain object | Main files | Persistence |
|---|---|---|
| `Session` | `chat/session-manager.mjs`, `chat/router.mjs`, `chat/history.mjs`, `chat/session-meta-store.mjs` | `chat-sessions.json`, `chat-history/<sessionId>/` |
| `Run` | `chat/session-manager.mjs`, `chat/runs.mjs`, `chat/runner-sidecar*.mjs` | `chat-runs/<runId>/` |
| `Source metadata` | `chat/session-manager.mjs`, connector scripts, `chat/router.mjs` | embedded in `chat-sessions.json` |
| `Workbench state` | `chat/workbench-store.mjs`, `static/chat/workbench-ui.js` | layered on session/workbench persistence |

## Frontend Map

| Concern | Files |
|---|---|
| boot + session catalog | `static/chat/bootstrap.js`, `static/chat/bootstrap-session-catalog.js` |
| HTTP session state | `static/chat/session-http.js`, `static/chat/session-http-helpers.js` |
| websocket + live updates | `static/chat/realtime.js`, `static/chat/realtime-render.js` |
| tool/model picker | `static/chat/tooling.js` |
| composer + attachments | `static/chat/compose.js` |
| session detail rendering | `static/chat/session-surface-ui.js` |
| workbench rendering | `static/chat/workbench-ui.js` |

## Retired Concepts

The following no longer belong in current implementation reasoning:

- `visitor` auth/session flows
- owner-side App/template CRUD
- owner-side User management as a live product surface
- session-level scheduled triggers
- `ShareSnapshot`
- public `/share/*` surfaces

If you encounter them in older notes or legacy data, treat them as historical residue or cleanup targets.
