# Documentation Map

Documentation lives in three places:

- `docs/` — current operational truth: architecture, features, contracts, integrations
- `notes/current/` — internal design notes: domain model, prompt/memory architecture, governance
- `AGENTS.md` — repo-local rules and high-signal context for coding agents

## Read First

When you need the current truth, start here:

1. `../AGENTS.md` — repo rules, constraints, active priorities
2. `project-architecture.md` — shipped architecture and code map
3. `current-features.md` — shipped feature table
4. `../notes/current/core-domain-contract.md` — core domain objects and boundaries

## `docs/` Index

### Architecture & Storage
- `project-architecture.md` — runtime topology, core modules, main flows, persistence layout
- `data-storage-design.md` — **authoritative per-domain storage design**: what each object stores, how, where, and for how long
- `application-storage-architecture.md` — storage value-model principles: canonical/operational/projection/cache/diagnostic classification
- `session-history-storage-layout.md` — physical layout target for `sessions/history/<sessionId>/` (segment migration plan)
- `agent-filesystem-architecture.md` — repo/config/memory filesystem split for agent-facing storage

### Product
- `current-features.md` — shipped feature table and retired surfaces
- `product-vision.md` — product goals and design direction
- `task-system-design.md` — 5 task types, data structures, lifecycle
- `task-type-to-bucket-mapping.md` — task type to sidebar bucket mapping rules
- `output-panel-data-contract.md` — output panel data contract: event taxonomy, blocker capture, recommendations

### Setup & Integrations
- `setup.md` — model-first setup contract
- `external-message-protocol.md` — integration contract for external channels (email, GitHub, chat connectors)
- `voice-connector.md` — wake-word voice connector contract

### Extension Architecture
- `hooks-node-architecture.md` — target hooks + node architecture for lifecycle orchestration

## Keep In Sync

| What changed | Update this |
|---|---|
| Product positioning, user-visible workflow | `../README.md` + `../README.zh.md` |
| Runtime topology, code map, persistence | `project-architecture.md` |
| Storage schema, fields, retention policy | `data-storage-design.md` |
| Shipped features | `current-features.md` |
| Repo rules, protected surfaces | `../AGENTS.md` |
| Domain objects, boundaries | `../notes/current/core-domain-contract.md` |
