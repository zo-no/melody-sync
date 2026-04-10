#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const { createSessionWorkflowRuntimeService } = await import(
  pathToFileURL(join(repoRoot, 'backend', 'services', 'session', 'workflow-runtime-service.mjs')).href
);

const sessionStore = new Map([
  ['sess_done', { id: 'sess_done', name: 'Done flow', workflowState: '', workflowPriority: '' }],
]);
const emittedEvents = [];

const service = createSessionWorkflowRuntimeService({
  appendEvent: async () => null,
  broadcastSessionInvalidation: () => {},
  broadcastSessionsInvalidation: () => {},
  buildSessionCompletionNoticeKey: () => '',
  didSessionWorkflowTransitionToDone: (nextValue, previousValue) => nextValue === 'done' && previousValue !== 'done',
  emitHook: async (event, payload) => {
    emittedEvents.push({ event, sessionId: payload?.sessionId || '' });
  },
  enrichSessionMeta: async (session) => ({ ...(session || {}) }),
  getSession: async (id) => sessionStore.get(id) || null,
  mutateSessionMeta: async (id, mutator) => {
    const current = sessionStore.get(id);
    if (!current) return { meta: null, changed: false };
    const draft = JSON.parse(JSON.stringify(current));
    const changed = mutator(draft) === true;
    if (changed) {
      sessionStore.set(id, draft);
      return { meta: draft, changed: true };
    }
    return { meta: current, changed: false };
  },
  normalizeSessionWorkflowPriority: (value) => String(value || '').trim().toLowerCase(),
  normalizeSessionWorkflowState: (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['done', 'completed', 'finished'].includes(normalized)) return 'done';
    if (['waiting_user', 'waiting-user'].includes(normalized)) return 'waiting_user';
    if (['parked'].includes(normalized)) return 'parked';
    return '';
  },
  nowIso: () => '2026-04-11T00:00:00.000Z',
  resolveLatestCompletedRunIdForSession: async () => '',
  sessionWorkflowStateWaitingUser: 'waiting_user',
  shouldExposeSession: () => true,
  statusEvent: () => null,
});

const doneSession = await service.updateSessionWorkflowClassification('sess_done', {
  workflowState: 'done',
});
assert.equal(doneSession?.workflowState, 'done', 'workflow classification updates should still persist the normalized done state');
assert.equal(doneSession?.workflowCompletedAt, '2026-04-11T00:00:00.000Z', 'transitioning into done should stamp workflowCompletedAt');
assert.deepEqual(
  emittedEvents.map((entry) => entry.event),
  ['run.completed', 'session.completed'],
  'done transitions should continue emitting the existing completion lifecycle hooks',
);

emittedEvents.length = 0;
const reopenedSession = await service.updateSessionWorkflowClassification('sess_done', {
  workflowState: '',
});
assert.equal(reopenedSession?.workflowState, undefined, 'clearing workflowState should remove the persisted done marker');
assert.equal(reopenedSession?.workflowCompletedAt, undefined, 'clearing workflowState should also clear workflowCompletedAt');
assert.deepEqual(emittedEvents, [], 'reopening a task should not emit completion hooks');

console.log('test-session-workflow-runtime-service: ok');
