# Documentation Map

This repo keeps documentation in four layers:

- `README.md` / `README.zh.md` — top-level product overview, setup path, and daily operations
- `docs/` — current, shareable documentation for humans and contributors
- `notes/` — internal design notes, grouped by status so current truth does not get mixed with future direction or historical rationale
- `AGENTS.md` — repo-local operating rules and high-signal context for coding agents

## Canonical Spine

Read these first when you need the current truth:

1. `../AGENTS.md` — repo rules, constraints, active priorities
2. `../README.md` / `../README.zh.md` — product framing, setup path, operator-facing expectations
3. `project-architecture.md` — current shipped architecture and code map
4. `application-storage-architecture.md` — target app-data storage contract
5. `current-features.md` — current shipped feature table
6. `agent-filesystem-architecture.md` — current repo/config/memory filesystem split for agent-facing storage
7. `../notes/current/core-domain-contract.md` — current domain/refactor baseline
8. `../notes/current/session-first-workflow-surfaces.md` — current workflow-organization contract
9. `../notes/current/product-surface-lifecycle.md` — current keep/iterate/retire rule for shipped product surfaces

## Keep These In Sync

When the system changes, update the matching surface instead of letting discussion notes carry the only truth:

- product positioning, setup flow, or user-visible workflow changes → `../README.md` and `../README.zh.md`
- runtime topology, persistence model, code map, or request flow changes → `project-architecture.md`
- repo rules, self-hosting workflow, or protected surfaces change → `../AGENTS.md`
- domain/refactor baseline changes → `../notes/current/core-domain-contract.md`
- outdated or conflicting notes → trim them or rewrite them to point at the canonical doc

## What Lives In `docs/`

### Current Core

- `project-architecture.md` — top-down map of the shipped system
- `application-storage-architecture.md` — value-based storage contract for app data, runtime capture, caches, and diagnostics
- `session-history-storage-layout.md` — dense physical layout target for transcript storage
- `agent-filesystem-architecture.md` — current repo/config/memory split for agents and runtime durability
- `current-features.md` — current shipped feature table after product-surface cleanup
- `output-panel-data-contract.md` — decision-first output-panel data contract
- `hooks-node-architecture.md` — target hooks + node architecture
- `local-maintenance.md` — upstream-first fork workflow and local runtime isolation rules
- `setup.md` — model-first setup contract

### Focused Integrations

- `external-message-protocol.md` — canonical integration contract for external channels
- `github-auto-triage.md` — model-first GitHub intake and auto-reply rollout contract
- `remote-capability-monitor.md` — remote-agent capability monitoring
- `voice-connector.md` — wake-word speaker/microphone connector contract

### Product Direction

- `product-vision.md` — product vision and design direction
- `task-system-design.md` — task system design: 5 task types and data structures
- `task-type-to-bucket-mapping.md` — task type to bucket mapping rules

## Authoring Rule

Before adding a new doc, ask:

1. Is this current truth or a discussion artifact?
2. Does a shorter update to an existing canonical doc solve it better?
3. Will it still be true after the next refactor, or is it historical rationale?

If the answer is unclear, prefer updating an existing canonical doc over creating a new one.
