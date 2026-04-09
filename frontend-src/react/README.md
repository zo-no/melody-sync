# MelodySync React shell

This directory is the new React entry surface for a gradual frontend migration.

## Source layout

- `frontend-src/react/src/main.jsx`
- `frontend-src/react/src/App.jsx`
- `frontend-src/react/src/runtime/bootstrap.js`
- `frontend-src/react/src/features/session-list/SessionListPanel.jsx`
- `frontend-src/react/src/features/workbench/WorkbenchPanel.jsx`
- `frontend-src/react/src/styles/app.css`

## Build commands

- `npm run react:build`
- `npm run react:dev`

## Build outputs

The build script writes into `frontend-src/react/dist/`:

- `frontend-src/react/dist/melody-sync-react.js`
- `frontend-src/react/dist/melody-sync-react.css`
- `frontend-src/react/dist/manifest.json`

## Bridge contract

- Bootstrap payload global: `window.__MELODYSYNC_REACT_BOOTSTRAP__`
- Bridge global: `window.MelodySyncReactBridge`
- Default mount selectors:
  - `[data-melodysync-react-root]`
  - `#melodysync-react-root`

## What the main thread needs to do later

1. Keep serving `frontend-src/react/dist/` from the stable `/react/` route.
2. Add a DOM mount target for the React shell.
3. Populate `window.__MELODYSYNC_REACT_BOOTSTRAP__` with session/workbench state.
4. Switch the loader to the new React bundle when the island is ready.
