# Scheduler Domain Architecture

> Status: discussion draft grounded in the current RemoteLab implementation.
> Purpose: decide where scheduled tasks belong in the product model before we keep adding UI and runtime behavior on top of a weak ownership model.
>
> Read together with:
> - `notes/current/scheduled-trigger-phase1.md`
> - `notes/current/core-domain-contract.md`

---

## Why We Need To Revisit This

The current implementation stores `scheduledTriggers` directly on session metadata.

That was a good phase-1 shortcut because it let us ship the smallest real behavior:

```text
session + time + content -> inject content at the right time
```

But the product is already moving beyond that shape.

The user is now thinking in layered concepts:

- system-level work
- app-level work
- bot-level work
- session-level work
- specialized domains such as design / drawing / planning / review

Once these layers exist, "a session owns the scheduled task" stops being a good mental model.

The more correct mental model is:

```text
the system owns tasks
each task targets some object
the object may be a session, bot, app, or workflow
```

That distinction matters because it decides:

- where the scheduler data should live
- what UI is primary
- how future task types fit in cleanly
- whether we can support multiple target layers without awkward hacks

---

## Current Reality In Code

Today the scheduler data is still session-attached.

Relevant places:

- `chat/session-meta-store.mjs`
- `chat/session-manager.mjs`
- `chat/scheduled-triggers.mjs`
- `chat/scheduled-trigger-utils.mjs`

Current shape, simplified:

```text
SessionMeta {
  ...
  scheduledTriggers?: ScheduledTrigger[]
}
```

This gives us three benefits:

1. easy to render from the current session UI
2. easy to inject into the same session later
3. minimal new storage work

But it also creates structural weaknesses:

1. the task has no first-class identity outside the session
2. a task cannot naturally target anything above or beside the session
3. the scheduler center becomes a derived view instead of the primary source of truth
4. ownership, permissions, and future filtering remain session-centric even when the product is no longer session-centric

---

## Core Architectural Judgment

The right split is:

1. `Scheduler engine` is a system capability
2. `Scheduler job` is a first-class domain object
3. `Session` is one possible target type
4. session UI is a shortcut into task creation, not the canonical owner of the task

Put more bluntly:

```text
do not keep growing session.scheduledTriggers as the long-term model
```

It is acceptable as a compatibility layer.
It is not a good long-term domain boundary.

---

## Recommended Domain Model

We should introduce a first-class object:

```text
SchedulerJob
```

Suggested shape:

```json
{
  "id": "job_xxx",
  "name": "Daily report",
  "enabled": true,
  "ownerScope": {
    "type": "system",
    "id": "default"
  },
  "trigger": {
    "type": "daily",
    "timeOfDay": "22:30",
    "timezone": "Asia/Shanghai"
  },
  "target": {
    "type": "session",
    "id": "session_xxx"
  },
  "action": {
    "type": "send_message",
    "content": "请生成今天的日报"
  },
  "runtime": {
    "tool": "",
    "model": "gpt-5"
  },
  "state": {
    "nextRunAt": "2026-03-15T14:30:00.000Z",
    "lastRunAt": "",
    "lastStatus": "",
    "lastError": ""
  },
  "createdAt": "",
  "updatedAt": ""
}
```

This separates five different concerns that are currently blurred together:

1. task identity
2. trigger rule
3. target object
4. execution action
5. runtime/result state

---

## Why This Model Fits RemoteLab Better

RemoteLab is not just "a place with sessions".

It is already becoming a layered operating surface with:

- apps
- users
- tools / bots
- sessions
- workflows
- domain-specific operating modes

That means scheduled work should be able to answer:

- run this session
- run the planning bot
- run the design bot
- run a workflow under an app

If tasks are first-class objects, that becomes normal.
If tasks stay embedded in sessions, every new target type becomes a special case.

---

## Target Model

The important generalization is not "more cron syntax".

The important generalization is:

```text
what can a task target?
```

I recommend we explicitly model target types.

Phase 2 target types:

- `session`
- `app`
- `bot`
- `workflow`

Meaning:

- `session`: inject content into an existing session
- `app`: use the app's default execution entry point
- `bot`: invoke a reusable agent identity rather than a specific transcript
- `workflow`: run a named operational routine

For now we only need to fully implement `session`.
But the data model should already allow the others.

---

## Action Model

We should also separate the target from the action.

A task does not just say "where".
It also says "what to do".

Suggested action types:

- `send_message`
- `create_session_and_send`
- `run_workflow`
- `generate_artifact`

The current implementation is effectively:

```text
target=session
action=send_message
```

That is still the correct first real action type.

But once action is explicit, future growth becomes clean.

---

## Runtime Model

Runtime choices should not be confused with ownership.

These are runtime concerns:

- tool
- model
- effort / reasoning mode

These should sit under a `runtime` object.

Why:

1. some tasks will want defaults
2. some tasks will override only the model
3. some tasks should inherit from the target

That gives us a clear inheritance story:

```text
task runtime override
otherwise target default
otherwise app default
otherwise system default
```

This is cleaner than scattering these choices across session metadata and UI hints.

---

## Where The Scheduler Should Live In The Product

The product should expose the scheduler in two ways:

### 1. Global Task Center

This should be the primary home of scheduled work.

It answers:

- what tasks exist
- what is enabled
- what runs next
- what failed
- how do I pause or run something now

This is the real product center of gravity.

### 2. Local Shortcuts

These are contextual entry points:

- from a session
- from an app
- from a bot page

These shortcuts should create or filter tasks that target that object.

This makes the UI feel natural without making local surfaces own the domain.

---

## What We Should Not Do

There are three tempting but weak paths.

### 1. Keep Session As The Permanent Owner

This makes every future target layer awkward.

### 2. Put Scheduling In The Pure View Layer

This is not a rendering concern.
It is a domain and orchestration concern.

### 3. Jump Directly To A Heavy Automation Graph

That would overshoot the user's actual need.

The right move is:

```text
first-class task objects
simple action model
simple trigger model
system-owned scheduler engine
```

---

## Trigger Model

The trigger shape can remain intentionally small.

We do not need to over-generalize here first.

Good enough set:

- `daily`
- `interval`
- later: `weekly`
- much later: `cron`

The key is that trigger is only one part of the object.
It should not dictate the whole architecture.

---

## Migration Strategy

We do not need a risky rewrite.

Recommended staged migration:

### Step 1. Introduce `SchedulerJob` storage

Add a new store, for example:

```text
chat/scheduler-job-store.mjs
```

Backed by a separate JSON file or durable store.

### Step 2. Keep Session Compatibility

When reading session metadata:

- continue to expose a derived `scheduledTriggers` view if needed
- but source that view from global jobs whose target is this session

### Step 3. Move Runner To Global Jobs

Change sweep logic to read scheduler jobs directly instead of scanning sessions for embedded triggers.

### Step 4. Keep Session UI As A Shortcut

Session page still says:

- create task for this session
- show tasks targeting this session

But saving creates or updates global jobs.

### Step 5. Build True Task Center

At that point the current "all tasks" view stops being a convenience layer and becomes the primary scheduler UI.

---

## Minimal Internal Interfaces

Suggested internal methods:

```text
listSchedulerJobs()
getSchedulerJob(jobId)
createSchedulerJob(input)
updateSchedulerJob(jobId, patch)
deleteSchedulerJob(jobId)
listSchedulerJobsForTarget(targetType, targetId)
runSchedulerJobNow(jobId)
runSchedulerSweep()
```

This is a healthier boundary than mutating session meta directly.

---

## How This Relates To Bots And Apps

This is the part that matters most to the current discussion.

You described a containment relation roughly like:

```text
system
  -> app / domain area
    -> bot / operator
      -> session / conversation instance
```

If that is the product direction, then a task needs to choose which level it binds to.

Examples:

- morning planning task bound to a planning bot
- daily report task bound to a review workflow
- design generation task bound to a drawing bot
- session-specific follow-up task bound to one concrete transcript

This is exactly why "tasks live on session" is too narrow.

---

## Practical Product Decision

So the product answer should be:

1. RemoteLab has one scheduler system
2. that system owns first-class jobs
3. each job points to a target
4. current session scheduling is just one target mode

This gives the user the right mental model:

```text
I create a task once.
I decide what object it belongs to.
RemoteLab keeps running it for me.
```

That is more stable than:

```text
this session happens to have some embedded triggers
```

---

## Recommendation

Do not keep investing in the session-attached task model as if it is the final architecture.

Treat the current implementation as:

- valid MVP
- compatibility layer
- useful UI prototype

But the next real architecture step should be:

```text
extract scheduled work into first-class scheduler jobs
```

That is the cleanest way to support:

- system-level scheduling
- bot-level scheduling
- app-level scheduling
- session-level scheduling

without turning the model into a pile of special cases.

