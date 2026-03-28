#!/usr/bin/env node
import assert from 'assert/strict';

import {
  classifyAssistantReplyCandidate,
  stripHiddenBlocks,
} from '../lib/reply-selection.mjs';

assert.equal(
  stripHiddenBlocks('可见内容\n<private>内部信息<\\/private>\n结尾'),
  '可见内容\n\n结尾',
  'escaped private closing tags should still be removed from visible reply selection',
);

assert.equal(
  stripHiddenBlocks('前文<hide>{"action":"accept"}<\\/hide>后文'),
  '前文后文',
  'escaped hide closing tags should still be removed from visible reply selection',
);

const candidate = classifyAssistantReplyCandidate({
  type: 'message',
  role: 'assistant',
  content: '<private><task_card>{"goal":"更新任务卡"}<\\/task_card><\\/private>\n真正答复',
});

assert.equal(candidate.kind, 'select');
assert.equal(candidate.content, '真正答复');

console.log('test-reply-selection-hidden-blocks: ok');
