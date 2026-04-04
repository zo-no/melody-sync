#!/usr/bin/env node
import assert from 'assert/strict';

import {
  buildPersistentDigest,
  buildPersistentRunMessage,
  computeNextRecurringRunAt,
  isPersistentRecurringDue,
  normalizeSessionPersistent,
  resolvePersistentRunRuntime,
} from '../backend/session-persistent.mjs';

const normalizedRecurring = normalizeSessionPersistent({
  kind: 'recurring_task',
  state: 'active',
  digest: {
    title: '晨间日报',
    summary: '每天输出一版简报。',
    goal: '固定时间产出日报',
    keyPoints: ['保留最重要的变化', '输出要短'],
    recipe: ['先扫前一天变化', '再给出今日建议'],
  },
  recurring: {
    cadence: 'weekly',
    timeOfDay: '09:30',
    weekdays: [1, 3, 5],
    timezone: 'Asia/Shanghai',
  },
  execution: {
    runPrompt: '请按周期任务定义执行本轮产出。',
  },
}, {
  referenceTime: '2026-04-04T08:00:00.000Z',
  defaultTimezone: 'Asia/Shanghai',
  defaultRuntime: {
    tool: 'codex',
    model: 'gpt-5-codex',
    effort: 'high',
    thinking: false,
  },
  now: '2026-04-04T08:00:00.000Z',
});

assert.equal(normalizedRecurring?.kind, 'recurring_task');
assert.equal(normalizedRecurring?.recurring?.timeOfDay, '09:30');
assert.deepEqual(normalizedRecurring?.recurring?.weekdays, [1, 3, 5]);
assert.match(normalizedRecurring?.recurring?.nextRunAt || '', /^2026-04-/);
assert.equal(normalizedRecurring?.runtimePolicy?.manual?.mode, 'follow_current');
assert.equal(normalizedRecurring?.runtimePolicy?.schedule?.mode, 'pinned');
assert.equal(normalizedRecurring?.runtimePolicy?.schedule?.runtime?.tool, 'codex');

const localMorning = new Date(2026, 3, 4, 8, 15, 0, 0);
const nextDailyRun = computeNextRecurringRunAt({
  cadence: 'daily',
  timeOfDay: '09:00',
}, localMorning);
assert.equal(nextDailyRun, new Date(2026, 3, 4, 9, 0, 0, 0).toISOString());

const localAfterCutoff = new Date(2026, 3, 4, 9, 30, 0, 0);
const nextDailyAfterCutoff = computeNextRecurringRunAt({
  cadence: 'daily',
  timeOfDay: '09:00',
}, localAfterCutoff);
assert.equal(nextDailyAfterCutoff, new Date(2026, 3, 5, 9, 0, 0, 0).toISOString());

const localWeeklyReference = new Date(2026, 3, 3, 12, 0, 0, 0);
const nextWeeklyRun = computeNextRecurringRunAt({
  cadence: 'weekly',
  timeOfDay: '10:15',
  weekdays: [1, 4],
}, localWeeklyReference);
assert.equal(nextWeeklyRun, new Date(2026, 3, 6, 10, 15, 0, 0).toISOString());

assert.equal(isPersistentRecurringDue({
  kind: 'recurring_task',
  state: 'active',
  recurring: {
    nextRunAt: '2026-04-04T08:00:00.000Z',
  },
}, '2026-04-04T08:00:01.000Z'), true);

assert.equal(isPersistentRecurringDue({
  kind: 'recurring_task',
  state: 'paused',
  recurring: {
    nextRunAt: '2026-04-04T08:00:00.000Z',
  },
}, '2026-04-04T08:00:01.000Z'), false);

const digest = buildPersistentDigest({
  name: '周报整理技能',
  description: '把原始周报材料整理成可发送版本。',
  taskCard: {
    summary: '沉淀一套周报整理方法。',
    goal: '把周报整理流程长期化。',
    knownConclusions: ['先看材料比先看说明更有效。'],
    nextSteps: ['检查 Excel 结构', '整理输出模板'],
    memory: ['用户偏好先看样例。'],
  },
}, [
  { type: 'message', role: 'user', content: '每周我都要整理一次 Excel 和 PPT。' },
  { type: 'message', role: 'assistant', content: '收到。' },
]);

assert.equal(digest.title, '周报整理技能');
assert.equal(digest.goal, '把周报整理流程长期化。');
assert.deepEqual(digest.keyPoints, ['先看材料比先看说明更有效。', '用户偏好先看样例。']);
assert.deepEqual(digest.recipe, ['检查 Excel 结构', '整理输出模板']);

const runMessage = buildPersistentRunMessage({
  name: '周报整理技能',
}, {
  kind: 'skill',
  digest,
  execution: {
    runPrompt: '请按技能定义完成当前一次调用。',
  },
}, {
  triggerKind: 'manual',
});

assert.match(runMessage, /\[快捷按钮触发\]/);
assert.match(runMessage, /名称：周报整理技能/);
assert.match(runMessage, /手动触发/);
assert.match(runMessage, /请按技能定义完成当前一次调用。/);

const followCurrentRuntime = resolvePersistentRunRuntime({
  tool: 'codex',
  model: 'gpt-5-codex',
  effort: 'medium',
}, {
  kind: 'skill',
  runtimePolicy: {
    manual: {
      mode: 'follow_current',
    },
  },
}, {
  triggerKind: 'manual',
  runtime: {
    tool: 'claude',
    model: 'sonnet',
    thinking: true,
  },
});
assert.deepEqual(followCurrentRuntime, {
  tool: 'claude',
  model: 'sonnet',
  effort: '',
  thinking: true,
});

const scheduledPinnedRuntime = resolvePersistentRunRuntime({
  tool: 'codex',
  model: 'gpt-5-codex',
  effort: 'medium',
}, {
  kind: 'recurring_task',
  recurring: {
    cadence: 'daily',
    timeOfDay: '08:30',
    timezone: 'Asia/Shanghai',
  },
  runtimePolicy: {
    manual: {
      mode: 'follow_current',
    },
    schedule: {
      mode: 'pinned',
      runtime: {
        tool: 'claude',
        model: 'opus',
        thinking: true,
      },
    },
  },
}, {
  triggerKind: 'schedule',
});
assert.deepEqual(scheduledPinnedRuntime, {
  tool: 'claude',
  model: 'opus',
  effort: '',
  thinking: true,
});

console.log('test-session-persistent: ok');
