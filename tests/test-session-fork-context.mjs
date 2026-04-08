#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const forkContext = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session-fork-context.mjs')).href
);

const {
  buildPreparedContinuationContext,
  isPreparedForkContextCurrent,
} = forkContext;

{
  const continuation = buildPreparedContinuationContext({
    summary: 'legacy summary should stay hidden',
    continuationBody: '[Assistant]\n# Auto Compress\n\n## Kept in live context\n- Continue from the new handoff.',
    includesCompactionHandoff: true,
  }, 'codex', 'codex', {
    goal: '收口 continuation',
    checkpoint: '继续压 prepared.summary 旧链',
  });

  assert.match(continuation, /# Auto Compress/);
  assert.doesNotMatch(continuation, /\[Earlier compressed summary]/);
  assert.doesNotMatch(continuation, /legacy summary should stay hidden/);
}

{
  const continuation = buildPreparedContinuationContext({
    summary: 'summary still appears without a handoff',
    continuationBody: '[User]\n继续推进。',
    includesCompactionHandoff: false,
  }, 'codex', 'codex', {
    goal: '收口 continuation',
    checkpoint: '继续压 prepared.summary 旧链',
  });

  assert.match(continuation, /\[Earlier compressed summary]/);
  assert.match(continuation, /summary still appears without a handoff/);
}

{
  assert.equal(
    isPreparedForkContextCurrent(
      {
        mode: 'summary',
        summary: 'same summary',
        activeFromSeq: 12,
        handoffSeq: 10,
        preparedThroughSeq: 20,
      },
      { latestSeq: 20 },
      {
        summary: 'same summary',
        activeFromSeq: 12,
        handoffSeq: 10,
      },
    ),
    true,
  );

  assert.equal(
    isPreparedForkContextCurrent(
      {
        mode: 'summary',
        summary: 'same summary',
        activeFromSeq: 12,
        handoffSeq: 9,
        preparedThroughSeq: 20,
      },
      { latestSeq: 20 },
      {
        summary: 'same summary',
        activeFromSeq: 12,
        handoffSeq: 10,
      },
    ),
    false,
  );
}

console.log('test-session-fork-context: ok');
