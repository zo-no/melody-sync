#!/usr/bin/env node
import assert from 'assert/strict';

import { buildLongTermSessionProjection } from '../backend/session/long-term-projection.mjs';

const longTermRoot = {
  id: 'lt-melodysync',
  name: 'MelodySync',
  group: '长期任务',
  description: '持续迭代 MelodySync 产品闭环。',
  persistent: {
    kind: 'recurring_task',
  },
};

const ordinaryRoot = {
  id: 'session-regular',
  name: 'MelodySync 迭代整理',
  description: '继续梳理 MelodySync 的长期维护和任务归类。',
};

const ordinaryProjection = buildLongTermSessionProjection(ordinaryRoot, [longTermRoot, ordinaryRoot]);
assert.equal(ordinaryProjection?.lane, 'sessions', 'ordinary sessions should stay in the regular lane until explicitly attached');
assert.equal(ordinaryProjection?.suggestion?.rootSessionId, 'lt-melodysync', 'matching ordinary sessions should point at the owning long-term root');
assert.equal(ordinaryProjection?.suggestion?.title, 'MelodySync');
assert.equal(ordinaryProjection?.suggestion?.summary, '持续迭代 MelodySync 产品闭环。');
assert.ok(Number(ordinaryProjection?.suggestion?.score) >= 6, 'matching long-term suggestions should clear the minimum confidence threshold');

assert.deepEqual(
  buildLongTermSessionProjection({
    id: 'session-member',
    name: '修补 task-map attach',
    taskPoolMembership: {
      longTerm: {
        role: 'member',
        projectSessionId: 'lt-melodysync',
        bucket: 'inbox',
      },
    },
    rootSessionId: 'lt-melodysync',
    sourceContext: {
      parentSessionId: 'lt-melodysync',
    },
  }, [longTermRoot]),
  {
    lane: 'long-term',
    role: 'member',
    rootSessionId: 'lt-melodysync',
    rootTitle: 'MelodySync',
    rootSummary: '持续迭代 MelodySync 产品闭环。',
    bucket: 'inbox',
  },
  'sessions already attached under a long-term root should project their owning long-term lane',
);

assert.equal(
  buildLongTermSessionProjection({
    id: 'session-unrelated',
    name: '剪视频',
    description: '整理镜头节奏',
  }, [longTermRoot]),
  null,
  'unrelated sessions should not produce noisy long-term suggestions',
);

assert.equal(
  buildLongTermSessionProjection({
    id: 'session-scheduled',
    name: '一次性账单提醒',
    persistent: {
      kind: 'scheduled_task',
    },
  }, [longTermRoot]),
  null,
  'scheduled tasks should be treated as persistent sessions instead of producing long-term suggestions',
);

assert.equal(
  buildLongTermSessionProjection({
    id: 'session-waiting',
    name: '等用户确认',
    persistent: {
      kind: 'waiting_task',
    },
  }, [longTermRoot]),
  null,
  'waiting tasks should be treated as persistent sessions instead of producing long-term suggestions',
);

console.log('test-session-long-term-projection: ok');
