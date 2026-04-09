#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sourcePath = existsSync(join(repoRoot, 'frontend', 'session-list', 'contract.js'))
  ? join(repoRoot, 'frontend', 'session-list', 'contract.js')
  : join(repoRoot, 'static', 'frontend', 'session-list', 'contract.js');
const source = readFileSync(
  sourcePath,
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, {
  filename: 'session-list/contract.js',
});

const contract = context.MelodySyncSessionListContract;
assert.ok(contract, 'session list contract should attach to global scope');
assert.equal(contract.resolveTaskListGroup('收件箱')?.storageValue, '收集箱');
assert.equal(contract.resolveTaskListGroup('knowledge base')?.storageValue, '知识库内容');
assert.equal(contract.buildTaskListOrganizerWritableFieldsText(), '`name`, `group`, and `sidebarOrder`');
assert.equal(contract.buildTaskListGroupStorageValuesText(), '收集箱, 长期任务, 快捷按钮, 短期任务, 知识库内容, 等待任务');
assert.ok(contract.listTaskListOrganizerMutableFields().some((field) => field.id === 'name'));

console.log('test-chat-session-list-contract: ok');
