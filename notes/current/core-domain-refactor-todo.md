# Core Domain Refactor Todo

This is the active refactor backlog after removing share/visitor support.

## Current priorities

1. Split `chat/session-manager.mjs` by responsibility.
   - prompt building
   - session metadata mutation
   - fork/delegate/template flows
   - run invalidation and broadcast logic

2. Keep frontend state owner-only and remove stale compatibility globals early.
   - avoid reintroducing special-case auth modes
   - keep `static/chat/` modules moving toward explicit boundaries

3. Continue route decomposition.
   - keep `chat/router.mjs` as thin dispatch
   - move focused route families into dedicated modules

4. Reduce stale data tolerance.
   - treat old share/visitor fields as legacy residue only
   - avoid new code that branches on retired concepts

5. Keep App semantics narrow.
   - Apps are reusable owner-side templates
   - do not let Apps drift back into access-control or publication objects

## Explicitly retired backlog

Do not revive old work items around:

- public share snapshots
- visitor auth/principal models
- share-token App entry
- share storage redesign

Those plans belong to a retired product path.
