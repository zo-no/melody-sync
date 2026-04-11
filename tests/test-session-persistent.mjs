#!/usr/bin/env node
import assert from 'assert/strict';

import {
  buildPersistentDigest,
  buildPersistentRunMessage,
  computeNextRecurringRunAt,
  isPersistentRecurringDue,
  isPersistentScheduledDue,
  normalizeSessionPersistent,
  resolvePersistentDueTriggerKind,
  resolvePersistentRunRuntime,
} from '../backend/session-persistent/core.mjs';
import { createSessionPersistentService } from '../backend/services/session/persistent-service.mjs';

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
  loop: {
    collect: {
      sources: ['运行日志', '用户反馈', '运行日志'],
      instruction: '先收集这一轮产生的新信号。',
    },
    organize: {
      instruction: '按问题类型和频率整理成稳定模式。',
    },
    use: {
      instruction: '用整理后的结果决定下一轮要调什么。',
    },
    prune: {
      instruction: '删掉重复、过期和低信号记录。',
    },
  },
  execution: {
    mode: 'spawn_session',
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
assert.equal(normalizedRecurring?.execution?.mode, 'spawn_session');
assert.deepEqual(normalizedRecurring?.loop?.collect?.sources, ['运行日志', '用户反馈']);
assert.equal(normalizedRecurring?.loop?.organize?.instruction, '按问题类型和频率整理成稳定模式。');
assert.equal(normalizedRecurring?.loop?.prune?.instruction, '删掉重复、过期和低信号记录。');

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

const localHourlyReference = new Date(2026, 3, 4, 8, 45, 0, 0);
const nextHourlyRun = computeNextRecurringRunAt({
  cadence: 'hourly',
  timeOfDay: '00:15',
}, localHourlyReference);
assert.equal(nextHourlyRun, new Date(2026, 3, 4, 9, 15, 0, 0).toISOString());

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

const normalizedScheduled = normalizeSessionPersistent({
  kind: 'scheduled_task',
  digest: {
    title: '到点提交周报',
    summary: '短期定时交付一版周报。',
  },
  scheduled: {
    runAt: '2026-04-04T09:30:00.000Z',
    timezone: 'Asia/Shanghai',
  },
  knowledgeBasePath: '/tmp/week-report.md',
  loop: {
    collect: {
      sources: ['任务清单'],
    },
  },
}, {
  now: '2026-04-04T08:00:00.000Z',
  defaultTimezone: 'Asia/Shanghai',
});

assert.equal(normalizedScheduled?.kind, 'scheduled_task');
assert.equal(normalizedScheduled?.scheduled?.nextRunAt, '2026-04-04T09:30:00.000Z');
assert.equal(normalizedScheduled?.knowledgeBasePath, '/tmp/week-report.md');
assert.equal(isPersistentScheduledDue(normalizedScheduled, '2026-04-04T09:30:01.000Z'), true);
assert.equal(resolvePersistentDueTriggerKind(normalizedScheduled, '2026-04-04T09:30:01.000Z'), 'schedule');
assert.equal(resolvePersistentDueTriggerKind(normalizedRecurring, normalizedRecurring.recurring.nextRunAt), 'recurring');

const consumedScheduled = normalizeSessionPersistent({
  ...normalizedScheduled,
  scheduled: {
    ...normalizedScheduled.scheduled,
    lastRunAt: '2026-04-04T09:30:01.000Z',
    nextRunAt: '',
  },
});
assert.equal(consumedScheduled?.scheduled?.nextRunAt, '', 'consumed scheduled tasks should preserve an empty nextRunAt');
assert.equal(isPersistentScheduledDue(consumedScheduled, '2026-04-04T09:31:00.000Z'), false);
assert.equal(resolvePersistentDueTriggerKind(consumedScheduled, '2026-04-04T09:31:00.000Z'), '');

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

const stateDrivenDigest = buildPersistentDigest({
  sessionState: {
    mainGoal: '重构会话架构',
    goal: '把 persistent digest 拉回真值层',
    checkpoint: '优先读 sessionState，再 fallback 到 legacy summary',
  },
  taskCard: {
    summary: 'legacy summary should not win',
    goal: 'legacy goal should not win',
  },
}, [
  { type: 'message', role: 'user', content: '这一轮要继续清理 digest 的旧入口。' },
]);

assert.equal(stateDrivenDigest.title, '重构会话架构');
assert.equal(stateDrivenDigest.goal, '把 persistent digest 拉回真值层');
assert.equal(stateDrivenDigest.summary, '优先读 sessionState，再 fallback 到 legacy summary');
assert.deepEqual(stateDrivenDigest.recipe, ['优先读 sessionState，再 fallback 到 legacy summary']);

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
assert.match(runMessage, /一键触发/);
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

const recurringRunMessage = buildPersistentRunMessage({
  name: '晨间日报',
}, normalizedRecurring, {
  triggerKind: 'schedule',
});
assert.match(recurringRunMessage, /数据收集：/);
assert.match(recurringRunMessage, /数据整理：/);
assert.match(recurringRunMessage, /数据使用：/);
assert.match(recurringRunMessage, /冗余减枝：/);

const scheduledRunMessage = buildPersistentRunMessage({
  name: '到点提交周报',
}, normalizedScheduled, {
  triggerKind: 'schedule',
});
assert.match(scheduledRunMessage, /\[短期任务执行\]/);
assert.match(scheduledRunMessage, /定时触发/);
assert.match(scheduledRunMessage, /知识库路径：\n- \/tmp\/week-report\.md/);

const spawnedParent = {
  id: 'persistent-parent',
  folder: '/tmp',
  tool: 'codex',
  name: '理财流水线',
  group: '长期任务',
  created: '2026-04-04T08:00:00.000Z',
  updatedAt: '2026-04-04T08:00:00.000Z',
  persistent: {
    ...normalizedRecurring,
    execution: {
      ...normalizedRecurring.execution,
      mode: 'spawn_session',
      runPrompt: '请在新支线上执行本轮长期任务。',
    },
  },
  taskPoolMembership: {
    longTerm: {
      role: 'project',
      projectSessionId: 'persistent-parent',
      fixedNode: true,
    },
  },
};
const spawnedSessions = new Map([[spawnedParent.id, spawnedParent]]);
let spawnedChildCounter = 0;
const persistentService = createSessionPersistentService({
  broadcastSessionInvalidation() {},
  createBranchFromSession: async () => null,
  createSession: async (folder, tool, name, extra = {}) => {
    spawnedChildCounter += 1;
    const session = {
      id: `persistent-child-${spawnedChildCounter}`,
      folder,
      tool,
      name,
      created: '2026-04-04T08:01:00.000Z',
      updatedAt: '2026-04-04T08:01:00.000Z',
      ...extra,
    };
    spawnedSessions.set(session.id, session);
    return session;
  },
  createInternalRequestId: (prefix) => `${prefix}_request`,
  enrichSessionMeta: (session) => session,
  getSession: async (sessionId) => spawnedSessions.get(sessionId) || null,
  getSessionQueueCount: () => 0,
  isSessionRunning: () => false,
  mutateSessionMeta: async (sessionId, mutator) => {
    const current = spawnedSessions.get(sessionId);
    if (!current) return { meta: null, changed: false };
    const draft = JSON.parse(JSON.stringify(current));
    const changed = mutator(draft) !== false;
    if (changed) {
      spawnedSessions.set(sessionId, draft);
      return { meta: draft, changed: true };
    }
    return { meta: current, changed: false };
  },
  nowIso: () => '2026-04-04T08:01:00.000Z',
  submitHttpMessage: async (sessionId, text, images, options) => ({
    session: spawnedSessions.get(sessionId),
    run: { id: 'run-persistent-spawn', sessionId },
    text,
    images,
    options,
  }),
});

const spawnedOutcome = await persistentService.runSessionPersistent(spawnedParent.id, { triggerKind: 'manual' });
assert.equal(spawnedOutcome?.run?.sessionId, 'persistent-child-1', 'spawn-session mode should run on the spawned branch');
assert.equal(spawnedOutcome?.spawnedSession?.id, 'persistent-child-1', 'spawn-session mode should return the spawned branch');
assert.equal(spawnedOutcome?.parentSession?.id, spawnedParent.id, 'spawn-session mode should return the parent separately');
assert.equal(
  spawnedOutcome?.spawnedSession?.taskPoolMembership?.longTerm?.projectSessionId,
  spawnedParent.id,
  'spawned persistent branch should stay under the owning long-term project',
);
assert.equal(
  spawnedOutcome?.spawnedSession?.taskPoolMembership?.longTerm?.bucket,
  'long_term',
  'recurring spawned persistent branch should land in the long-term bucket',
);
assert.equal(
  spawnedSessions.get(spawnedParent.id)?.persistent?.execution?.lastTriggerKind,
  'manual',
  'spawn-session mode should still update parent trigger metadata',
);

console.log('test-session-persistent: ok');
