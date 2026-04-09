#!/usr/bin/env node
import assert from 'assert/strict';
import { EventEmitter } from 'events';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-completion-speech-queue-'));
const runtimeRoot = join(tempHome, '.melodysync', 'runtime');
const configDir = join(tempHome, '.config', 'melody-sync');
const completionVoiceDir = join(runtimeRoot, 'voice', 'host-completion-voice');
const queueDir = join(completionVoiceDir, 'queue');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, 'general-settings.json'), JSON.stringify({
  runtimeRoot,
}, null, 2), 'utf8');

try {
  const {
    drainHostCompletionSpeechQueue,
    archiveFailedSpeechJob,
    clearCompletionNotice,
    markCompletionNoticeDelivered,
    markCompletionNoticeQueued,
    resumeHostCompletionSpeechQueue,
    startHostCompletionSpeechQueueWatchdog,
    stopHostCompletionSpeechQueueWatchdog,
    resolveHostCompletionVoiceWorkerScript,
    shouldSkipCompletionNotice,
    waitForHostCompletionVoiceWorkerReady,
  } = await import(
    pathToFileURL(join(repoRoot, 'backend', 'completion-speech-queue.mjs')).href
  );

  assert.equal(
    resolveHostCompletionVoiceWorkerScript(),
    join(repoRoot, 'scripts', 'voice', 'host-completion-voice-worker.mjs'),
    'completion speech queue should resolve the relocated worker script',
  );

  mkdirSync(queueDir, { recursive: true });
  const queuedJobPath = join(queueDir, 'job-a.json');
  writeFileSync(queuedJobPath, JSON.stringify({ speechText: 'queued' }), 'utf8');
  await markCompletionNoticeQueued('notice-a', 'job-a');
  assert.equal(
    await shouldSkipCompletionNotice('notice-a'),
    true,
    'queued notices should be deduped while the queue file still exists',
  );

  unlinkSync(queuedJobPath);
  assert.equal(
    await shouldSkipCompletionNotice('notice-a'),
    false,
    'stale queued notices should be pruned once the queue file disappears',
  );

  const scannedQueuedJobPath = join(queueDir, 'job-scan.json');
  writeFileSync(scannedQueuedJobPath, JSON.stringify({
    speechText: 'queued-scan',
    completionNoticeKey: 'notice-scan',
  }), 'utf8');
  assert.equal(
    await shouldSkipCompletionNotice('notice-scan'),
    true,
    'queued jobs should still dedupe even if the queued marker has not been persisted yet',
  );
  unlinkSync(scannedQueuedJobPath);

  await markCompletionNoticeDelivered('notice-b', {
    deliveredAt: Date.now(),
    expiresAt: Date.now() + 1000,
  });
  assert.equal(
    await shouldSkipCompletionNotice('notice-b'),
    true,
    'delivered notices should stay deduped until their ttl expires',
  );
  await clearCompletionNotice('notice-b');
  assert.equal(
    await shouldSkipCompletionNotice('notice-b'),
    false,
    'clearing a delivered notice should make it enqueueable again',
  );

  const drainJobPath = join(queueDir, 'job-drain.json');
  writeFileSync(drainJobPath, JSON.stringify({
    speechText: 'drain-me',
    completionNoticeKey: 'notice-drain',
  }), 'utf8');
  await markCompletionNoticeQueued('notice-drain', 'job-drain');
  const played = [];
  await drainHostCompletionSpeechQueue({
    playHostCompletionSoundImpl: async (job) => {
      played.push(job.speechText);
    },
  });
  assert.deepEqual(played, ['drain-me'], 'in-process drain should play queued jobs in the current process');
  assert.equal(
    await shouldSkipCompletionNotice('notice-drain'),
    true,
    'in-process drain should mark played jobs as delivered',
  );

  const failedJobPath = join(queueDir, 'job-b.json');
  writeFileSync(failedJobPath, JSON.stringify({
    speechText: 'failed',
    completionNoticeKey: 'notice-failed',
  }), 'utf8');
  const archivedPath = await archiveFailedSpeechJob(
    failedJobPath,
    { speechText: 'failed', completionNoticeKey: 'notice-failed' },
    new Error('boom'),
  );
  assert.equal(archivedPath.endsWith('/job-b.json'), true, 'failed jobs should be archived under their job id');

  {
    const calls = [];
    const mode = await resumeHostCompletionSpeechQueue({
      listQueuedSpeechJobsImpl: async () => ['job-a.json'],
      ensureWorkerImpl: async () => {
        calls.push('worker');
      },
      kickHostCompletionSpeechDrainImpl: () => {
        calls.push('inproc');
      },
      appendWorkerLogImpl: async () => {},
    });
    assert.equal(mode, 'worker', 'resume should prefer the detached worker when it can start');
    assert.deepEqual(calls, ['worker']);
  }

  {
    const calls = [];
    const mode = await resumeHostCompletionSpeechQueue({
      listQueuedSpeechJobsImpl: async () => ['job-a.json'],
      ensureWorkerImpl: async () => {
        throw new Error('worker boot failed');
      },
      kickHostCompletionSpeechDrainImpl: () => {
        calls.push('inproc');
      },
      appendWorkerLogImpl: async () => {
        calls.push('log');
      },
    });
    assert.equal(mode, 'inproc', 'resume should fall back to in-process draining when the worker fails');
    assert.deepEqual(calls, ['log', 'inproc']);
  }

  {
    const calls = [];
    const mode = await resumeHostCompletionSpeechQueue({
      listQueuedSpeechJobsImpl: async () => ['job-a.json'],
      ensureWorkerImpl: async () => {
        throw new Error('worker boot timed out');
      },
      readWorkerPidImpl: async () => 4242,
      isPidAliveImpl: (pid) => pid === 4242,
      kickHostCompletionSpeechDrainImpl: () => {
        calls.push('inproc');
      },
      appendWorkerLogImpl: async () => {
        calls.push('log');
      },
    });
    assert.equal(mode, 'worker', 'resume should trust a late-but-live worker instead of double-starting in-process drain');
    assert.deepEqual(calls, ['log']);
  }

  {
    const mode = await resumeHostCompletionSpeechQueue({
      listQueuedSpeechJobsImpl: async () => [],
      ensureWorkerImpl: async () => {
        throw new Error('should not run');
      },
      kickHostCompletionSpeechDrainImpl: () => {
        throw new Error('should not run');
      },
      appendWorkerLogImpl: async () => {},
    });
    assert.equal(mode, 'idle', 'resume should stay idle when the queue is empty');
  }

  {
    const calls = [];
    let scheduledTick = null;
    const watchdog = startHostCompletionSpeechQueueWatchdog({
      intervalMs: 1000,
      setIntervalImpl: (fn) => {
        scheduledTick = fn;
        return { fake: true };
      },
      clearIntervalImpl: () => {
        calls.push('cleared');
      },
      listQueuedSpeechJobsImpl: async () => ['job-a.json'],
      resumeHostCompletionSpeechQueueImpl: async () => {
        calls.push('resume');
        return 'worker';
      },
      appendWorkerLogImpl: async () => {},
    });
    assert.equal(typeof scheduledTick, 'function', 'watchdog should register an interval tick');
    await watchdog.tick();
    await scheduledTick();
    watchdog.stop();
    assert.deepEqual(calls, ['resume', 'resume', 'cleared'], 'watchdog should resume queued work and stop cleanly');
    stopHostCompletionSpeechQueueWatchdog();
  }

  {
    const calls = [];
    let scheduledTick = null;
    const watchdog = startHostCompletionSpeechQueueWatchdog({
      intervalMs: 1000,
      setIntervalImpl: (fn) => {
        scheduledTick = fn;
        return { fake: true };
      },
      clearIntervalImpl: () => {},
      listQueuedSpeechJobsImpl: async () => [],
      resumeHostCompletionSpeechQueueImpl: async () => {
        calls.push('resume');
        return 'worker';
      },
      appendWorkerLogImpl: async () => {},
    });
    await scheduledTick();
    watchdog.stop();
    assert.deepEqual(calls, [], 'watchdog should stay idle when there are no queued jobs');
    stopHostCompletionSpeechQueueWatchdog();
  }

  {
    const child = new EventEmitter();
    child.pid = 4242;
    let reads = 0;
    const readyPid = await waitForHostCompletionVoiceWorkerReady({
      child,
      timeoutMs: 100,
      pollMs: 0,
      readWorkerPidImpl: async () => {
        reads += 1;
        return reads >= 2 ? 4242 : null;
      },
      isPidAliveImpl: (pid) => pid === 4242,
      sleepImpl: async () => {},
    });
    assert.equal(readyPid, 4242, 'worker readiness should resolve once the pid file becomes readable');
  }

  {
    const child = new EventEmitter();
    child.pid = 4343;
    let emitted = false;
    await assert.rejects(
      waitForHostCompletionVoiceWorkerReady({
        child,
        timeoutMs: 100,
        pollMs: 0,
        readWorkerPidImpl: async () => null,
        isPidAliveImpl: () => false,
        sleepImpl: async () => {
          if (!emitted) {
            emitted = true;
            child.emit('exit', 1, null);
          }
        },
      }),
      /exited before ready/,
      'worker readiness should fail fast when the child exits before writing its pid',
    );
  }

  console.log('test-completion-speech-queue: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
