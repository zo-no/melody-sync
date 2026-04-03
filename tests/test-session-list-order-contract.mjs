#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'chat', 'session-list-order-contract.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, {
  filename: 'session-list-order-contract.js',
});

const contract = context.MelodySyncSessionListOrderContract;

assert.ok(contract, 'session list order contract should attach to global scope');
assert.equal(contract.normalizeSessionSidebarOrder('3'), 3);
assert.equal(contract.normalizeSessionSidebarOrder(0), 0);
assert.equal(contract.normalizeSessionLocalListOrder('2'), 2);
assert.equal(contract.normalizeSessionLocalListOrder('nope'), 0);

const definitions = contract.listSessionOrderSourceDefinitions();
assert.ok(Array.isArray(definitions), 'order source definitions should be listable');
assert.ok(
  definitions.some((entry) => entry.id === 'sidebar_order' && entry.hookMutable === false),
  'manual sidebar order should remain contract-owned',
);
assert.ok(
  definitions.some((entry) => entry.id === 'workflow_priority' && entry.hookMutable === true),
  'workflow priority may still be influenced by lifecycle-derived state',
);

console.log('test-session-list-order-contract: ok');
