#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const taskMapReactSource = readFileSync(
  join(repoRoot, 'frontend-src', 'workbench', 'task-map-react-ui.jsx'),
  'utf8',
);

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const context = {
  console,
  getNodeLayoutVariant(_windowRef, node) {
    return String(node?.layoutVariant || 'default').trim() || 'default';
  },
};
context.globalThis = context;

vm.runInNewContext(
  [
    extractFunctionSource(taskMapReactSource, 'trimText'),
    extractFunctionSource(taskMapReactSource, 'getProjectedTaskFlowNodePriority'),
    extractFunctionSource(taskMapReactSource, 'getProjectedTaskFlowPreferredBand'),
    extractFunctionSource(taskMapReactSource, 'resolveProjectedTaskFlowBand'),
    extractFunctionSource(taskMapReactSource, 'getProjectedTaskFlowBands'),
    'globalThis.getProjectedTaskFlowBands = getProjectedTaskFlowBands;',
  ].join('\n\n'),
  context,
  { filename: 'frontend-src/workbench/task-map-react-ui.jsx' },
);

function sortEntries(entries = []) {
  return [...entries].sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)));
}

const graph = {
  nodes: [
    { id: 'session:root', title: '主线', layoutVariant: 'root' },
    { id: 'session:alpha', title: 'Alpha', parentNodeId: 'session:root' },
    { id: 'session:beta', title: 'Beta', parentNodeId: 'session:root' },
  ],
};

const levels = {
  predecessorById: new Map([
    ['session:alpha', 'session:root'],
    ['session:beta', 'session:root'],
  ]),
};

const alphaFocusedBands = context.getProjectedTaskFlowBands({}, graph, levels, 'session:root', {
  currentNodeId: 'session:alpha',
  currentPathNodeIds: ['session:root', 'session:alpha'],
});
const betaFocusedBands = context.getProjectedTaskFlowBands({}, graph, levels, 'session:root', {
  currentNodeId: 'session:beta',
  currentPathNodeIds: ['session:root', 'session:beta'],
});

assert.deepEqual(
  sortEntries(alphaFocusedBands.bandById.entries()),
  sortEntries(betaFocusedBands.bandById.entries()),
  'switching the focused node inside one graph should not change projected band placement',
);

console.log('test-workbench-task-map-layout-stability: ok');
