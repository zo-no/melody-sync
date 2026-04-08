#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildNormalizedRunResultEnvelope,
  mergeRunResultWithEnvelope,
  runResultEnvelopeHasMeaningfulContent,
} from '../backend/run/result-envelope.mjs';

const envelope = buildNormalizedRunResultEnvelope({
  result: {
    exitCode: 0,
  },
  normalizedEvents: [
    { type: 'message', role: 'assistant', content: '无关消息' },
    {
      type: 'message',
      role: 'assistant',
      content: '已完成。\n<private><task_card>{\"goal\":\"梳理会话流程\",\"checkpoint\":\"下一步拆 finalize\",\"lineRole\":\"main\"}</task_card></private>',
    },
  ],
  parseTaskCardFromAssistantContent(content) {
    if (!content.includes('task_card')) return null;
    return {
      goal: '梳理会话流程',
      checkpoint: '下一步拆 finalize',
      lineRole: 'main',
    };
  },
});

assert.deepEqual(
  envelope,
  {
    assistantMessage: '已完成。\n<private><task_card>{"goal":"梳理会话流程","checkpoint":"下一步拆 finalize","lineRole":"main"}</task_card></private>',
    statePatch: {
      goal: '梳理会话流程',
      checkpoint: '下一步拆 finalize',
      needsUser: false,
      lineRole: 'main',
      branchFrom: '',
    },
    actionRequests: [],
    memoryCandidates: [],
    trace: [],
  },
  'run result envelope should synthesize assistant text and state patch from the latest assistant message when run result has no structured fields yet',
);

assert.equal(
  runResultEnvelopeHasMeaningfulContent(envelope),
  true,
  'derived envelopes with assistant text and state patch should count as meaningful',
);

assert.deepEqual(
  mergeRunResultWithEnvelope({ exitCode: 0 }, envelope),
  {
    exitCode: 0,
    assistantMessage: '已完成。\n<private><task_card>{"goal":"梳理会话流程","checkpoint":"下一步拆 finalize","lineRole":"main"}</task_card></private>',
    statePatch: {
      goal: '梳理会话流程',
      checkpoint: '下一步拆 finalize',
      needsUser: false,
      lineRole: 'main',
      branchFrom: '',
    },
  },
  'run result merging should preserve transport fields and append normalized envelope fields',
);

console.log('test-run-result-envelope: ok');
