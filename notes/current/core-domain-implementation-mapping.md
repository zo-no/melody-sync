# Core Domain Implementation Mapping

This is the lightweight current mapping for the shipped session-first architecture.

For the shipped architecture, start with `../../docs/project-architecture.md`.

## Current Object Map

| Domain object | Main files | Persistence |
|---|---|---|
| `Session` | `backend/session/manager.mjs`, `backend/router.mjs`, `backend/history.mjs`, `backend/session/meta-store.mjs` | `sessions/chat-sessions.json`, `sessions/history/<sessionId>/` under the active runtime root |
| `Run` | `backend/session/manager.mjs`, `backend/run/store.mjs`, `backend/run/sidecar.mjs`, `backend/run/supervisor.mjs` | `sessions/runs/<runId>/` under the active runtime root |
| `Source metadata` | `backend/session/manager.mjs`, connector scripts, `backend/router.mjs` | embedded in `sessions/chat-sessions.json` |
| `Hooks lifecycle contract + runtime` | `backend/hooks/contract/scopes.mjs`, `backend/hooks/contract/phases.mjs`, `backend/hooks/contract/events.mjs`, `backend/hooks/runtime/registry.mjs`, `backend/hooks/runtime/settings-store.mjs`, `backend/hooks/runtime/register-custom-hooks.mjs`, `backend/hooks/builtin-hook-catalog.mjs`, `frontend/settings/ui.js`, `frontend/settings/hooks/model.js`, `frontend/settings/hooks/ui.js` | layered on hook settings plus `custom-hooks.json` under the current storage root |
| `Workbench state` | `backend/workbench/index.mjs`, `backend/workbench/branch-lifecycle.mjs`, `backend/workbench/queues.mjs`, `backend/workbench/state-store.mjs`, `backend/workbench/continuity-store.mjs`, `backend/workbench/operation-records.mjs`, `backend/workbench/exporters.mjs`, `backend/workbench/node-definitions.mjs`, `backend/workbench/node-settings-store.mjs`, `backend/workbench/graph-model.mjs`, `backend/workbench/task-map-plan-contract.mjs`, `backend/workbench/task-map-plans.mjs`, `backend/workbench/task-map-plan-service.mjs`, `backend/workbench/task-map-plan-sync.mjs`, `backend/workbench/task-map-graph-service.mjs`, `backend/workbench/task-map-surface-service.mjs`, `backend/workbench/node-instance.mjs`, `backend/workbench/node-task-card.mjs`, `backend/workbench/node-task-card-sync.mjs`, `backend/workbench/session-ports.mjs`, `backend/workbench/shared.mjs`, `backend/workbench/project-records.mjs`, `frontend/workbench/controller.js`, `frontend/workbench/node-contract.js`, `frontend/workbench/node-effects.js`, `frontend/workbench/node-instance.js`, `frontend/workbench/graph-model.js`, `frontend/workbench/graph-client.js`, `frontend/workbench/node-capabilities.js`, `frontend/workbench/node-task-card.js`, `frontend/workbench/task-map-plan.js`, `frontend/workbench/surface-projection.js`, `frontend/workbench/task-map-clusters.js`, `frontend/workbench/task-map-model.js`, `frontend/workbench/quest-state.js`, `frontend/workbench/task-tracker-ui.js`, `frontend/workbench/node-rich-view-ui.js`, `frontend/workbench/node-canvas-ui.js`, `frontend/workbench/task-map-ui.js`, `frontend/workbench/task-list-ui.js`, `frontend/workbench/branch-actions.js`, `frontend/workbench/operation-record-ui.js`, `frontend/settings/nodes/model.js`, `frontend/settings/nodes/ui.js` | layered on session/workbench persistence |
| `Compatibility metadata` | `backend/session-source/meta-fields.mjs` | folded into source/session metadata normalization |

## Frontend Map

| Concern | Files |
|---|---|
| browser runtime shell | `frontend/core/bootstrap-data.js`, `frontend/core/app-state.js`, `frontend/core/bootstrap.js`, `frontend/core/bootstrap-session-catalog.js`, `frontend/core/i18n.js`, `frontend/core/icons.js`, `frontend/core/layout-tooling.js`, `frontend/core/realtime.js`, `frontend/core/realtime-render.js`, `frontend/core/gestures.js`, `frontend/core/init.js` |
| HTTP session state | `frontend/session/http.js`, `frontend/session/http-helpers.js`, `frontend/session/http-list-state.js` |
| tool/model picker | `frontend/session/tooling.js` |
| composer + attachments | `frontend/session/compose.js` |
| session derived state | `frontend/session/state-model.js` |
| session list contracts | `frontend/session-list/contract.js`, `frontend/session-list/order-contract.js` |
| session list model + grouping | `frontend/session-list/model.js`, `frontend/session-list/ui.js`, `frontend/session-list/sidebar-ui.js` |
| session detail rendering | `frontend/session/surface-ui.js` |
| shared settings shell | `frontend/settings/ui.js` |
| hook settings lifecycle model + UI | `frontend/settings/hooks/model.js`, `frontend/settings/hooks/ui.js` |
| workbench rendering | `frontend/workbench/controller.js`, `frontend/workbench/node-contract.js`, `frontend/workbench/node-effects.js`, `frontend/workbench/task-map-plan.js`, `frontend/workbench/task-map-model.js`, `frontend/workbench/quest-state.js`, `frontend/workbench/task-tracker-ui.js`, `frontend/workbench/task-map-ui.js`, `frontend/workbench/task-list-ui.js`, `frontend/workbench/branch-actions.js`, `frontend/workbench/operation-record-ui.js` |

## Retired Concepts

The following no longer belong in current implementation reasoning:

- `visitor` auth/session flows
- owner-side App/template CRUD
- owner-side User management as a live product surface
- session-level scheduled triggers
- `ShareSnapshot`
- public `/share/*` surfaces

If you encounter them in older notes or legacy data, treat them as historical residue or cleanup targets.
