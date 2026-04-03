#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench/node-contract.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;
vm.runInNewContext(source, context, { filename: 'workbench/node-contract.js' });

const contract = context.MelodySyncWorkbenchNodeContract;
assert.ok(contract, 'node contract should be exposed on globalThis');
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_KINDS)), ['main', 'branch', 'candidate', 'done']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_LANES)), ['main', 'branch', 'side']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_ROLES)), ['state', 'action', 'summary']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_MERGE_POLICIES)), ['replace-latest', 'append']);

const main = contract.getNodeKindDefinition('main');
assert.equal(main?.lane, 'main');
assert.equal(main?.role, 'state');
assert.equal(main?.mergePolicy, 'replace-latest');

const branch = contract.getNodeKindDefinition('branch');
assert.equal(branch?.lane, 'branch');
assert.equal(branch?.role, 'state');
assert.equal(branch?.mergePolicy, 'append');

const candidate = contract.getNodeKindDefinition('candidate');
assert.equal(candidate?.lane, 'branch');
assert.equal(candidate?.role, 'action');
assert.equal(candidate?.derived, true);

const done = contract.getNodeKindDefinition('done');
assert.equal(done?.role, 'summary');
assert.equal(done?.sessionBacked, false);

assert.equal(contract.isKnownNodeKind('main'), true);
assert.equal(contract.isKnownNodeKind('unknown'), false);

console.log('test-workbench-node-contract: ok');
