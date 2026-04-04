#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'graph-client.js'),
  'utf8',
);

const fetchCalls = [];
const context = {
  console,
  fetchJsonOrRedirect: async (url) => {
    fetchCalls.push(url);
    return {
      rootSessionId: 'main-1',
      taskMapGraph: {
        id: 'quest:main-1',
        rootSessionId: 'main-1',
        title: '主任务',
        summary: '',
        currentNodeId: 'session:branch-1',
        currentPathNodeIds: ['session:main-1', 'session:branch-1'],
        nodes: [
          { id: 'session:main-1', kind: 'main', title: '主任务', sessionId: 'main-1' },
          { id: 'session:branch-1', kind: 'branch', title: '支线', sessionId: 'branch-1', parentNodeId: 'session:main-1' },
        ],
        edges: [
          { id: 'edge:session:main-1:session:branch-1', fromNodeId: 'session:main-1', toNodeId: 'session:branch-1', type: 'structural' },
        ],
      },
    };
  },
  window: {},
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, { filename: 'workbench/graph-client.js' });

const api = context.MelodySyncWorkbenchGraphClient;
assert.ok(api, 'graph client api should be exposed');

const response = await api.fetchTaskMapGraphForSession('branch-1');
assert.deepEqual(fetchCalls, ['/api/workbench/sessions/branch-1/task-map-graph']);
const projection = api.buildProjectionFromTaskMapGraph(response.taskMapGraph);
assert.equal(projection.activeMainQuestId, 'quest:main-1');
assert.equal(projection.activeNodeId, 'session:branch-1');
assert.equal(projection.activeMainQuest?.nodes?.length, 2);

console.log('test-workbench-graph-client: ok');
