#!/usr/bin/env node
import assert from 'assert/strict';
import { normalizeAgentResultEnvelope } from '../backend/session-runtime/agent-result-envelope.mjs';

const envelope = normalizeAgentResultEnvelope({
  reply: '已完成第一刀',
  statePatch: {
    goal: '梳理会话流程',
    checkpoint: '下一步改 run-finalization',
    needsUser: 'false',
    lineRole: 'branch',
    branchFrom: '主线会话',
  },
  actionRequests: [
    { action: 'session.rename', args: { title: '重构会话主链' } },
    { action: '' },
  ],
  memoryCandidates: [
    {
      scope: 'project',
      text: 'hooks 应与 agent 核心调用链解耦',
      source: 'agent',
      type: 'skill',
      status: 'pending',
      confidence: '0.82',
      reason: '最近多次重构都遇到相同耦合问题',
      expiresAt: '2026-05-01T00:00:00.000Z',
    },
    { scope: 'user', text: '' },
  ],
  trace: [
    { type: 'decision', text: '选择低风险迁移路径' },
    { type: 'note', text: '' },
  ],
});

assert.deepEqual(
  envelope,
  {
    assistantMessage: '已完成第一刀',
    statePatch: {
      goal: '梳理会话流程',
      checkpoint: '下一步改 run-finalization',
      needsUser: false,
      lineRole: 'branch',
      branchFrom: '主线会话',
    },
    actionRequests: [
      {
        type: 'session.rename',
        args: { title: '重构会话主链' },
      },
    ],
    memoryCandidates: [
      {
        scope: 'project',
        text: 'hooks 应与 agent 核心调用链解耦',
        source: 'agent',
        type: 'skill',
        status: 'candidate',
        confidence: 0.82,
        reason: '最近多次重构都遇到相同耦合问题',
        expiresAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    trace: [
      {
        type: 'decision',
        message: '选择低风险迁移路径',
      },
    ],
  },
  'agent result envelopes should normalize structured outputs into a stable contract',
);

console.log('test-agent-result-envelope: ok');
