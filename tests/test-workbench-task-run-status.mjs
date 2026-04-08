#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const taskRunStatusSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-run-status.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(taskRunStatusSource, context, { filename: 'workbench/task-run-status.js' });

const api = context.MelodySyncTaskRunStatus;
assert.ok(api, 'task run status api should be exposed on window');

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusUi({ isCurrent: true, showIdle: true }))),
  { key: 'idle', label: '空闲', summary: '当前任务当前未在运行。' },
  'current but non-running tasks should surface idle instead of running',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusUi({ status: 'active', workflowState: 'done', isCurrent: true }))),
  { key: 'completed', label: '已完成', summary: '当前任务已执行完成。' },
  'workflowState=done should override current-task running badges',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusUi({ status: 'parked' }))),
  { key: 'parked', label: '已挂起', summary: '当前任务已暂时挂起。' },
  'parked tasks should surface a parked label',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusUi({ workflowState: 'waiting_user' }))),
  { key: 'waiting_user', label: '等待输入', summary: '当前任务正在等待用户输入。' },
  'waiting_user workflow should surface a waiting label',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusUi({ activityState: 'running', isCurrent: true }))),
  { key: 'running', label: '运行中', summary: '当前任务正在执行中。' },
  'running activity should surface a running label',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.getTaskRunStatusPresentation({ workflowState: 'waiting_user' }))),
  {
    key: 'waiting_user',
    label: '等待输入',
    summary: '当前任务正在等待用户输入。',
    statusClassName: 'status-waiting-user',
    dotClassName: 'status-waiting-user',
    nodeClassName: 'is-status-waiting-user',
  },
  'status presentation should be the single source of truth for workbench status classes',
);

assert.equal(
  api.getTaskRunStatusResolvedNodeClassName('completed'),
  'is-resolved',
  'completed statuses should map to terminal is-resolved node style for shared UI semantics',
);
assert.equal(
  api.getTaskRunStatusResolvedNodeClassName('parked'),
  'is-parked',
  'parked statuses should map to shared is-parked terminal style',
);

assert.equal(
  api.getTaskRunStatusClassName('rename_failed', 'is-status'),
  'is-status-rename-failed',
  'class-name helper should normalize underscores for downstream consumers',
);

console.log('test-workbench-task-run-status: ok');
