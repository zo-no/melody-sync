# Output Panel Data Contract

Status: current product/data contract for evolving the output panel from a retrospective dashboard into an attention-routing surface.

## Why this exists

The output panel should not primarily answer "how busy was I".

It should answer:

1. what should I move now,
2. what is blocked on me,
3. what is leaking my attention,
4. which next action has the highest leverage.

That means data collection must start from user decisions, not from whatever the system already happens to log.

## Product stance

The panel is an owner-facing decision surface.

It is not:

- a vanity analytics page,
- a time-spent tracker,
- a token or message counter,
- or a generic PM/reporting dashboard.

The highest-value use is to reduce hesitation and attention thrash at the moment the owner opens the app.

## Primary decision questions

The panel should organize its data around four decisions:

1. `What should I do now?`
2. `Why is progress blocked?`
3. `What should be paused, merged, or dropped?`
4. `Which action is most leveraged?`

Everything else, including trend scores, is secondary evidence.

## Data layers

### 1. Outcome data

Purpose: establish whether real output happened.

Examples:

- main task completed,
- branch resolved or merged,
- artifact created,
- artifact published or delivered,
- summary/conclusion promoted into durable knowledge.

Trust level: highest.

If this layer is weak, the panel is measuring activity rather than output.

### 2. Progress data

Purpose: determine whether work is moving forward even before final completion.

Examples:

- checkpoint changed,
- next step changed,
- workflow state changed,
- task resumed from parked state,
- branch entered or returned,
- progress interval between touches.

Trust level: medium-high.

This layer supports "is this moving?" but does not prove value on its own.

### 3. Attention-load data

Purpose: estimate whether the owner is over-distributed.

Examples:

- active main-line session count,
- active branch count,
- focus switches,
- stale active tasks,
- waiting-on-user task count,
- parked backlog age.

Trust level: medium.

This layer should explain overload, not punish parallelism when parallelism is actually useful.

### 4. Blocker data

Purpose: explain why output did not happen.

Examples:

- waiting for user decision,
- waiting for information,
- waiting for approval,
- waiting for external dependency,
- unclear success criteria.

Trust level: medium-high when explicitly tagged, lower when inferred.

This layer is critical because without it the panel can describe stuck work but cannot explain it.

### 5. Calibration data

Purpose: learn whether the panel's recommendations are useful.

Examples:

- recommendation shown,
- recommendation opened,
- recommendation accepted,
- recommendation dismissed,
- recommendation produced downstream progress or not.

Trust level: medium.

Without this layer, the panel can rank tasks but cannot improve its own ranking quality.

## Do not use these as primary output metrics

These can help with diagnostics, but should not be treated as output truth:

- message count,
- token count,
- session count by itself,
- time online,
- page views,
- number of AI runs,
- raw event volume.

These are effort or traffic signals, not outcome signals.

## Entity model

The panel should normalize data around a small set of entities:

- `work item` — usually a session-backed main task or branch task
- `artifact` — a concrete output such as a document, file, published message, merged summary, or exported result
- `blocker` — the current reason a work item cannot move
- `recommendation` — a panel suggestion presented to the owner

Recommended stable identifiers:

- `sessionId`
- `rootSessionId`
- `workItemId`
- `artifactId`
- `blockerId`
- `recommendationId`

For now, `workItemId` may equal `sessionId` for simple tasks and branch sessions.

## Shared event envelope

Every output-panel event should use one shared envelope:

```json
{
  "eventId": "evt_...",
  "eventType": "task_state_changed",
  "occurredAt": "2026-04-09T11:24:00.000Z",
  "actor": "user",
  "source": "system",
  "sessionId": "sess_...",
  "rootSessionId": "sess_root_...",
  "workItemId": "sess_...",
  "lineRole": "main",
  "confidence": 1
}
```

Required shared fields:

- `eventId`
- `eventType`
- `occurredAt`
- `actor`
- `source`
- `sessionId`
- `rootSessionId`
- `workItemId`

Recommended shared fields:

- `lineRole`
- `workflowState`
- `confidence`
- `reason`
- `trace`

Field guidance:

- `actor` should be one of `user`, `agent`, `system`, `hook`
- `source` should describe the capture path such as `system`, `manual_tag`, `frontend`, `hook`, `derived`
- `confidence` should only drop below `1` for inferred events

## Phase-1 minimum event set

The first implementation should start with seven event types.

These are enough to support useful attention routing without over-instrumenting the product.

| Event | Layer | Trigger | Required fields | Why it matters |
| --- | --- | --- | --- | --- |
| `task_state_changed` | progress | workflow state, line role, or branch status changed | `fromState`, `toState` | establishes lifecycle motion |
| `checkpoint_updated` | progress | current checkpoint materially changed | `previousCheckpoint`, `nextCheckpoint` | shows forward movement, not just touches |
| `blocker_updated` | blocker | waiting reason or blocker type changed | `blockerType`, `isBlocking`, `ownerActionRequired` | explains stuck work |
| `artifact_created` | outcome | a durable result was created or linked | `artifactId`, `artifactType`, `artifactTitle` | establishes output truth |
| `focus_switched` | attention-load | owner switched active task focus | `fromWorkItemId`, `toWorkItemId` | supports overload detection |
| `recommendation_shown` | calibration | panel surfaced a recommendation | `recommendationId`, `recommendationType`, `targetWorkItemId` | starts recommendation measurement |
| `recommendation_accepted` | calibration | owner explicitly acted on a recommendation | `recommendationId`, `targetWorkItemId` | closes the loop between ranking and behavior |

## Phase-2 recommended event set

After phase 1 is stable, add these events:

| Event | Layer | Trigger | Required fields |
| --- | --- | --- | --- |
| `branch_entered` | progress | owner or system moved into a branch session | `parentWorkItemId`, `branchWorkItemId` |
| `branch_resolved` | outcome | branch finished and returned or merged | `branchWorkItemId`, `resolutionType` |
| `next_step_updated` | progress | next actionable step materially changed | `previousNextStep`, `nextNextStep` |
| `blocker_cleared` | blocker | active blocker removed | `blockerId`, `blockerType` |
| `recommendation_dismissed` | calibration | owner rejected a recommendation | `recommendationId`, `dismissReason` |
| `recommendation_result_observed` | calibration | recommendation later led or failed to lead to progress | `recommendationId`, `outcomeType` |

## Event definitions

### `task_state_changed`

Use when:

- workflow state changes between active, waiting, parked, or done
- branch status changes between active, parked, resolved, or merged

Required fields:

- `fromState`
- `toState`

Optional fields:

- `stateDimension` such as `workflow` or `branch`
- `changeReason`

### `checkpoint_updated`

Use only when the checkpoint meaningfully changes, not on cosmetic rewrites.

Required fields:

- `previousCheckpoint`
- `nextCheckpoint`

Optional fields:

- `changeKind` such as `advance`, `refine`, `reframe`

### `blocker_updated`

This is the most important missing signal in the current MVP.

Required fields:

- `blockerId`
- `blockerType`
- `isBlocking`
- `ownerActionRequired`

Recommended `blockerType` values:

- `missing_decision`
- `missing_information`
- `waiting_external`
- `unclear_goal`
- `approval_needed`
- `resource_missing`

Optional fields:

- `blockingSummary`
- `waitingOn`
- `expectedUnblockCondition`

### `artifact_created`

Use when work produced something that could reasonably be called output.

Required fields:

- `artifactId`
- `artifactType`
- `artifactTitle`

Recommended `artifactType` values:

- `doc`
- `code_change`
- `summary`
- `reply`
- `export`
- `plan`
- `knowledge_note`

Optional fields:

- `artifactUrl`
- `artifactPath`
- `isExternalDelivery`

### `focus_switched`

Use to measure attention fragmentation.

Do not emit it on every render or every automatic refresh.

Only emit when the owner materially changes the active work item.

Required fields:

- `fromWorkItemId`
- `toWorkItemId`

Optional fields:

- `switchReason`
- `previousOpenDurationMs`

### `recommendation_shown`

Use when the panel chooses to surface a ranked suggestion.

Required fields:

- `recommendationId`
- `recommendationType`
- `targetWorkItemId`
- `rankPosition`

Recommended `recommendationType` values:

- `do_now`
- `clear_blocker`
- `merge_or_pause`
- `high_leverage`

### `recommendation_accepted`

Use when the owner takes the recommended action, not merely when they open the card.

Required fields:

- `recommendationId`
- `targetWorkItemId`

Optional fields:

- `acceptAction` such as `open_task`, `update_checkpoint`, `resolve_blocker`, `pause_task`

## Example payloads

### Blocker update

```json
{
  "eventId": "evt_blk_01",
  "eventType": "blocker_updated",
  "occurredAt": "2026-04-09T11:24:00.000Z",
  "actor": "user",
  "source": "manual_tag",
  "sessionId": "sess_123",
  "rootSessionId": "sess_123",
  "workItemId": "sess_123",
  "blockerId": "blk_123_a",
  "blockerType": "missing_decision",
  "isBlocking": true,
  "ownerActionRequired": true,
  "blockingSummary": "Need to decide whether the panel should optimize for 'do now' or 'unblock me' first."
}
```

### Artifact created

```json
{
  "eventId": "evt_art_01",
  "eventType": "artifact_created",
  "occurredAt": "2026-04-09T12:10:00.000Z",
  "actor": "agent",
  "source": "system",
  "sessionId": "sess_456",
  "rootSessionId": "sess_123",
  "workItemId": "sess_456",
  "artifactId": "doc_output_panel_contract",
  "artifactType": "doc",
  "artifactTitle": "Output Panel Data Contract",
  "artifactPath": "docs/output-panel-data-contract.md"
}
```

### Recommendation accepted

```json
{
  "eventId": "evt_rec_01",
  "eventType": "recommendation_accepted",
  "occurredAt": "2026-04-09T12:25:00.000Z",
  "actor": "user",
  "source": "frontend",
  "sessionId": "sess_123",
  "rootSessionId": "sess_123",
  "workItemId": "sess_123",
  "recommendationId": "rec_do_now_001",
  "targetWorkItemId": "sess_123",
  "acceptAction": "open_task"
}
```

## Derived panel sections and their required inputs

### "Do now"

Needs:

- current open work items
- blocker state
- checkpoint freshness
- artifact recency
- focus-switch load

Recommended ranking inputs:

- not blocked
- close to done
- recently touched but not yet complete
- likely to produce an artifact
- recommendation history not recently ignored

### "Blocked on you"

Needs:

- explicit blocker events
- `ownerActionRequired = true`
- blocker age
- blocker type

This should be one of the highest-trust sections in the panel.

### "Pause / merge / drop"

Needs:

- stale active work items
- repeated focus switches
- many touches with no checkpoint change
- branch overload

This section should be conservative.

It should suggest fewer but stronger cuts.

### "High leverage"

Needs:

- artifact creation after similar actions
- reusable conclusion creation
- blocker removal impact
- recommendation acceptance and downstream result

This section can start weak in phase 1 and improve only after calibration data exists.

## Current signals already available in MelodySync

The current MVP already has reusable passive signals:

- `workflowState`
- `branchContexts`
- `taskCard.checkpoint`
- `taskCard.nextSteps`
- `taskCard.knownConclusions`
- `updatedAt`
- branch topology through workbench continuity

These are enough for a first attention surface, but they are missing four critical classes:

- explicit blocker reason
- artifact creation truth
- focus switching
- recommendation feedback

Those four gaps should be the first instrumentation priority.

## Recommended rollout

### Phase 0: use existing passive signals

No extra user friction.

Use current session/workbench state to ship an initial panel.

### Phase 1: add passive events

Add:

- `task_state_changed`
- `checkpoint_updated`
- `artifact_created`
- `focus_switched`

These should mostly come from existing state transitions and UI focus changes.

### Phase 1.5: add light manual blocker tagging

Add a low-friction way for the owner to say why a task is blocked.

This is worth explicit UX because blocker reason is rarely inferable with high confidence.

### Phase 2: add recommendation loop

Track:

- shown
- accepted
- dismissed
- observed result

This is what makes the panel learnable instead of static.

## Owner-friction rule

The panel should prefer passive collection first.

The owner should only be asked to label data when:

- the missing label materially improves attention routing,
- the label cannot be inferred reliably,
- and the prompt can be answered in one tap or one short sentence.

Good candidate for explicit human input:

- blocker reason
- whether something produced a real output artifact

Bad candidates for explicit human input:

- generic mood logging on every task
- manual time tracking
- forced daily score confirmation

## Suggested implementation hooks in the current codebase

Use these as the likely starting points for future instrumentation:

- `backend/workbench/output-metrics-service.mjs` — current output-panel aggregation surface
- `backend/workbench/branch-lifecycle.mjs` — branch enter/resolve/return transitions
- `backend/session/manager.mjs` — workflow state and task-card changes
- `frontend-src/workbench/controller.js` — focus changes and recommendation interactions
- `frontend-src/workbench/output-panel-ui.js` — recommendation rendering and acceptance

## Success criteria

The panel is working if:

- owners open it and quickly choose a next action,
- blocker sections are trusted,
- stale tasks are reduced,
- recommendation acceptance predicts downstream progress better over time,
- and message/token counts become less central to how the product describes output.
