## Context Topology

Treat the live context stack as a small working tree, not one flat prompt:

- **Seed / constitution**: editable startup defaults, principles, and capability framing.
- **Continuity / handoff**: current workstream state, accepted decisions, open loops, and next-worker entry point.
- **Scope**: the relatively stable background for the current project or recurring domain.
- **Task**: the current delta inside that scope — what this session is doing now.
- **Side resources**: skills and shared learnings loaded only when relevant.
- **Archive**: cold history, not default live context.

## Session Continuity

- Handoffs capture where the current workstream stands: execution state, accepted decisions, tool/branch state, blockers, and the next good entry point.
- Do not let task notes become a dumping ground for transient session residue.
- Treat stale tool results and raw transcript fragments as conversation residue, not durable memory.
- When resuming, switching tools, compacting context, or spawning child sessions, use continuity/handoff context to preserve the thread.

## Session-First Routing

- Bounded work should prefer bounded context. Sessions are workstream containers, not just chat transcripts.
- Stay in the current session by default when one clear goal still owns the work.
- Use forked or delegated child sessions only when they materially improve context hygiene, parallel progress, or task tracking.
- Do not look for or invent App templates, base sessions, public share flows, or scheduled triggers. Those product surfaces are removed from MelodySync.
- Legacy `appId`, `appName`, or template-flavored metadata may still appear in stored data. Treat them as compatibility residue, not as active routing instructions.
- When work splits into separate goals, keep each child session tightly scoped to one focused objective.
- Do not force delegation for small, tightly coupled, or obviously sequential work.

## Delegation And Child Sessions

MelodySync can spawn a child session when work should split for context hygiene or real parallel progress. Use `melodysync session-spawn --task "<focused task>" --json` (or `--wait` to block for the result). Split only when it materially reduces context pressure or enables real parallelism — not for every substep.

The shell env exposes `MELODYSYNC_SESSION_ID`, `MELODYSYNC_CHAT_BASE_URL`, and `MELODYSYNC_PROJECT_ROOT` for fallback invocation.

## GTD Persistent Task Management

MelodySync has a built-in GTD task system for recurring, scheduled, and waiting tasks.

API base: `$MELODYSYNC_CHAT_BASE_URL` (default: `http://127.0.0.1:{{CHAT_PORT}}`).

Task kinds:
- `recurring_task` — AI 循环执行的长期任务（必须有 `recurring` 配置）
- `scheduled_task` — AI 在固定时间点执行一次（必须有 `scheduled.runAt`）
- `waiting_task` — 人类触发的等待任务（无时间点）
- `skill` — 手动快捷按钮

**Quick API reference** (base: `$MELODYSYNC_CHAT_BASE_URL`, default `http://127.0.0.1:{{CHAT_PORT}}`):

```bash
# Create recurring task
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" -H "Content-Type: application/json" -d '{
  "name": "任务名", "folder": "~/.melodysync/runtime", "tool": "claude",
  "persistent": {"kind":"recurring_task","digest":{"title":"任务名","summary":"摘要"},
    "execution":{"mode":"in_place","runPrompt":"每次执行做什么"},
    "recurring":{"cadence":"daily","timeOfDay":"09:00","timezone":"Asia/Shanghai"}}}'

# Create waiting task
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" -H "Content-Type: application/json" -d '{
  "name": "等待：描述", "folder": "~/.melodysync/runtime", "tool": "claude",
  "persistent": {"kind":"waiting_task","digest":{"title":"等待：描述","summary":"等待原因"},
    "execution":{"mode":"in_place","runPrompt":"人类触发后做什么"}}}'

# Mark current session done
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/$MELODYSYNC_SESSION_ID" \
  -H "Content-Type: application/json" -d '{"workflowState":"done"}'

# List tasks
curl -s "$MELODYSYNC_CHAT_BASE_URL/api/sessions?view=refs"
```

Full API details (scheduled tasks, skills, project membership, triggers) are injected when working in a persistent task context. When in doubt, create a `waiting_task` to capture the intent and refine later.
