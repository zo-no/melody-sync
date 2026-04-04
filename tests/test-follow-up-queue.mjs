#!/usr/bin/env node
import assert from 'assert/strict';
import { createFollowUpQueueHelpers } from '../backend/follow-up-queue.mjs';

const helpers = createFollowUpQueueHelpers({
  normalizeSourceContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return JSON.parse(JSON.stringify(value));
  },
  sanitizeQueuedFollowUpAttachments(images) {
    return (images || []).map((entry) => ({
      ...(entry?.assetId ? { assetId: entry.assetId } : {}),
      ...(entry?.filename ? { filename: entry.filename } : {}),
    }));
  },
  formatAttachmentContextLine(images) {
    if (!Array.isArray(images) || images.length === 0) return '';
    return `Attachments: ${images.length}`;
  },
  maxRecentFollowUpRequestIds: 3,
});

const queue = [
  {
    requestId: 'r1',
    text: '先做第一步',
    queuedAt: '2026-04-04T00:00:00.000Z',
    sourceContext: { kind: 'session', id: 's1' },
  },
  {
    requestId: 'r2',
    text: '然后修第二步',
    queuedAt: '2026-04-04T00:01:00.000Z',
    sourceContext: { kind: 'session', id: 's2' },
    images: [{ assetId: 'a1', filename: 'foo.png' }],
    tool: 'codex',
    thinking: true,
  },
];

assert.equal(helpers.getFollowUpQueueCount({ followUpQueue: queue }), 2);
assert.deepEqual(helpers.buildQueuedFollowUpSourceContext(queue), {
  queuedMessages: [
    { requestId: 'r1', sourceContext: { kind: 'session', id: 's1' } },
    { requestId: 'r2', sourceContext: { kind: 'session', id: 's2' } },
  ],
});
assert.match(helpers.buildQueuedFollowUpTranscriptText(queue), /Queued follow-up messages sent while MelodySync was busy/);
assert.match(helpers.buildQueuedFollowUpDispatchText(queue), /The user sent 2 follow-up messages while you were busy/);
assert.deepEqual(helpers.resolveQueuedFollowUpDispatchOptions(queue, { tool: 'claude' }), {
  tool: 'codex',
  model: undefined,
  effort: undefined,
  thinking: true,
});
assert.equal(
  helpers.removeDispatchedQueuedFollowUps(queue, [queue[0]]).length,
  1,
  'prefix-dispatched queue entries should be removed',
);
assert.deepEqual(
  helpers.trimRecentFollowUpRequestIds(['r1', 'r2', 'r1', 'r3', 'r4']),
  ['r2', 'r3', 'r4'],
);
assert.equal(helpers.hasRecentFollowUpRequestId({ recentFollowUpRequestIds: ['r1', 'r2', 'r3'] }, 'r2'), true);
assert.equal(helpers.findQueuedFollowUpByRequest({ followUpQueue: queue }, 'r2')?.requestId, 'r2');
assert.equal(helpers.serializeQueuedFollowUp(queue[1]).images[0].assetId, 'a1');

console.log('test-follow-up-queue: ok');
