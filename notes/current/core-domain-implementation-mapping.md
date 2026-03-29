# Core Domain Implementation Mapping

This is the lightweight current mapping after share/visitor flows were removed.

For the shipped architecture, start with `../../docs/project-architecture.md`.

## Current Object Map

| Domain object | Main files | Persistence |
|---|---|---|
| `OwnerSession` | `chat/session-manager.mjs`, `chat/router.mjs` | `chat-sessions.json`, `chat-history/<sessionId>/` |
| `Run` | `chat/session-manager.mjs`, `chat/runner-sidecar*.mjs` | `chat-runs/<runId>/` |
| `Source metadata` | `chat/session-manager.mjs`, connector scripts, `chat/router.mjs` | embedded in `chat-sessions.json` |
| `User` | `chat/users.mjs`, `chat/router-admin-routes.mjs` | `users.json` |

## Frontend Map

| Concern | Files |
|---|---|
| boot + session catalog | `static/chat/bootstrap.js`, `static/chat/bootstrap-session-catalog.js` |
| HTTP session state | `static/chat/session-http.js`, `static/chat/session-http-helpers.js` |
| websocket + live updates | `static/chat/realtime.js`, `static/chat/realtime-render.js` |
| tool/model picker | `static/chat/tooling.js` |
| composer + attachments | `static/chat/compose.js` |

## Retired Concepts

The following no longer belong in current implementation reasoning:

- `visitor` auth/session flows
- owner-side App/template CRUD
- session-level scheduled triggers
- `ShareSnapshot`
- public `/share/*` surfaces

If you encounter them in older notes or legacy data, treat them as historical residue.
