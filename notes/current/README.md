# Notes Index

Internal design notes that are still operationally relevant. If a note no longer serves the current main line, delete it or merge its conclusions into a canonical doc.

## Read Order

1. `core-domain-contract.md` — core domain objects (Session, Run, Source) and their boundaries
2. `core-domain-implementation-mapping.md` — domain objects mapped to current code files
3. `hooks-and-node-structure.md` — current hooks, task map node kinds, operation record panel structure
4. `session-first-workflow-surfaces.md` — constraint: workflow views must derive from Session, not parallel objects
5. `feature-and-settings-inventory.md` — feature audit: main flow / settings / hidden / deletion candidates

## All Notes

### Domain & Architecture
- `core-domain-contract.md` — update when product boundaries change
- `core-domain-implementation-mapping.md` — update when code structure changes significantly
- `persistent-session-architecture.md` — Session as the only persistent work object
- `session-first-workflow-surfaces.md` — long-term constraint for workbench / task map design

### Workbench & Hooks
- `hooks-and-node-structure.md` — update when hooks, node kinds, or operation record panel changes

### Prompt & Memory
- `core-domain-session-prompts.md` — prompt build rules; read when touching prompt construction
- `memory-activation-architecture.md` — memory activation layering; read when touching memory load
- `prompt-layer-topology.md` — prompt stack topology; read when touching prompt assembly

### Product Governance
- `feature-and-settings-inventory.md` — update when product surface or deletion candidates change

### Engineering
- `self-hosting-dev-restarts.md` — restart recovery strategy for local development
