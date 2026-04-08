# Core Domain Refactor Todo

This is the active refactor backlog for simplifying the shipped session-first product.

## Current priorities

1. Split `backend/session/manager.mjs` by responsibility.
   - prompt building
   - session metadata mutation
   - fork/delegate flows
   - run invalidation and broadcast logic

2. Remove retired surfaces and stale compatibility state from the main path.
   - avoid reintroducing App/User/Trigger product behavior
   - delete stale frontend globals and dead route families early

3. Continue route decomposition.
   - keep `backend/router.mjs` as thin dispatch
   - move focused route families into dedicated modules

4. Reduce stale data tolerance.
   - treat old share/visitor fields as legacy residue only
   - treat `appId` / `appName` / `userId` / `userName` as passive metadata only
   - avoid new code that branches on retired concepts

5. Converge frontend state around explicit session buckets.
   - session catalog
   - active session snapshot
   - run/activity state
   - local UI preferences

6. Isolate workbench and integration logic from the primary chat path.
   - keep workbench layered on sessions instead of driving core assumptions
   - keep connector/source logic descriptive instead of structural

## Explicitly retired backlog

Do not revive old work items around:

- App/template restoration
- User management restoration
- session-level trigger restoration
- public share snapshots
- visitor auth/principal models
- share-token App entry
- share storage redesign

Those plans belong to a retired product path.
