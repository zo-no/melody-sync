# Scheduled Trigger Phase 1

> Status: near-term implementation slice.
> Purpose: define the first real RemoteLab scheduler capability without mixing it with the frontend focus timer.
>
> Read together with:
> - `notes/directional/timer-capability.md`
> - `notes/current/core-domain-contract.md`

---

## What This Is

This is **not** a pomodoro timer.

This is **not** primarily a diary reminder.

This is:

**a platform capability that lets RemoteLab execute a predefined task at specific times.**

The key product sentence is:

> At a time I choose, RemoteLab should automatically do a task I previously defined.

Examples:

- Every day at 09:00, ask the planning session to generate today’s priorities.
- Every day at 22:30, ask the review session to run a structured retrospective.
- Every Monday at 10:00, create a weekly-review session and seed it with a prompt.

---

## Phase 1 Product Goal

The first shipped version should solve exactly one problem:

**let a user schedule one recurring prompt injection into an existing session.**

Put more bluntly:

> at a chosen time, RemoteLab sends a predefined piece of content into a target session so the agent wakes up and starts working.

Not:

- general cron
- dependency graph
- arbitrary workflow automation
- multi-step pipelines
- external integrations

Those can come later.

---

## The Real Lightweight Requirement

The user does **not** need a heavy scheduler.

The user needs only this:

1. choose a time
2. choose a target session
3. write a piece of content
4. let RemoteLab inject that content at the right time

That means the first useful slice is:

```text
time trigger -> content injection -> agent wakes up
```

Not:

- full automation platform
- visual workflow builder
- general job queue product
- complex recurrence engine
- separate calendar UI

This is important because it keeps the first version product-shaped instead of infrastructure-shaped.

---

## Core User Story

As a RemoteLab user,
I want to choose a session, a time, and a prompt,
so that RemoteLab automatically runs that task for me at the right time,
even if I am not currently on the page.

---

## Phase 1 Domain Shape

Introduce one new object:

```text
ScheduledTrigger
```

Phase 1 fields:

- `id`
- `principalId`
- `sessionId`
- `label`
- `prompt`
- `timezone`
- `recurrenceType` = `daily`
- `timeOfDay` = `HH:MM`
- `enabled`
- `lastRunAt`
- `lastRunStatus`
- `lastError`
- `nextRunAt`
- `createdAt`
- `updatedAt`

Phase 1 deliberately does not need:

- weekly rules
- cron expressions
- multi-target fanout
- conditional triggers
- output branching

---

## What The Trigger Actually Does

When the scheduled time arrives:

1. resolve the target session
2. inject the predefined content as an automation-origin message
3. let the session run as a normal run
4. record success or failure
5. compute the next run time

That means the first action type can be just:

```text
actionType = "session_prompt"
```

This is enough for the first version.

In even simpler product language:

```text
send content to a session at a time
```

That is the real MVP.

---

## What The User Must Be Able To See

The user should always be able to answer these questions:

1. What is the next scheduled task?
2. When will it run?
3. What did it do last time?
4. Did it fail?
5. How do I pause it?

If these answers are not visible, the capability will feel unsafe and opaque.

---

## Recommended User Flow

### Flow A: Create From Session

This should be the primary entry point.

1. User opens a session such as `Daily planning`.
2. User taps `Schedule`.
3. User fills:
   - label
   - daily time
   - timezone
   - prompt
4. User saves.
5. Session header immediately shows:
   - `Daily 09:00`
   - `Next in 12h`
   - `Enabled`

### Flow B: Daily Overview

When the user opens RemoteLab, they should see:

- next scheduled trigger
- how many completed today
- which one needs attention

This is not primarily an editing surface. It is a confidence surface.

### Flow C: Review Result

After a run, the user should be able to open the target session and see:

- that the run was scheduler-triggered
- the prompt that was injected
- the resulting output
- whether the run succeeded or failed

---

## Recommended UI Placement

### 1. Session Header

Show a compact schedule chip here.

Example:

- `Daily 09:00`
- `Next 3h`
- `Last done 20h ago`

This is where users form trust that a given session is “time-driven.”

### 2. Sidebar / Today Summary

Show a lightweight global summary here.

Example:

- `Next: Daily planning in 2h`
- `2 completed today`
- `1 needs attention`

This is where users form trust in the system as a whole.

### 3. Schedule Editor Drawer

Open this from the session header.

Fields:

- label
- enabled
- daily time
- timezone
- prompt

Keep it narrow and obvious.

Do not start with a giant scheduling dashboard.

---

## Recommended UI Style

The UI should feel like **operational status**, not like a calendar app.

Use:

- small chips
- compact rows
- strong time formatting
- explicit status labels

Good examples of display language:

- `Daily 09:00`
- `Next in 2h 14m`
- `Last run: completed`
- `Paused`
- `Failed 8m ago`

Avoid:

- cron syntax as the primary display
- huge calendar surfaces
- overly decorative dashboards

---

## Non-Goals For Phase 1

Phase 1 should explicitly avoid:

- “build a general automation platform”
- “solve all reminder use cases”
- “support every recurrence type”
- “introduce graph automation”
- “make timers a separate first-class app”
- “ship a heavy scheduler UI”

The point is to prove one valuable path, not to ship a generic scheduler framework too early.

---

## Product Risks To Watch

### 1. Invisible Failure

If a trigger fails and the user cannot easily see it, trust collapses.

### 2. Too Much Configuration

If the first setup requires too many choices, users will not create triggers.

### 3. Wrong Default Time Semantics

You must decide clearly whether the schedule follows:

- stored user timezone
- machine timezone

Phase 1 should default to stored user timezone.

### 4. Over-Automation Too Early

If the trigger can do too much, the system will feel risky.

Phase 1 should only inject a prompt into a known session.

---

## What Success Looks Like

Phase 1 is successful if:

1. users create at least one daily trigger without confusion
2. users can see next run / last run / failure state without digging
3. users trust the system enough to let it run unattended
4. the triggered session output is genuinely useful

---

## Sharpest First Version

If this needs to be reduced to one sentence:

**A user picks a session, a daily time, and a prompt; RemoteLab runs that task automatically and visibly every day.**

If this needs to be reduced even further:

**At a chosen time, send a predefined piece of content into a session so the agent starts working.**
