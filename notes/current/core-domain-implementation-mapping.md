# Core Domain Implementation Mapping

This is the lightweight current mapping for the shipped session-first architecture.

For the shipped architecture, start with `../../docs/project-architecture.md`.

## Current Object Map

| Domain object | Main files | Persistence |
|---|---|---|
| `Session` | `chat/session-manager.mjs`, `chat/router.mjs`, `chat/history.mjs`, `chat/session-meta-store.mjs` | `chat-sessions.json`, `chat-history/<sessionId>/` |
| `Run` | `chat/session-manager.mjs`, `chat/runs.mjs`, `chat/runner-sidecar*.mjs` | `chat-runs/<runId>/` |
| `Source metadata` | `chat/session-manager.mjs`, connector scripts, `chat/router.mjs` | embedded in `chat-sessions.json` |
| `Hooks lifecycle contract + runtime` | `chat/hooks/contract/scopes.mjs`, `chat/hooks/contract/phases.mjs`, `chat/hooks/contract/events.mjs`, `chat/hooks/runtime/registry.mjs`, `chat/hooks/runtime/settings-store.mjs`, `chat/hooks/builtin-hook-catalog.mjs`, `static/chat/settings/hooks/model.js`, `static/chat/settings/hooks/ui.js` | layered on `hooks.json` plus in-memory registry |
| `Workbench state` | `chat/workbench-store.mjs`, `chat/workbench/state-store.mjs`, `chat/workbench/continuity-store.mjs`, `chat/workbench/operation-records.mjs`, `chat/workbench/exporters.mjs`, `chat/workbench/shared.mjs`, `static/chat/workbench-ui.js`, `static/chat/workbench/node-contract.js`, `static/chat/workbench/task-map-model.js`, `static/chat/workbench/quest-state.js`, `static/chat/workbench/task-tracker-ui.js`, `static/chat/workbench/task-map-ui.js`, `static/chat/workbench/task-list-ui.js`, `static/chat/workbench/branch-actions.js`, `static/chat/workbench/operation-record-ui.js` | layered on session/workbench persistence |
| `Compatibility metadata` | `chat/compat/apps.mjs`, `chat/compat/session-meta-compat.mjs` | layered on stored session metadata only |

## Frontend Map

| Concern | Files |
|---|---|
| boot + session catalog | `static/chat/bootstrap.js`, `static/chat/bootstrap-session-catalog.js` |
| HTTP session state | `static/chat/session/http.js`, `static/chat/session/http-helpers.js`, `static/chat/session/http-list-state.js` |
| websocket + live updates | `static/chat/realtime.js`, `static/chat/realtime-render.js` |
| tool/model picker | `static/chat/session/tooling.js` |
| composer + attachments | `static/chat/session/compose.js` |
| session derived state | `static/chat/session/state-model.js` |
| session list contracts | `static/chat/session-list/contract.js`, `static/chat/session-list/order-contract.js` |
| session list model + grouping | `static/chat/session-list/model.js`, `static/chat/session-list/ui.js` |
| session detail rendering | `static/chat/session/surface-ui.js` |
| hook settings lifecycle model + UI | `static/chat/settings/hooks/model.js`, `static/chat/settings/hooks/ui.js` |
| workbench rendering | `static/chat/workbench-ui.js`, `static/chat/workbench/node-contract.js`, `static/chat/workbench/task-map-model.js`, `static/chat/workbench/quest-state.js`, `static/chat/workbench/task-tracker-ui.js`, `static/chat/workbench/task-map-ui.js`, `static/chat/workbench/task-list-ui.js`, `static/chat/workbench/branch-actions.js`, `static/chat/workbench/operation-record-ui.js` |

## Retired Concepts

The following no longer belong in current implementation reasoning:

- `visitor` auth/session flows
- owner-side App/template CRUD
- owner-side User management as a live product surface
- session-level scheduled triggers
- `ShareSnapshot`
- public `/share/*` surfaces

If you encounter them in older notes or legacy data, treat them as historical residue or cleanup targets.
