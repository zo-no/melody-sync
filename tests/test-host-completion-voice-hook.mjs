#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const { hostCompletionVoiceHook } = await import(
  pathToFileURL(join(repoRoot, 'backend', 'hooks', 'host-completion-voice-hook.mjs')).href
);

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-a',
      session: { id: 'session-a', name: 'Alpha' },
    },
    {
      enqueueHostCompletionSpeechImpl: async (options) => {
        calls.push(options.speechText);
      },
      logError: () => {},
    },
  );
  assert.deepEqual(
    calls,
    ['Alpha，需要你处理。'],
    'hook should speak a short session-level user-action reminder',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-c',
      session: {
        id: 'session-c',
        name: 'Alpha',
        taskCard: {
          nextSteps: ['先确认导出结果'],
        },
      },
    },
    {
      enqueueHostCompletionSpeechImpl: async (options) => {
        calls.push(options.speechText);
      },
      logError: () => {},
    },
  );
  assert.deepEqual(
    calls,
    ['Alpha，需要你处理。'],
    'hook should keep the speech short even when task-card detail exists',
  );
}

{
  const errors = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-b',
      session: { id: 'session-b', name: 'Gamma' },
    },
    {
      enqueueHostCompletionSpeechImpl: async () => {
        throw new Error('say failed');
      },
      logError: (message) => errors.push(String(message)),
    },
  );
  assert.equal(errors.length, 1, 'hook should log playback failures');
  assert.match(errors[0], /say failed/);
}

console.log('test-host-completion-voice-hook: ok');
