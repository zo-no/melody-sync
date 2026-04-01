# Documentation Map

This repo now keeps documentation in four layers:

- `README.md` / `README.zh.md` — top-level product overview, setup path, and daily operations
- `docs/` — current, shareable documentation for humans and contributors
- `notes/` — internal design notes, grouped by status so current truth does not get mixed with future direction or historical rationale
- `AGENTS.md` — repo-local operating rules and high-signal context for coding agents

## Canonical Spine

Read these first when you need the current truth:

1. `../AGENTS.md` — repo rules, constraints, active priorities
2. `../README.md` / `../README.zh.md` — product framing, setup path, operator-facing expectations
3. `project-architecture.md` — current shipped architecture and code map
4. `current-features.md` — current shipped feature table
5. `../notes/current/core-domain-contract.md` — current domain/refactor baseline
6. `../notes/current/session-first-workflow-surfaces.md` — current workflow-organization contract for session list / grouping / task-like views
7. `../notes/current/product-surface-lifecycle.md` — current keep/iterate/retire rule for shipped product surfaces
8. `../notes/current/session-run-closure-requirements.md` — next-stage task closure direction after the current refactor line
9. `structural-cleanup-plan.md` — staged cleanup contract for removing residue without breaking the main session flow
10. `setup.md` / `external-message-protocol.md` / other focused guides as needed

For the current internal note grouping, also see:

- `../notes/current/README.md`

If you want to understand how the docs should be managed as a project system rather than a file pile, also read:

- `../notes/current/documentation-flywheel.md`

## Keep These In Sync

When the system changes, update the matching surface instead of letting discussion notes carry the only truth:

- product positioning, setup flow, or user-visible workflow changes → `../README.md` and `../README.zh.md`
- runtime topology, persistence model, code map, or request flow changes → `project-architecture.md`
- repo rules, self-hosting workflow, or protected surfaces change → `../AGENTS.md`
- domain/refactor baseline changes → `../notes/current/core-domain-contract.md`
- outdated or conflicting notes → trim them, archive them, or rewrite them to point at the canonical doc

## Model-First Docs Principle

For setup, deployment, connector, and feature-rollout docs, assume the operator is human but the configured system is an AI toolchain.

- the default human action is to copy a prompt into their own AI coding agent
- the AI should try to collect all required context in one early handoff instead of spreading questions across many turns
- the main execution should stay inside that chat, not in the document
- the document should explicitly mark only the steps that truly require a human with `[HUMAN]`
- a good doc includes the prompt, one-round input packet, target state, exact config artifacts or paths, and concise validation
- avoid full command-by-command walkthroughs for steps the AI can execute or repair on its own
- write for low-interruption handoff: the human should usually be able to answer once, walk away, and return only for approvals, browser-only actions, checks, or final handoff

## What Lives In `docs/`

### Current Core

- `project-architecture.md` — top-down map of the shipped system
- `current-features.md` — current shipped feature table after product-surface cleanup
- `structural-cleanup-plan.md` — staged cleanup plan for in-place simplification and refactor work
- `local-maintenance.md` — upstream-first fork workflow, branch hygiene, and local runtime isolation rules
- `setup.md` — model-first setup contract, one-round input handoff, human checkpoints, and target state
- `external-message-protocol.md` — canonical integration contract for external channels
- `../notes/current/session-first-workflow-surfaces.md` — current rule that workflow-organization views stay session-first
- `../notes/current/product-surface-lifecycle.md` — current rule that shipped features stay reviewable and may later be simplified or retired
- `../notes/current/session-run-closure-requirements.md` — next-stage task-closure and workbench direction

### Product Direction And Internal Maps

- `../notes/current/README.md` — current internal note map and grouping
- `../notes/current/documentation-flywheel.md` — how docs should drive product, refactor, implementation, and cleanup
- `../notes/current/core-domain-contract.md` — current domain contract
- `../notes/current/core-domain-implementation-mapping.md` — current code/object mapping
- `../notes/current/core-domain-refactor-todo.md` — active refactor backlog

### Focused Integrations

- `cloudflare-email-worker.md` — model-first Cloudflare Email Worker deployment contract
- `feishu-bot-setup.md` — model-first operator + console contract for the RemoteLab Feishu connector
- `github-auto-triage.md` — model-first GitHub intake and auto-reply rollout contract
- `remote-capability-monitor.md` — remote-agent capability monitoring backed by the core session API
- `tunnel-diagnostics.md` — Cloudflare Tunnel latency probe workflow for separating app cost from edge/tunnel cost
- `voice-connector.md` — model-first wake-word speaker/microphone connector contract for RemoteLab

## What Lives In `notes/`

See `../notes/README.md` for the note taxonomy.

Short version:

- `../notes/current/` — current baseline notes that still matter operationally
- `../notes/directional/` — future-facing design direction
- keep machine-specific state and stale investigations out of the repo unless they still need to be shared

## Authoring Rule

Before adding a new doc, ask:

1. Is this current truth or a discussion artifact?
2. Does a shorter update to an existing canonical doc solve it better?
3. Is it for users/operators, or for internal design work?
4. Will it still be true after the next refactor, or is it historical rationale?

If the answer is unclear, prefer:

- `README.md` / `README.zh.md` for user-facing overview and setup
- `docs/` for current operational truth
- `notes/directional/` for future design
- PR/commit history for investigations that no longer need an in-repo note

For any new feature doc that describes enabling, wiring, or operating a capability, default to the same pattern:

- copyable prompt first
- one-round input collection second
- autonomous AI execution next
- explicit `[HUMAN]` checkpoints only when unavoidable
