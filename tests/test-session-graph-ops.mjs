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
      type: 'prune',
      source: { sessionId: 'sess_duplicate' },
      target: '主线任务',
      reason: '重复任务已融合',
    },
    {
      type: 'expand_branch',
      source: '当前任务',
      title: '补长期任务减枝规则',
      checkpointSummary: '先盘点现有规则',
      reason: '这一段已经独立成可执行支线',
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
      {
        type: 'expand',
        source: { ref: '当前任务' },
        title: '补长期任务减枝规则',
        checkpoint: '先盘点现有规则',
        reason: '这一段已经独立成可执行支线',
      },
    ],
  },
  'graph ops should normalize attach/prune/expand aliases into a compact stored shape',
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

const parsedExpand = parseGraphOpsFromAssistantContent([
  '我先展开一条新支线。',
  '<private>',
  '<graph_ops>{',
  '  "operations": [',
  '    {',
  '      "type": "expand",',
  '      "source": "当前任务",',
  '      "title": "拆出减枝策略",',
  '      "checkpoint": "先列出已有规则"',
  '    }',
  '  ]',
  '}</graph_ops>',
  '</private>',
].join('\n'));

assert.deepEqual(
  parsedExpand,
  {
    version: 1,
    operations: [
      {
        type: 'expand',
        source: { ref: '当前任务' },
        title: '拆出减枝策略',
        checkpoint: '先列出已有规则',
      },
    ],
  },
  'assistant graph ops should keep explicit expand instructions for later apply',
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
