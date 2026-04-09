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
    ['Alpha，你可以看一下。'],
    'hook should fall back to a short session-level update when task-card detail is absent',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-c',
      session: {
        id: 'session-c',
        ordinal: 12,
        name: 'Alpha',
        taskCard: {
          goal: '语音播报缺失排查',
          summary: '恢复播报',
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
    ['任务12，下一步，先确认导出结果。'],
    'hook should prefer the stable task number when one is available',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-d',
      session: {
        id: 'session-d',
        ordinal: 13,
        name: 'Alpha',
        taskCard: {
          mainGoal: '语音播报缺失排查',
          summary: '发布异常',
          needsFromUser: ['决定是否重试'],
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
    ['任务13，决定是否重试。'],
    'hook should keep spoken task references short by using the stable ordinal',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-e',
      session: {
        id: 'session-e',
        ordinal: 14,
        name: 'Alpha',
        taskCard: {
          mainGoal: '语音播报缺失排查',
          summary: '恢复播报',
          knownConclusions: ['已修复 worker 路径回归'],
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
    ['任务14，已修复 worker 路径回归。'],
    'hook should announce completion outcomes against the stable task ordinal',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-internal-role',
      session: {
        id: 'session-internal-role',
        internalRole: 'session_list_organizer',
        name: 'sort session list',
        ordinal: 88,
        taskCard: {
          nextSteps: ['按模板重排 20 个任务'],
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
    [],
    'hook should suppress internal organizer sessions',
  );
}

{
  const calls = [];
  await hostCompletionVoiceHook(
    {
      sessionId: 'session-internal-operation',
      session: {
        id: 'session-internal-operation',
        ordinal: 89,
        name: 'Alpha',
        taskCard: {
          nextSteps: ['按模板重排 20 个任务'],
        },
      },
      manifest: {
        internalOperation: 'session_organize',
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
    [],
    'hook should suppress internal-operation completions',
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
