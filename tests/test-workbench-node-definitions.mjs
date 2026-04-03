#!/usr/bin/env node
import assert from 'assert/strict';
import {
  NODE_KIND_DEFINITIONS,
  NODE_LANES,
  NODE_MERGE_POLICIES,
  NODE_ROLES,
  createWorkbenchNodeDefinitionsPayload,
  getNodeKindDefinition,
  isKnownNodeKind,
  listNodeKindDefinitions,
} from '../chat/workbench/node-definitions.mjs';

assert.deepEqual(NODE_LANES, ['main', 'branch', 'side']);
assert.deepEqual(NODE_ROLES, ['state', 'action', 'summary']);
assert.deepEqual(NODE_MERGE_POLICIES, ['replace-latest', 'append']);
assert.deepEqual(
  NODE_KIND_DEFINITIONS.map((definition) => definition.id),
  ['main', 'branch', 'candidate', 'done'],
);

assert.equal(getNodeKindDefinition('main')?.sessionBacked, true);
assert.equal(getNodeKindDefinition('branch')?.mergePolicy, 'append');
assert.equal(getNodeKindDefinition('candidate')?.derived, true);
assert.equal(getNodeKindDefinition('done')?.role, 'summary');
assert.equal(isKnownNodeKind('candidate'), true);
assert.equal(isKnownNodeKind('review'), false);

const listedDefinitions = listNodeKindDefinitions();
assert.notEqual(
  listedDefinitions[0],
  NODE_KIND_DEFINITIONS[0],
  'listed node definitions should be returned as copies',
);
assert.deepEqual(
  listedDefinitions.map((definition) => definition.id),
  ['main', 'branch', 'candidate', 'done'],
);

const payload = createWorkbenchNodeDefinitionsPayload();
assert.deepEqual(payload.nodeKinds, ['main', 'branch', 'candidate', 'done']);
assert.deepEqual(payload.nodeLanes, ['main', 'branch', 'side']);
assert.deepEqual(payload.nodeRoles, ['state', 'action', 'summary']);
assert.deepEqual(payload.nodeMergePolicies, ['replace-latest', 'append']);
assert.equal(
  payload.nodeKindDefinitions.find((definition) => definition.id === 'branch')?.label,
  '子任务',
);

console.log('test-workbench-node-definitions: ok');
