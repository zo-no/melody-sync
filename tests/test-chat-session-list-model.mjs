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
  'sidebar.branchTag': 'Branch',
};

const localStorageState = new Map();

const context = {
  console,
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
  model.getSessionGroupInfo({ group: '短期任务' }, { groupingMode: 'ai' }).key,
  'group:short-term',
  'AI grouping mode should still normalize the known built-in task groups',
);
assert.equal(
  model.resolveTaskListGroup('收件箱').storageValue,
  '收集箱',
  'session list model should delegate GTD aliases to the shared contract',
);
assert.equal(
  model.getSessionGroupInfo({ group: 'unknown bucket' }, { groupingMode: 'ai' }).label,
  'unknown bucket',
  'unknown groups in AI mode should stay visible as AI-owned custom groups',
);
assert.equal(
  model.getSessionGroupingMode(),
  'user',
  'session list grouping mode should default to user/template mode',
);
assert.equal(
  model.setSessionGroupingMode('ai'),
  'ai',
  'session list grouping mode setter should persist AI mode',
);
assert.equal(
  model.getSessionGroupingMode(),
  'ai',
  'session list grouping mode getter should read back the persisted AI mode',
);
assert.equal(
  JSON.stringify(model.setSessionGroupingTemplateGroups(['项目 Alpha', '项目 Beta'])),
  JSON.stringify(['项目 Alpha', '项目 Beta']),
  'template grouping should normalize and persist user template groups',
);
assert.match(
  model.getSessionGroupInfo({ group: '项目 Alpha' }, { groupingMode: 'user' }).key,
  /^group:template:/,
  'user template mode should resolve configured template groups into dedicated sidebar buckets',
);
assert.equal(
  model.getSessionGroupInfo({ group: '不在模板里' }, { groupingMode: 'user' }).label,
  'Uncategorized',
  'user template mode should route unmatched groups into the uncategorized fallback bucket',
);
assert.match(
  model.getSessionGroupInfo({ group: '研究任务' }, { groupingMode: 'ai' }).key,
  /^group:custom:/,
  'AI free grouping mode should allow custom group labels owned by AI',
);
assert.equal(
  model.getSessionGroupInfo({ group: '研究任务' }, { groupingMode: 'ai' }).label,
  '研究任务',
  'AI free grouping mode should keep the AI-generated custom group label visible',
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
  'mainline done tasks should remain visible in the sidebar task list',
);
assert.equal(
  model.shouldShowSessionInSidebar({ id: 'main-done-reviewed', taskCard: { lineRole: 'main' }, workflowState: 'done', reviewed: true }),
  true,
  'review-pending completed tasks should remain visible in the sidebar task list',
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
  'sidebar entry classification should keep done mainline tasks visible',
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
  model.getSessionListEntry({ id: 'entry-merged', taskCard: { lineRole: 'branch' }, _branchStatus: 'merged' }).hiddenReason,
  'closed_branch',
  'sidebar entry classification should explain when a branch is hidden for being closed',
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
  model.getSessionListEntry({ id: 'entry-recurring', persistent: { kind: 'recurring_task' } }).persistentDockGroupKey,
  'group:long-term',
  'sidebar entry classification should route recurring tasks into the persistent dock',
);
assert.deepEqual(
  Array.from(model.getSessionListBadges({ taskCard: { lineRole: 'branch' } }), (entry) => entry.label),
  ['Branch'],
  'branch tasks should expose a lightweight sidebar badge instead of a nested tree renderer',
);

console.log('test-chat-session-list-model: ok');
