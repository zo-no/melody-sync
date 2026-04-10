#!/usr/bin/env node
import assert from 'assert/strict';

import {
  buildLongTermTaskPoolMembership,
  getLongTermTaskPoolMembership,
  isLongTermProjectSession,
  normalizeTaskPoolMembership,
  resolveLongTermProjectSessionId,
} from '../backend/session/task-pool-membership.mjs';

const explicitProjectMembership = normalizeTaskPoolMembership({
  longTerm: {
    role: 'project',
    projectSessionId: 'project-1',
  },
}, {
  sessionId: 'project-1',
});

assert.deepEqual(explicitProjectMembership, {
  longTerm: {
    role: 'project',
    projectSessionId: 'project-1',
    fixedNode: true,
  },
});

assert.deepEqual(
  buildLongTermTaskPoolMembership('project-2', { role: 'member', bucket: 'inbox' }),
  {
    longTerm: {
      role: 'member',
      projectSessionId: 'project-2',
      fixedNode: false,
      bucket: 'inbox',
    },
  },
  'builder should create member-shaped long-term pool membership payloads',
);

const sessions = [
  {
    id: 'legacy-root',
    persistent: { kind: 'recurring_task' },
  },
  {
    id: 'legacy-member',
    rootSessionId: 'legacy-root',
    sourceContext: {
      parentSessionId: 'legacy-root',
    },
  },
  {
    id: 'explicit-member',
    taskPoolMembership: {
      longTerm: {
        role: 'member',
        projectSessionId: 'explicit-root',
        bucket: 'short_term_iteration',
      },
    },
  },
  {
    id: 'explicit-root',
    taskPoolMembership: {
      longTerm: {
        role: 'project',
        projectSessionId: 'explicit-root',
        fixedNode: true,
      },
    },
  },
];

const sessionById = new Map(sessions.map((session) => [session.id, session]));

assert.equal(
  resolveLongTermProjectSessionId(sessionById.get('legacy-member'), {
    getSessionById: (sessionId) => sessionById.get(sessionId) || null,
  }),
  'legacy-root',
  'legacy recurring roots should still resolve as long-term project ids when no explicit membership exists',
);

assert.deepEqual(
  getLongTermTaskPoolMembership(sessionById.get('explicit-member'), {
    getSessionById: (sessionId) => sessionById.get(sessionId) || null,
  }),
  {
    role: 'member',
    projectSessionId: 'explicit-root',
    fixedNode: false,
    bucket: 'short_term_iteration',
  },
  'explicit member sessions should preserve their project relationship without falling back to lineage',
);

assert.equal(
  isLongTermProjectSession(sessionById.get('explicit-root')),
  true,
  'explicit project membership should mark the owning task as a long-term root',
);
assert.equal(
  isLongTermProjectSession(sessionById.get('legacy-root')),
  true,
  'legacy recurring-task projects should keep working as a fallback until data is migrated',
);

console.log('test-session-task-pool-membership: ok');
