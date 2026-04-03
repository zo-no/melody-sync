#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const contractSource = readFileSync(join(repoRoot, 'static', 'chat', 'session-list', 'contract.js'), 'utf8');
const source = readFileSync(join(repoRoot, 'static', 'chat', 'session-list', 'model.js'), 'utf8');

const translations = {
  'sidebar.group.inbox': 'Capture',
  'sidebar.group.shortTerm': 'Short-term',
  'sidebar.branchTag': 'Branch',
};

const context = {
  console,
  window: {
    melodySyncT(key) {
      return translations[key] || key;
    },
  },
};
context.globalThis = context;
context.self = context;

vm.runInNewContext(contractSource, context, { filename: 'static/chat/session-list/contract.js' });
vm.runInNewContext(source, context, { filename: 'static/chat/session-list/model.js' });

const model = context.MelodySyncSessionListModel;
assert.ok(model, 'session list model should register itself on the global object');
assert.equal(
  model.getSessionGroupInfo({ group: '短期任务' }).key,
  'group:short-term',
  'session list model should normalize known task groups',
);
assert.equal(
  model.resolveTaskListGroup('收件箱').storageValue,
  '收集箱',
  'session list model should delegate GTD aliases to the shared contract',
);
assert.equal(
  model.getSessionGroupInfo({ group: 'unknown bucket' }).label,
  'Capture',
  'unknown groups should fall back to inbox/capture',
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
assert.deepEqual(
  Array.from(model.getSessionListBadges({ taskCard: { lineRole: 'branch' } }), (entry) => entry.label),
  ['Branch'],
  'branch tasks should expose a lightweight sidebar badge instead of a nested tree renderer',
);

console.log('test-chat-session-list-model: ok');
