#!/usr/bin/env node
import assert from 'assert/strict';

import {
  normalizeAssistantGraphOps,
  parseGraphOpsFromAssistantContent,
  stripGraphOpsFromAssistantContent,
} from '../backend/session/graph-ops.mjs';

const normalized = normalizeAssistantGraphOps({
  operations: [
    {
      type: 'attach',
      source: '重复任务 A',
      target: { title: '主线任务' },
      reason: '挂到主线下，减少重复节点',
    },
    {
      type: 'delete',
      source: { sessionId: 'sess_duplicate' },
      target: '主线任务',
      reason: '重复任务已融合',
    },
  ],
});

assert.deepEqual(
  normalized,
  {
    version: 1,
    operations: [
      {
        type: 'attach',
        source: { ref: '重复任务 A' },
        target: { ref: '主线任务', title: '主线任务' },
        reason: '挂到主线下，减少重复节点',
      },
      {
        type: 'archive',
        source: { ref: 'sess_duplicate', sessionId: 'sess_duplicate' },
        target: { ref: '主线任务' },
        reason: '重复任务已融合',
      },
    ],
  },
  'graph ops should normalize supported attach/archive aliases into a compact stored shape',
);

const parsed = parseGraphOpsFromAssistantContent([
  '我先整理任务图。',
  '<private>',
  '<graph_ops>{',
  '  "operations": [',
  '    {',
  '      "type": "reparent",',
  '      "source": "当前任务",',
  '      "target": "主线",',
  '      "reason": "这条线更适合作为主线的子任务"',
  '    }',
  '  ]',
  '}</graph_ops>',
  '</private>',
].join('\n'));

assert.deepEqual(
  parsed,
  {
    version: 1,
    operations: [
      {
        type: 'attach',
        source: { ref: '当前任务' },
        target: { ref: '主线' },
        reason: '这条线更适合作为主线的子任务',
      },
    ],
  },
  'assistant graph ops should parse from hidden graph_ops blocks',
);

assert.equal(
  stripGraphOpsFromAssistantContent([
    '可见答复',
    '',
    '<private><graph_ops>{"operations":[{"type":"archive","source":"重复任务"}]}</graph_ops></private>',
  ].join('\n')),
  '可见答复',
  'visible assistant prose should strip hidden graph_ops sidecars',
);

console.log('test-session-graph-ops: ok');
