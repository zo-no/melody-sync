# Core Domain Implementation Mapping

This is the lightweight current mapping for the shipped session-first architecture.

For the shipped architecture, start with `../../docs/project-architecture.md`.

## Current Object Map

| Domain object | Main files | Persistence |
|---|---|---|
| `Session` | `backend/session-manager.mjs`, `backend/router.mjs`, `backend/history.mjs`, `backend/session-meta-store.mjs` | `chat-sessions.json`, `chat-history/<sessionId>/` |
| `Run` | `backend/session-manager.mjs`, `backend/runs.mjs`, `backend/runner-sidecar*.mjs` | `chat-runs/<runId>/` |
| `Source metadata` | `backend/session-manager.mjs`, connector scripts, `backend/router.mjs` | embedded in `chat-sessions.json` |
| `Hooks lifecycle contract + runtime` | `backend/hooks/contract/scopes.mjs`, `backend/hooks/contract/phases.mjs`, `backend/hooks/contract/events.mjs`, `backend/hooks/runtime/registry.mjs`, `backend/hooks/runtime/settings-store.mjs`, `backend/hooks/runtime/register-custom-hooks.mjs`, `backend/hooks/builtin-hook-catalog.mjs`, `static/frontend/settings/ui.js`, `static/frontend/settings/hooks/model.js`, `static/frontend/settings/hooks/ui.js` | layered on hook settings plus `custom-hooks.json` under the current storage root |
| `Workbench state` | `backend/workbench/index.mjs`, `backend/workbench/branch-lifecycle.mjs`, `backend/workbench/queues.mjs`, `backend/workbench/state-store.mjs`, `backend/workbench/continuity-store.mjs`, `backend/workbench/operation-records.mjs`, `backend/workbench/exporters.mjs`, `backend/workbench/node-definitions.mjs`, `backend/workbench/node-settings-store.mjs`, `backend/workbench/graph-model.mjs`, `backend/workbench/task-map-plan-contract.mjs`, `backend/workbench/task-map-plans.mjs`, `backend/workbench/task-map-plan-service.mjs`, `backend/workbench/task-map-plan-sync.mjs`, `backend/workbench/task-map-graph-service.mjs`, `backend/workbench/task-map-surface-service.mjs`, `backend/workbench/node-instance.mjs`, `backend/workbench/node-task-card.mjs`, `backend/workbench/node-task-card-sync.mjs`, `backend/workbench/session-ports.mjs`, `backend/workbench/shared.mjs`, `backend/workbench/project-records.mjs`, `static/frontend/workbench/controller.js`, `static/frontend/workbench/node-contract.js`, `static/frontend/workbench/node-settings-model.js`, `static/frontend/workbench/node-settings-ui.js`, `static/frontend/workbench/node-effects.js`, `static/frontend/workbench/node-instance.js`, `static/frontend/workbench/graph-model.js`, `static/frontend/workbench/graph-client.js`, `static/frontend/workbench/node-capabilities.js`, `static/frontend/workbench/node-task-card.js`, `static/frontend/workbench/task-map-plan.js`, `static/frontend/workbench/surface-projection.js`, `static/frontend/workbench/task-map-clusters.js`, `static/frontend/workbench/task-map-model.js`, `static/frontend/workbench/quest-state.js`, `static/frontend/workbench/task-tracker-ui.js`, `static/frontend/workbench/node-rich-view-ui.js`, `static/frontend/workbench/node-canvas-ui.js`, `static/frontend/workbench/task-map-ui.js`, `static/frontend/workbench/task-list-ui.js`, `static/frontend/workbench/branch-actions.js`, `static/frontend/workbench/operation-record-ui.js` | layered on session/workbench persistence |
| `Compatibility metadata` | `backend/compat/apps.mjs`, `backend/compat/session-meta-compat.mjs` | layered on stored session metadata only |

## Frontend Map

| Concern | Files |
|---|---|
| browser runtime shell | `static/frontend/core/bootstrap-data.js`, `static/frontend/core/app-state.js`, `static/frontend/core/bootstrap.js`, `static/frontend/core/bootstrap-session-catalog.js`, `static/frontend/core/i18n.js`, `static/frontend/core/icons.js`, `static/frontend/core/layout-tooling.js`, `static/frontend/core/realtime.js`, `static/frontend/core/realtime-render.js`, `static/frontend/core/gestures.js`, `static/frontend/core/init.js` |
| HTTP session state | `static/frontend/session/http.js`, `static/frontend/session/http-helpers.js`, `static/frontend/session/http-list-state.js` |
| tool/model picker | `static/frontend/session/tooling.js` |
| composer + attachments | `static/frontend/session/compose.js` |
| session derived state | `static/frontend/session/state-model.js` |
| session list contracts | `static/frontend/session-list/contract.js`, `static/frontend/session-list/order-contract.js` |
| session list model + grouping | `static/frontend/session-list/model.js`, `static/frontend/session-list/ui.js`, `static/frontend/session-list/sidebar-ui.js` |
| session detail rendering | `static/frontend/session/surface-ui.js` |
| shared settings shell | `static/frontend/settings/ui.js` |
| hook settings lifecycle model + UI | `static/frontend/settings/hooks/model.js`, `static/frontend/settings/hooks/ui.js` |
| workbench rendering | `static/frontend/workbench/controller.js`, `static/frontend/workbench/node-contract.js`, `static/frontend/workbench/node-settings-model.js`, `static/frontend/workbench/node-settings-ui.js`, `static/frontend/workbench/node-effects.js`, `static/frontend/workbench/task-map-plan.js`, `static/frontend/workbench/task-map-model.js`, `static/frontend/workbench/quest-state.js`, `static/frontend/workbench/task-tracker-ui.js`, `static/frontend/workbench/task-map-ui.js`, `static/frontend/workbench/task-list-ui.js`, `static/frontend/workbench/branch-actions.js`, `static/frontend/workbench/operation-record-ui.js` |

## Retired Concepts

The following no longer belong in current implementation reasoning:

- `visitor` auth/session flows
- owner-side App/template CRUD
- owner-side User management as a live product surface
- session-level scheduled triggers
- `ShareSnapshot`
- public `/share/*` surfaces

If you encounter them in older notes or legacy data, treat them as historical residue or cleanup targets.
