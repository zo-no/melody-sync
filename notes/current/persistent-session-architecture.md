# Persistent Session Architecture

Status: current

## Decision

MelodySync keeps `Session` as the only durable work object.

Long-lived automation and reusable skills are therefore modeled as:

- session metadata on the canonical session
- not as a new top-level durable `Task` or `Skill` object

The persisted truth lives in `sessions/chat-sessions.json` under `session.persistent`.

## Storage Shape

`session.persistent` is the durable definition block.

Current shape:

```json
{
  "version": 1,
  "kind": "recurring_task | skill",
  "state": "active | paused",
  "promotedAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "digest": {
    "title": "stable title",
    "summary": "summary of prior operation history",
    "goal": "main goal",
    "keyPoints": ["durable memory"],
    "recipe": ["execution hints"]
  },
  "execution": {
    "mode": "in_place",
    "runPrompt": "default execution prompt",
    "lastTriggerAt": "ISO timestamp",
    "lastTriggerKind": "manual | schedule"
  },
  "runtimePolicy": {
    "manual": {
      "mode": "follow_current | session_default | pinned",
      "runtime": {
        "tool": "optional pinned tool",
        "model": "optional pinned model",
        "effort": "optional pinned effort",
        "thinking": false
      }
    },
    "schedule": {
      "mode": "session_default | pinned",
      "runtime": {
        "tool": "optional pinned tool",
        "model": "optional pinned model",
        "effort": "optional pinned effort",
        "thinking": false
      }
    }
  },
  "recurring": {
    "cadence": "daily | weekly",
    "timeOfDay": "HH:MM",
    "weekdays": [0, 1, 2],
    "timezone": "IANA timezone string",
    "nextRunAt": "ISO timestamp",
    "lastRunAt": "ISO timestamp"
  },
  "skill": {
    "lastUsedAt": "ISO timestamp"
  }
}
```

`group = 长期任务` remains a list-grouping facet only.
The real subtype lives in `persistent.kind`.

## Why Not Workbench State

`workbench/` is currently used for:

- projections
- continuity overlays
- branch context
- optional graph/task-map state

Persistent long-lived definitions are session truth, not projection truth.
Putting them in `workbench/` would split authority and violate the current session-first rule.

## Current Execution Model

Both persistent kinds currently execute `in_place` on the defining session.

This is the current shipped tradeoff:

- simpler durable model
- straightforward manual rerun
- lightweight scheduler path for recurring tasks

Future upgrade path:

- keep `session.persistent` as the definition truth
- move execution of recurring tasks to derived run sessions when transcript noise becomes a real product problem

## Promotion Flow

Promotion is explicit and action-based:

- `POST /api/sessions/:id/promote-persistent`

Promotion does four things:

1. reads current session history/task-card context
2. derives a durable digest
3. writes `session.persistent`
4. moves the session into `group = 长期任务`

Current UX entrypoints:

- primary CTA lives in the quest tracker action area as `沉淀为长期项`
- operation record keeps a secondary CTA for the same flow
- the click does not write immediately; it opens a lightweight confirm/config card

That confirm card:

- shows the auto-derived digest preview first
- asks the user to choose `长期技能` vs `周期任务`
- captures the runtime strategy before persistence

## Runtime Flow

Manual execution:

- `POST /api/sessions/:id/run-persistent`

Runtime policy rules:

- `skill.manual.mode = follow_current` is the default so skills survive provider switching
- `recurring_task.manual.mode = follow_current` is also allowed for ad hoc reruns
- `recurring_task.schedule.mode` cannot follow the current UI runtime; it must use either:
  - `session_default`
  - `pinned`

Recurring schedule:

- lightweight in-process scheduler scans `persistent.recurring.nextRunAt`
- busy sessions are skipped instead of queueing duplicate scheduled runs
- missed schedules collapse to one next execution; no backlog replay

## Edge Rules

- archived sessions cannot be promoted or executed
- busy sessions cannot start a persistent run
- paused recurring tasks do not auto-run
- missing recurring schedule config is rejected
- schedule changes recompute `nextRunAt`
- clearing `persistent` removes the long-lived definition but does not delete session history
