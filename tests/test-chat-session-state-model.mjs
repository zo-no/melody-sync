#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'session/state-model.js'),
  'utf8',
);
const orderContractSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'session-list', 'order-contract.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(orderContractSource, context, {
  filename: 'session-list/order-contract.js',
});

vm.runInNewContext(source, context, {
  filename: 'session/state-model.js',
});

const model = context.MelodySyncSessionStateModel;

assert.ok(model, 'session state model should attach to the global scope');

function makeActivity(overrides = {}) {
  return {
    run: {
      state: 'idle',
      phase: null,
      startedAt: null,
      runId: null,
      cancelRequested: false,
      ...overrides.run,
    },
    queue: {
      state: 'idle',
      count: 0,
      ...overrides.queue,
    },
    rename: {
      state: 'idle',
      error: null,
      ...overrides.rename,
    },
    compact: {
      state: 'idle',
      ...overrides.compact,
    },
  };
}

function makeSession(overrides = {}) {
  return {
    id: 'session-test',
    activity: makeActivity(),
    ...overrides,
  };
}

const runningSession = makeSession({
  activity: makeActivity({
    run: { state: 'running', phase: 'accepted', runId: 'run-1' },
  }),
});
const runningStatus = model.getSessionStatusSummary(runningSession);
assert.equal(runningStatus.primary.key, 'running');
assert.equal(model.isSessionBusy(runningSession), true);

const queuedSession = makeSession({
  activity: makeActivity({
    queue: { state: 'queued', count: 2 },
  }),
});
const queuedStatus = model.getSessionStatusSummary(queuedSession);
assert.equal(queuedStatus.primary.key, 'queued');
assert.equal(queuedStatus.primary.title, '2 follow-ups queued');
assert.equal(model.isSessionBusy(queuedSession), true);

const compactingSession = makeSession({
  activity: makeActivity({
    compact: { state: 'pending' },
  }),
});
assert.equal(model.getSessionStatusSummary(compactingSession).primary.key, 'compacting');
assert.equal(model.isSessionBusy(compactingSession), true);

const renamingSession = makeSession({
  activity: makeActivity({
    rename: { state: 'pending', error: null },
  }),
});
assert.equal(model.getSessionStatusSummary(renamingSession).primary.key, 'renaming');
assert.equal(model.isSessionBusy(renamingSession), false);

const renameFailedSession = makeSession({
  activity: makeActivity({
    rename: { state: 'failed', error: 'rename crashed' },
  }),
});
const renameFailedStatus = model.getSessionStatusSummary(renameFailedSession);
assert.equal(renameFailedStatus.primary.key, 'rename-failed');
assert.equal(renameFailedStatus.primary.title, 'rename crashed');

assert.equal(model.normalizeSessionWorkflowPriority('P1'), 'high');
assert.equal(model.normalizeSessionWorkflowPriority('normal'), 'medium');
assert.equal(model.normalizeSessionWorkflowPriority('later'), 'low');

assert.equal(
  JSON.stringify(model.getWorkflowStatusInfo('waiting-user')),
  JSON.stringify({
    key: 'waiting_user',
    label: 'waiting',
    className: 'status-waiting-user',
    dotClass: '',
    itemClass: '',
    title: 'Waiting on user input',
  }),
  'workflow status info should be normalized from the canonical workflow-state model',
);
assert.equal(model.normalizeSessionWorkflowState('运行完毕'), 'done', 'localized done labels should normalize to the done workflow state');
assert.equal(model.normalizeSessionWorkflowState('已完成'), 'done', 'completed Chinese labels should normalize to the done workflow state');
assert.equal(
  model.getWorkflowStatusInfo('done')?.itemClass,
  'is-done-session',
  'done workflow status should mark the whole session row for sidebar highlighting',
);
assert.equal(
  model.getWorkflowStatusInfo('actively running'),
  null,
  'unknown workflow states should not synthesize fake status badges',
);

const explicitHighPriority = model.getSessionWorkflowPriorityInfo(makeSession({ workflowPriority: 'urgent' }));
assert.equal(explicitHighPriority.key, 'high');
assert.equal(explicitHighPriority.rank, 3);

const workflowPriorityFallback = model.getSessionWorkflowPriorityInfo(
  makeSession({ workflowPriority: 'done-later' }),
);
assert.equal(workflowPriorityFallback.key, 'medium', 'unknown priority strings should fall back to medium attention');

const unreadDoneSession = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
});
assert.equal(model.hasSessionUnreadUpdate(unreadDoneSession), true, 'idle sessions updated after review should be marked unread');
assert.equal(model.getSessionReviewStatusInfo(unreadDoneSession)?.key, 'unread', 'unread sessions should expose a dedicated review badge');

const firstSeenSession = makeSession({
  lastEventAt: '2026-03-14T13:00:00.000Z',
  reviewBaselineAt: '2026-03-14T13:00:00.000Z',
});
assert.equal(
  model.hasSessionUnreadUpdate(firstSeenSession),
  false,
  'sessions should not appear unread on first sight when their baseline matches the latest event',
);

const completeAndReviewed = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T13:00:00.000Z',
});
assert.equal(model.isSessionCompleteAndReviewed(completeAndReviewed), true, 'completed sessions with no unseen updates should be de-emphasized');

const orderSourceDefinitions = model.listSessionOrderSourceDefinitions();
assert.ok(orderSourceDefinitions.some((entry) => entry.id === 'sidebar_order'), 'state model should expose the shared session list order contract');

const runningUnreadCandidate = makeSession({
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
  activity: makeActivity({
    run: {
      state: 'running',
      phase: 'running',
      startedAt: '2026-03-14T11:30:00.000Z',
      runId: 'run-review-1',
    },
  }),
});
assert.equal(model.hasSessionUnreadUpdate(runningUnreadCandidate), false, 'running sessions should not constantly become unread while streaming');

const metadataOnlyRefreshSession = makeSession({
  created: '2026-03-14T10:00:00.000Z',
  lastEventAt: '2026-03-14T12:00:00.000Z',
  updatedAt: '2026-03-14T13:30:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
});
assert.equal(
  model.hasSessionUnreadUpdate(metadataOnlyRefreshSession),
  false,
  'metadata-only updatedAt changes should not revive the unread/completed badge after a session was reviewed',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({ workflowPriority: 'high', updatedAt: '2026-03-14T12:00:00.000Z' }),
    makeSession({ workflowPriority: 'low', updatedAt: '2026-03-14T13:00:00.000Z' }),
  ) < 0,
  'higher derived priority should sort sessions before lower priority',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({ pinned: true, workflowPriority: 'medium', updatedAt: '2026-03-14T12:00:00.000Z' }),
    makeSession({ workflowPriority: 'medium', updatedAt: '2026-03-14T13:00:00.000Z' }),
  ) < 0,
  'pinned sessions should break ties before recency when priority ties',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({ workflowPriority: 'medium', updatedAt: '2026-03-14T12:00:00.000Z' }),
    makeSession({ workflowPriority: 'medium', updatedAt: '2026-03-14T13:00:00.000Z' }),
  ) > 0,
  'more recent sessions should sort first when priority and pin state tie',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({ sidebarOrder: 1, updatedAt: '2026-03-14T12:00:00.000Z' }),
    makeSession({ sidebarOrder: 3, updatedAt: '2026-03-14T13:00:00.000Z' }),
  ) < 0,
  'lower explicit sidebar order should sort sessions first when both sessions are organized',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      workflowState: 'done',
      lastEventAt: '2026-03-14T13:00:00.000Z',
      lastReviewedAt: '2026-03-14T12:00:00.000Z',
    }),
    makeSession({
      lastEventAt: '2026-03-14T13:30:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T11:00:00.000Z',
          runId: 'run-2',
        },
      }),
    }),
  ) < 0,
  'unread completed work should sort ahead of currently running sessions',
);

assert.equal(
  JSON.stringify(
    model.getSessionListOrderSnapshot(
      makeSession({
        sidebarOrder: 2,
        _sessionListOrder: 5,
        pinned: true,
        workflowPriority: 'high',
        updatedAt: '2026-03-14T12:00:00.000Z',
        lastReviewedAt: '2026-03-14T12:00:00.000Z',
      }),
    ),
  ),
  JSON.stringify({
    sidebarOrder: 2,
    hasSidebarOrder: true,
    localOrder: 5,
    hasLocalOrder: true,
    attentionBand: 3,
    workflowPriorityRank: 3,
    pinRank: 1,
    sortTime: Date.parse('2026-03-14T12:00:00.000Z'),
  }),
  'state model should expose a debuggable order snapshot built from the shared ordering contract',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      lastEventAt: '2026-03-14T13:30:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T09:00:00.000Z',
          runId: 'run-older',
        },
      }),
    }),
    makeSession({
      lastEventAt: '2026-03-14T11:15:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T10:00:00.000Z',
          runId: 'run-newer',
        },
      }),
    }),
  ) > 0,
  'running-session ordering should stay anchored to run start time instead of the latest streamed token time',
);

const toolFallbackStatus = model.getSessionStatusSummary(
  makeSession({ tool: 'codex' }),
  { includeToolFallback: true },
);
assert.equal(toolFallbackStatus.primary.key, 'tool');
assert.equal(toolFallbackStatus.primary.label, 'codex');

const idleStatus = model.getSessionStatusSummary(makeSession());
assert.equal(idleStatus.primary.key, 'idle');
assert.equal(idleStatus.primary.label, 'idle');

console.log('test-chat-session-state-model: ok');
