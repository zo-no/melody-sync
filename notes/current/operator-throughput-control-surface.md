# Operator Throughput Control Surface

_Last updated: 2026-03-14_

> Status: current product requirement note.
> Purpose: turn the recurring "I cannot push enough work forward fast enough" pain into a concrete RemoteLab requirement.
>
> Read together with:
> - `docs/project-architecture.md`
> - `notes/current/core-domain-contract.md`
> - `notes/directional/product-vision.md`
> - `notes/directional/ai-driven-interaction.md`

---

## Problem

The user's bottleneck is not "lack of another chat window."

The real bottleneck is:

- too many active threads competing for attention
- too many tasks still living in the user's head instead of in RemoteLab state
- too much time lost deciding "what should I touch now?"
- too much restart cost after interruption
- too few system-driven prompts that push stuck work forward

In plain product language:

> RemoteLab should help one operator move more parallel work forward with less mental load.

This is a throughput problem, not a chat-quality problem.

---

## Product Goal

RemoteLab should become a better **operator control surface** for parallel work.

The user should be able to:

1. quickly capture a new task without deciding everything up front
2. see which sessions need attention now
3. push low-value coordination work into the system
4. recover a thread in seconds instead of re-reading the whole transcript
5. keep more work in motion without holding all state in working memory

Success is not "more sessions created."

Success is:

- more sessions meaningfully progressing in parallel
- fewer forgotten or stale threads
- lower restart cost after interruptions
- faster conversion from vague intent to next action

---

## Core Product Insight

The user's real request is not "help me multitask harder."

It is:

> "Help me operate like a dispatcher instead of a constantly context-switching executor."

So the right feature family is not heavy IDE-like interaction.

It is a set of lightweight orchestration features that:

- externalize task state
- surface the next decision
- automate waiting loops
- compress recovery cost

---

## Primary User Stories

### 1. Fast Capture

As an operator,
I want to throw a rough goal into RemoteLab in one shot,
so that I can keep moving instead of manually creating perfect structure first.

Example:

- "跟进这个客户报价"
- "看下这个 bug 为什么线上才出现"
- "把这个想法拆成可执行步骤"

### 2. Attention Routing

As an operator,
I want RemoteLab to tell me which sessions need my attention now,
so that I do not waste time scanning every thread.

### 3. Next Action Recovery

As an operator,
I want each session to expose a short "next action / blocker / waiting on" state,
so that I can resume work in seconds.

### 4. Waiting Loop Automation

As an operator,
I want RemoteLab to re-ping, re-check, or wake a session later,
so that I do not have to remember every follow-up myself.

### 5. Workload Shaping

As an operator,
I want the system to help me distinguish:

- do now
- queue for later
- waiting on someone
- parked

so that everything does not feel equally urgent.

---

## Requirement Summary

This pain should turn into one coherent feature area:

> **Operator Throughput Control Surface**

This area should combine five capabilities.

### A. Inbox Capture

RemoteLab should support a low-friction intake path for rough tasks.

Minimum behavior:

- create a new session from a short rough input
- auto-suggest `name`, `description`, `next action`, `priority`, and `state`
- default the thread into a lightweight triage mode instead of forcing full execution immediately

Why this matters:

- the user often loses speed at capture time
- forcing perfect structure too early reduces throughput

### B. Explicit Session Work State

Each session should expose a small operational state block.

Recommended first-class fields:

- `workflowState`: `active`, `waiting_user`, `waiting_external`, `parked`, `done`
- `workflowPriority`: `high`, `medium`, `low`
- `nextAction`
- `blocker`
- `waitingOn`
- `lastMeaningfulProgressAt`

Important:

- these are control-surface fields, not permission fields
- they should be compact, legible, and model-writable with server validation

Why this matters:

- current title/group/status hints are not enough
- the operator needs stronger "what now?" guidance

### C. Attention Queue

RemoteLab should derive a focused operator queue from session state.

This is not a generic dashboard.

It is a compact list answering:

1. what needs a decision now?
2. what is blocked?
3. what became stale?
4. what finished and only needs review?

Suggested sections:

- `Needs your decision`
- `Waiting but stale`
- `Ready to dispatch`
- `Recently completed`

Why this matters:

- throughput dies when every session looks equally alive
- the operator needs ranking, not raw volume

### D. Scheduled Follow-Up / Wake-Up

RemoteLab should let the user or model create future re-entry points.

First useful forms:

- remind me to check this session later
- re-inject a follow-up prompt at a chosen time
- ask the AI to revisit a parked session tomorrow morning

This should build on the scheduled-trigger direction rather than creating a separate product universe.

Why this matters:

- many tasks are not hard, they are just easy to forget
- reliable deferred wake-ups increase practical parallelism

### E. Resume Package

Each session should maintain a very short operator-facing recovery package.

Recommended contents:

- objective
- current state
- next action
- blocker / waiting on
- last meaningful progress

This is separate from deep transcript history and separate from model continuation context.

Why this matters:

- users lose time reconstructing why a thread mattered
- short recovery state is one of the highest leverage throughput features

---

## Proposed MVP

The first implementation should stay narrow.

Do not try to solve full project management.

### MVP Slice

1. add richer session work-state fields
2. expose a compact "Needs Attention" queue in the main session list
3. let the agent update `nextAction`, `blocker`, and waiting state
4. add one-tap "remind / wake this session later"
5. show a short resume package on session open

If these five pieces work well, the user can already run more parallel threads with less cognitive overhead.

---

## Detailed MVP Requirements

### 1. Session Metadata Expansion

Extend session metadata with:

- `workflowState`
- `workflowPriority`
- `nextAction`
- `blocker`
- `waitingOn`
- `lastMeaningfulProgressAt`

Constraints:

- all fields are optional
- server remains authoritative for validation
- state should be patchable without creating fake transcript content

### 2. Agent-Writable Operational Updates

The model should be able to propose or write operational session metadata through a stable surface.

Examples:

- mark a session `waiting_user` after a real question is asked
- mark a session `waiting_external` after the system schedules a later check
- mark a session `parked` when it is intentionally deferred
- update `nextAction` after completing a major step

### 3. Attention Queue in Sidebar / Session List

The list surface should support a derived filter or grouped lane showing:

- sessions needing immediate operator input
- stale waiting sessions
- sessions ready for next dispatch

The UI should stay compact and mobile-first.

This should feel like triage, not like a project management suite.

### 4. Session Wake-Up

Allow a session-level deferred wake-up action.

First version can be simple:

- `Later today`
- `Tomorrow morning`
- `Tomorrow afternoon`
- custom time

Behavior:

- store a scheduled trigger
- at run time, inject a follow-up prompt or notification into that session

### 5. Resume Card

When opening a session, show a compact recovery block near the top:

- `Goal`
- `Status`
- `Next`
- `Blocked by`
- `Last progress`

This should let the operator decide in a few seconds whether to:

- act now
- leave it waiting
- re-route it
- archive it

---

## Suggested UX Principles

### 1. Optimize For Dispatch, Not Reading

The operator should usually decide from summary state first.
Transcript details are on demand.

### 2. Keep Mobile Interaction Short

Most actions should be one tap or one short phrase:

- `do this now`
- `remind tomorrow`
- `waiting on me`
- `park this`

### 3. Use Strong Operational Language

Good labels:

- `Needs decision`
- `Waiting on you`
- `Waiting on external`
- `Next action`
- `Stale`

Bad labels:

- vague decorative statuses
- ambiguous productivity language
- overloaded project-management jargon

### 4. Avoid Heavy Dashboard Drift

Do not turn this into:

- a calendar-first product
- a kanban clone
- a generic task database

RemoteLab should remain session-first.

---

## What Not To Do

This requirement should **not** be interpreted as:

- "build a full PM tool inside RemoteLab"
- "build a mobile IDE"
- "add lots of manual fields the user must maintain"
- "make every session a giant form"
- "turn the sidebar into a bloated analytics dashboard"

The point is to reduce operator overhead, not create more bookkeeping.

---

## Relationship To Existing Direction

This requirement sharpens several already-existing threads in the repo.

### Product Vision

`notes/directional/product-vision.md` already identifies "并发 Session 的认知负担" as a core problem.

This note turns that into implementation-oriented product requirements.

### AI-Driven Interaction

`notes/directional/ai-driven-interaction.md` already points toward richer session metadata and deferred follow-up orchestration.

This note says which of those are most valuable for operator throughput.

### Deferred Follow-Up

This note explains why wake-up / follow-up is essential for parallel work management, not just for reminders.

---

## Implementation Phasing

### Phase 1

- add metadata fields
- improve session summarizer/state inference
- add attention queue views
- expose resume card

### Phase 2

- add wake-up actions and scheduled follow-up
- let the model maintain waiting-state freshness
- add stale-session detection

### Phase 3

- add rough-task inbox capture
- allow dispatcher-style batch triage
- allow app-level intake policies for certain recurring task types

---

## Success Metrics

The feature is working if it improves operator throughput in concrete ways.

Useful product metrics:

- number of sessions with explicit `nextAction`
- number of sessions with explicit waiting state
- time from opening session to sending next instruction
- number of stale sessions revived by wake-up
- number of user-visible decisions routed through the attention queue

Qualitative success signals:

- the user says "I can keep more threads alive"
- the user scans less and dispatches faster
- the user forgets fewer follow-ups
- session reopening feels fast instead of mentally expensive

---

## One-Sentence Product Framing

If this requirement needs a single sentence to guide product and implementation, use this:

> RemoteLab should help one operator keep more AI work moving in parallel by turning session state, attention routing, follow-up timing, and context recovery into a compact control surface.
