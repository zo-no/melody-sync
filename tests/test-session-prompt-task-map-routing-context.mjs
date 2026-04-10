#!/usr/bin/env node
import assert from 'assert/strict';

import { buildTaskMapRoutingPromptContext } from '../backend/session-prompt/task-map-routing-context.mjs';

const currentSession = {
  id: 'sess_current',
  name: 'Map Attach Draft',
  folder: '/repo/melodysync',
};

const sessions = [
  currentSession,
  {
    id: 'sess_root_melodysync',
    name: 'MelodySync Session Map',
    group: 'MelodySync',
    description: 'Refine session-first task map routing and attach rules.',
    folder: '/repo/melodysync',
    created: '2026-04-09T00:00:00.000Z',
    updatedAt: '2026-04-10T12:00:00.000Z',
  },
  {
    id: 'sess_branch_child',
    name: 'MelodySync Child Branch',
    group: 'MelodySync',
    rootSessionId: 'sess_root_melodysync',
    sourceContext: {
      parentSessionId: 'sess_root_melodysync',
    },
    created: '2026-04-10T12:10:00.000Z',
    updatedAt: '2026-04-10T12:20:00.000Z',
  },
  {
    id: 'sess_root_video',
    name: 'Video Review',
    group: 'Video',
    description: 'Review rough-cut pacing and shot order.',
    folder: '/repo/video',
    created: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-09T12:00:00.000Z',
  },
];

const promptContext = buildTaskMapRoutingPromptContext({
  currentSession,
  sessions,
  turnText: 'Please tighten the MelodySync session map attach rules and keep the task-map flow coherent.',
});

assert.match(promptContext, /first real user turn for a standalone session/i);
assert.match(promptContext, /Candidate main task maps:/);
assert.match(promptContext, /MelodySync Session Map/);
assert.match(promptContext, /group: MelodySync/);
assert.match(promptContext, /children: 1/);
assert.match(promptContext, /Video Review/);
assert.doesNotMatch(promptContext, /MelodySync Child Branch/);
assert.match(promptContext, /keep the current session as its own main map/i);
assert.match(promptContext, /Only consider root\/main task maps from the list below/i);
assert.doesNotMatch(promptContext, /You may shape the task map immediately/i);
assert.doesNotMatch(promptContext, /Graph ops remain proposals for user confirmation and are not auto-applied/i);

const longTermPromptContext = buildTaskMapRoutingPromptContext({
  currentSession,
  sessions: [
    currentSession,
    {
      id: 'sess_root_pm_loop',
      name: 'PM Loop / PMA',
      group: '长期任务',
      description: 'Maintain the long-term product iteration tree.',
      folder: '/repo/melodysync',
      persistent: {
        kind: 'recurring_task',
        recurring: {
          cadence: 'daily',
          timeOfDay: '09:30',
        },
      },
      created: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-10T13:00:00.000Z',
    },
    {
      id: 'sess_root_daily',
      name: 'Daily System',
      group: '长期任务',
      description: 'Maintain the daily capture and reflection tree.',
      folder: '/repo/system',
      persistent: {
        kind: 'recurring_task',
        recurring: {
          cadence: 'daily',
          timeOfDay: '21:00',
        },
      },
      created: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-10T11:00:00.000Z',
    },
    {
      id: 'sess_root_video_long_term_mix',
      name: 'Video Review',
      group: 'Video',
      description: 'Review rough-cut pacing and shot order.',
      folder: '/repo/video',
      created: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-09T12:00:00.000Z',
    },
  ],
  turnText: 'Please route this product discovery request into the right long-term project map.',
});

assert.match(longTermPromptContext, /Candidate long-term task maps:/);
assert.match(longTermPromptContext, /Only consider root\/main task maps from the long-term list below/i);
assert.match(longTermPromptContext, /PM Loop \/ PMA/);
assert.match(longTermPromptContext, /Daily System/);
assert.doesNotMatch(longTermPromptContext, /Candidate main task maps:/);
assert.doesNotMatch(longTermPromptContext, /Video Review/);

const branchPromptContext = buildTaskMapRoutingPromptContext({
  currentSession: {
    id: 'sess_branch_current',
    name: 'Current Branch',
    rootSessionId: 'sess_root_melodysync',
    sourceContext: {
      parentSessionId: 'sess_root_melodysync',
    },
  },
  sessions,
  turnText: 'Continue the branch work.',
});

assert.equal(
  branchPromptContext,
  '',
  'branch sessions should not receive attach-under-existing-map hints on their first turn',
);

console.log('test-session-prompt-task-map-routing-context: ok');
