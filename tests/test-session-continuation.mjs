#!/usr/bin/env node
import assert from 'assert/strict';

const {
  prepareSessionContinuationBody,
  buildSessionContinuationContextFromBody,
} = await import('../backend/session-continuation.mjs');

const defaultContext = buildSessionContinuationContextFromBody('[User]\ncontinue');
assert.match(defaultContext, /MelodySync session continuity handoff for this existing conversation/);

const switchedContext = buildSessionContinuationContextFromBody('[User]\ncontinue', {
  fromTool: 'claude',
  toTool: 'codex',
});
assert.match(switchedContext, /MelodySync session continuity handoff: the user switched tools from claude to codex/);

const attachmentBody = prepareSessionContinuationBody([
  {
    type: 'message',
    role: 'user',
    content: 'Please keep using the uploaded file.',
    images: [{
      filename: 'abc123.csv',
      originalName: 'report.csv',
      savedPath: '/tmp/melodysync/report-abc123.csv',
      mimeType: 'text/csv',
    }],
  },
]);
assert.match(attachmentBody, /\[Attached files: report\.csv -> \/tmp\/melodysync\/report-abc123\.csv\]/);

console.log('test-session-continuation: ok');
