#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const contractSourcePath = existsSync(join(repoRoot, 'frontend-src', 'session-list', 'contract.js'))
  ? join(repoRoot, 'frontend-src', 'session-list', 'contract.js')
  : join(repoRoot, 'static', 'frontend', 'session-list', 'contract.js');
const sessionListModelSourcePath = existsSync(join(repoRoot, 'frontend-src', 'session-list', 'model.js'))
  ? join(repoRoot, 'frontend-src', 'session-list', 'model.js')
  : join(repoRoot, 'static', 'frontend', 'session-list', 'model.js');
const contractSource = readFileSync(contractSourcePath, 'utf8');
const source = readFileSync(sessionListModelSourcePath, 'utf8');

const translations = {
  'sidebar.group.inbox': 'Capture',
  'sidebar.group.shortTerm': 'Short-term',
  'sidebar.group.uncategorized': 'Uncategorized',
  'sidebar.branchTag': 'Branch Task',
  'persistent.kind.recurringTask': 'Recurring task',
  'persistent.kind.recurringPaused': 'Recurring paused',
  'persistent.kind.skill': 'Quick action',
};

const localStorageState = new Map();

const context = {
  console,
  sessions: [
    {
      id: 'long-term-root',
      persistent: { kind: 'recurring_task' },
    },
    {
      id: 'long-term-branch',
      rootSessionId: 'long-term-root',
      sourceContext: { parentSessionId: 'long-term-root' },
    },
    {
      id: 'explicit-long-term-root',
      taskPoolMembership: {
        longTerm: {
          role: 'project',
          projectSessionId: 'explicit-long-term-root',
          fixedNode: true,
        },
      },
    },
    {
      id: 'explicit-long-term-member',
      taskPoolMembership: {
        longTerm: {
          role: 'member',
          projectSessionId: 'explicit-long-term-root',
        },
      },
    },
  ],
  localStorage: {
    getItem(key) {
      return localStorageState.has(key) ? localStorageState.get(key) : null;
    },
    setItem(key, value) {
      localStorageState.set(key, String(value));
    },
    removeItem(key) {
      localStorageState.delete(key);
    },
  },
  MelodySyncWorkbench: {
    getSnapshot() {
      return {
        branchContexts: [
          { sessionId: 'branch-from-context', status: 'resolved', updatedAt: '2026-04-06T09:00:00.000Z' },
        ],
      };
    },
  },
  MelodySyncSessionStateModel: {
    normalizeSessionWorkflowState(value) {
      const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (['parked', 'paused', 'pause', 'backlog', 'todo'].includes(normalized)) return 'parked';
      if (['done', 'complete', 'completed', 'finished', '完成', '已完成', '运行完毕', '运行完成'].includes(normalized)) return 'done';
      if (['waiting', 'waiting_user', 'waiting_for_user', 'waiting_on_user', 'needs_user', 'needs_input'].includes(normalized)) return 'waiting_user';
      return '';
    },
    isSessionBusy(session) {
      return session?.busy === true;
    },
    getSessionReviewStatusInfo(session) {
      return session?.reviewed === true ? { key: 'unread' } : null;
    },
    getSessionStalenessInfo(session) {
      if (session?.persistent?.kind === 'recurring_task') return null;
      if (session?.id === 'stale-cleanup') {
        return {
          key: 'stale_cleanup',
          stage: 'cleanup',
          label: 'cleanup',
          title: 'Idle for 33 days',
          itemClass: 'is-stale-cleanup-session',
        };
      }
      if (session?.id === 'stale-warning') {
        return {
          key: 'stale_cleanup',
          stage: 'cleanup',
          label: 'cleanup',
          title: 'Idle since yesterday',
          itemClass: 'is-stale-cleanup-session',
        };
      }
      return null;
    },
  },
  window: {
    melodySyncT(key) {
      return translations[key] || key;
    },
    MelodySyncSessionStateModel: null,
  },
};
context.window.MelodySyncSessionStateModel = context.MelodySyncSessionStateModel;
context.globalThis = context;
context.self = context;

vm.runInNewContext(contractSource, context, { filename: 'frontend-src/session-list/contract.js' });
vm.runInNewContext(source, context, { filename: 'frontend-src/session-list/model.js' });

const model = context.MelodySyncSessionListModel;
assert.ok(model, 'session list model should register itself on the global object');
assert.equal(
  model.normalizeSessionGroupingMode('ai'),
  'user',
  'legacy AI grouping mode should now normalize to folder mode',
);
assert.equal(
  model.resolveTaskListGroup('收件箱').storageValue,
  '收集箱',
  'session list model should delegate GTD aliases to the shared contract',
);
assert.equal(
  model.getSessionGroupInfo({ group: 'unknown bucket' }, { groupingMode: 'ai' }).label,
  'Uncategorized',
  'legacy AI grouping hints should fall back to the folder-based uncategorized bucket',
);
assert.equal(
  model.getSessionGroupingMode(),
  'user',
  'session list grouping mode should default to folder mode',
);
assert.equal(
  model.setSessionGroupingMode('ai'),
  'user',
  'session list grouping mode setter should reject the retired AI mode',
);
assert.equal(
  model.getSessionGroupingMode(),
  'user',
  'session list grouping mode getter should stay pinned to folder mode',
);
assert.equal(
  JSON.stringify(model.setSessionGroupingTemplateGroups(['项目 Alpha', '项目 Beta'])),
  JSON.stringify(['项目 Alpha', '项目 Beta']),
  'folder grouping should normalize and persist user-created folders',
);
assert.match(
  model.getSessionGroupInfo({ group: '项目 Alpha' }, { groupingMode: 'user' }).key,
  /^group:template:/,
  'folder mode should resolve configured folders into dedicated sidebar buckets',
);
assert.match(
  model.getSessionGroupInfo({ group: '项目 Alpha' }, { groupingMode: 'ai' }).key,
  /^group:template:/,
  'legacy AI grouping hints should still resolve through the folder buckets',
);
assert.equal(
  model.getSessionGroupInfo({ group: '不在模板里' }, { groupingMode: 'user' }).label,
  'Uncategorized',
  'folder mode should route unmatched groups into the uncategorized fallback bucket',
);
assert.match(
  model.getSessionGroupInfo({ group: '项目 Alpha', persistent: { kind: 'recurring_task' } }, { groupingMode: 'user' }).key,
  /^group:template:/,
  'explicit folder assignment should take precedence over persistent task defaults in the sidebar grouping',
);
assert.equal(
  model.getSessionGroupInfo({ group: '研究任务' }, { groupingMode: 'ai' }).label,
  'Uncategorized',
  'retired grouping modes should no longer expose custom sidebar buckets',
);
assert.equal(
  model.isBranchTaskSession({ taskCard: { lineRole: 'branch' } }),
  true,
  'taskCard lineRole should be enough to mark a branch task',
);
assert.equal(
  model.isBranchTaskSession({ sourceContext: { parentSessionId: 'session-main' } }),
  true,
  'legacy parent-session linkage should still mark a branch task',
);
assert.equal(
  model.isBranchTaskSession({ taskCard: { lineRole: 'main' } }),
  false,
  'mainline tasks should stay out of the branch-only badge path',
);
assert.equal(
  model.getBranchTaskStatus({ id: 'branch-merged', taskCard: { lineRole: 'branch' }, _branchStatus: 'merged' }),
  'merged',
  'branch status should prefer the session record when the branch lifecycle status is present locally',
);
assert.equal(
  model.getBranchTaskStatus({ id: 'branch-from-context', taskCard: { lineRole: 'branch' } }),
  'resolved',
  'branch status should fall back to the latest workbench branch context when the session record lacks a local status',
);
assert.equal(
  model.getBranchTaskVisibilityMode(),
  'show',
  'branch task visibility should default to showing active branch sessions',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'branch-active', taskCard: { lineRole: 'branch' }, taskListVisibility: 'secondary' }),
  true,
  'active branches should remain visible in the sidebar even when stored as secondary sessions',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'branch-merged', taskCard: { lineRole: 'branch' }, _branchStatus: 'merged' }),
  false,
  'merged branches should disappear from the sidebar task list',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'branch-parked', taskCard: { lineRole: 'branch' }, _branchStatus: 'parked' }),
  false,
  'parked branches should disappear from the sidebar task list',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-done', taskCard: { lineRole: 'main' }, workflowState: 'done' }),
  true,
  'mainline done tasks stay visible (shown with strikethrough) — user must archive to hide',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-done-reviewed', taskCard: { lineRole: 'main' }, workflowState: 'done', reviewed: true }),
  true,
  'completed tasks with review metadata also stay visible until archived',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-parked', taskCard: { lineRole: 'main' }, workflowState: 'parked' }),
  false,
  'parked mainline tasks should disappear from the sidebar task list',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-reviewed', taskCard: { lineRole: 'main' }, reviewed: true }),
  true,
  'idle sessions carrying the completion-review state should remain in the active sidebar list',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-waiting-reviewed', taskCard: { lineRole: 'main' }, workflowState: 'waiting_user', reviewed: true }),
  true,
  'waiting-user sessions should stay visible even if they have unread updates',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-running', taskCard: { lineRole: 'main' }, reviewed: true, busy: true }),
  true,
  'busy sessions should remain visible in the sidebar',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'archived-done', archived: true, taskCard: { lineRole: 'main' }, workflowState: 'done', reviewed: true }, { archived: true }),
  true,
  'archived completed tasks should stay visible inside the archive section',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-done', workflowState: 'done', taskCard: { lineRole: 'main' } }).hiddenReason,
  '',
  'done tasks are now visible (strikethrough style) — hiddenReason is empty until archived',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-parked', workflowState: 'parked', taskCard: { lineRole: 'main' } }).hiddenReason,
  'parked_mainline',
  'sidebar entry classification should explain when a mainline task is hidden for being parked',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-reviewed', reviewed: true, taskCard: { lineRole: 'main' } }).needsReview,
  true,
  'sidebar entry classification should keep review-needed tasks visible while marking the review state',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    model.getSessionListEntry({ id: 'stale-cleanup', taskCard: { lineRole: 'main' } }),
    'staleInfo',
  ),
  false,
  'sidebar entry classification should not carry stale cleanup reminder metadata',
);
assert.equal(
  model.getSessionListBadges({ id: 'stale-warning', taskCard: { lineRole: 'main' } })
    .some((badge) => badge?.label === 'cleanup'),
  false,
  'ordinary tasks from previous days should not surface cleanup badges in the sidebar meta row',
);
assert.equal(
  model.getSessionListBadges({ id: 'long-term-stale', persistent: { kind: 'recurring_task' } })
    .some((badge) => badge?.key === 'stale' || badge?.key === 'stale_cleanup'),
  false,
  'long-term sessions should stay out of stale cleanup badges',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-merged', taskCard: { lineRole: 'branch' }, _branchStatus: 'merged' }).hiddenReason,
  'closed_branch',
  'sidebar entry classification should explain when a branch is hidden for being closed',
);
assert.equal(
  model.setBranchTaskVisibilityMode('hide'),
  'hide',
  'branch task visibility setter should persist the hidden mode',
);
assert.equal(
  model.shouldHideBranchTaskSessions(),
  true,
  'branch task visibility helper should reflect the hidden mode',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'entry-branch-filtered', taskCard: { lineRole: 'branch' }, taskListVisibility: 'secondary' }),
  false,
  'active branches should disappear from the sidebar when the owner hides branch tasks',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-branch-filtered', taskCard: { lineRole: 'branch' }, taskListVisibility: 'secondary' }).hiddenReason,
  'branch_filtered',
  'sidebar entry classification should explain when a branch is hidden by the branch toggle',
);
assert.equal(
  model.setBranchTaskVisibilityMode('show'),
  'show',
  'branch task visibility setter should restore the visible mode',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'entry-secondary', taskListVisibility: 'secondary', taskCard: { lineRole: 'main' } }),
  false,
  'secondary task-list sessions should stay out of the primary sidebar list',
);
assert.equal(
  model.getSessionListEntry({ id: 'entry-secondary', taskListVisibility: 'secondary', taskCard: { lineRole: 'main' } }).hiddenReason,
  'secondary_task',
  'sidebar entry classification should explain when a session is hidden because it is not a primary task',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    model.getSessionListEntry({ id: 'entry-recurring', persistent: { kind: 'recurring_task' } }),
    'persistentDockGroupKey',
  ),
  false,
  'sidebar entry classification should not route recurring tasks into a persistent dock category',
);
assert.equal(
  model.isLongTermProjectSession({ id: 'entry-recurring', persistent: { kind: 'recurring_task' } }),
  true,
  'session list model should expose a dedicated helper for long-term project sessions',
);
assert.equal(
  model.isLongTermLineSession({ id: 'long-term-branch', rootSessionId: 'long-term-root', sourceContext: { parentSessionId: 'long-term-root' } }),
  true,
  'session list model should also classify branches under a long-term root as long-term-line sessions',
);
assert.equal(
  model.isLongTermProjectSession({
    id: 'explicit-long-term-root',
    taskPoolMembership: {
      longTerm: {
        role: 'project',
        projectSessionId: 'explicit-long-term-root',
        fixedNode: true,
      },
    },
  }),
  true,
  'session list helpers should recognize explicit project membership as a long-term root',
);
assert.equal(
  model.isLongTermLineSession({
    id: 'explicit-long-term-member',
    taskPoolMembership: {
      longTerm: {
        role: 'member',
        projectSessionId: 'explicit-long-term-root',
      },
    },
  }),
  true,
  'session list helpers should also recognize explicit long-term members as part of the long-term lane',
);
assert.deepEqual(
  Array.from(model.getSessionListBadges({
    persistent: {
      kind: 'recurring_task',
      state: 'active',
      recurring: {
        cadence: 'weekly',
        timeOfDay: '09:15',
        weekdays: [1, 4],
        nextRunAt: '2026-04-10T01:15:00.000Z',
        timezone: 'Asia/Shanghai',
      },
    },
  }), (entry) => ({ label: entry.label, title: entry.title || '' })),
  [
    { label: 'Recurring task', title: '' },
    { label: '周一/周四 09:15', title: '下次执行 04-10 09:15 · 时区 Asia/Shanghai' },
  ],
  'recurring tasks should surface both the persistent kind and the cadence badge in the sidebar',
);
assert.deepEqual(
  Array.from(model.getSessionListBadges({ taskCard: { lineRole: 'branch' } }), (entry) => entry.label),
  ['Branch Task'],
  'branch tasks should expose a lightweight sidebar badge instead of a nested tree renderer',
);

console.log('test-chat-session-list-model: ok');
