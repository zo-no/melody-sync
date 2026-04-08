# Session Runtime Architecture

This file maps the current MelodySync session modules into the target runtime layers without changing user-visible behavior.

## Layers

### 1. Core agent loop

- Owns prompt assembly and the model call.
- Inputs:
  - `capability_contract`
  - `session_state`
  - `current_turn`
- The model may decide to read files, search repo, or search memory on demand.

### 2. Kernel hooks

- Own deterministic lifecycle events and effect execution.
- Event examples:
  - `turn.received`
  - `run.started`
  - `run.completed`
  - `run.failed`
  - `session.waiting_user`
- This layer should not become a second prompt assembler.

### 3. Runtime truth

- `events.jsonl`: append-only event history
- `state.json`: current session state
- `run.json`: current run lifecycle state

### 4. Memory store

- `user_memory`
- `project_memory`
- Not injected by default; the agent retrieves it only when useful.

### 5. Projection

- Workbench
- Task map
- Session list cards
- Display-only source metadata

## Current module mapping

### Core agent loop

- `backend/session-manager.mjs`
- `backend/system-prompt.mjs`

### Kernel hooks

- `backend/hooks/runtime/registry.mjs`
- `backend/run-finalization.mjs`
- `backend/runtime-policy.mjs`

### Runtime truth adapters

- `backend/session-runtime/session-state.mjs`
- `backend/session-task-card.mjs` (legacy adapter / compatibility surface)
- `backend/session-continuation.mjs` (derived handoff text only)

### Projection

- `backend/workbench/branch-lifecycle.mjs`
- `backend/workbench/continuity-store.mjs`

## Migration rule

For any existing feature, ask one question first:

`Is this core, kernel, runtime truth, memory, or projection?`

If the answer is "projection", it must not become prompt truth.
