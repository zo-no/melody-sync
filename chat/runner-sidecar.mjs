#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createToolInvocation, prependAttachmentPaths, resolveCommand, resolveCwd } from './process-runner.mjs';
import { materializeFileAssetAttachments } from './file-assets.mjs';
import {
  buildCodexContextMetricsPayload,
  readLatestCodexSessionMetrics,
} from './codex-session-metrics.mjs';
import { CHAT_PORT } from '../lib/config.mjs';
import {
  appendRunSpoolRecord,
  getRun,
  getRunManifest,
  updateRun,
} from './runs.mjs';
import { buildToolProcessEnv } from '../lib/user-shell-env.mjs';
import { applyManagedRuntimeEnv } from './runtime-policy.mjs';
import {
  finalizeSidecarRunError,
  finalizeSidecarRunExit,
} from './runner-sidecar-finalize.mjs';
import {
  createCodexTransportMonitor,
  createTerminationController,
  getProviderTerminationGraceMs,
  getProviderTransportFailureGraceMs,
} from './provider-runtime-monitor.mjs';

const runId = process.argv[2];
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

function nowIso() {
  return new Date().toISOString();
}

async function cleanEnv(toolId, manifest = {}, options = {}) {
  const env = buildToolProcessEnv();
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  env.REMOTELAB_CHAT_BASE_URL = process.env.REMOTELAB_CHAT_BASE_URL || `http://127.0.0.1:${CHAT_PORT}`;
  env.REMOTELAB_PROJECT_ROOT = process.env.REMOTELAB_PROJECT_ROOT || PROJECT_ROOT;
  if (typeof manifest?.sessionId === 'string' && manifest.sessionId.trim()) {
    env.REMOTELAB_SESSION_ID = manifest.sessionId.trim();
  }
  if (runId) {
    env.REMOTELAB_RUN_ID = runId;
  }
  return applyManagedRuntimeEnv(toolId, env, {
    runtimeFamily: typeof options.runtimeFamily === 'string' ? options.runtimeFamily : '',
  });
}

function captureResume(run, parsed) {
  if (!run || !parsed || typeof parsed !== 'object') return null;
  if (parsed.session_id) {
    return {
      claudeSessionId: parsed.session_id,
      providerResumeId: parsed.session_id,
    };
  }
  if (parsed.type === 'thread.started' && parsed.thread_id) {
    return {
      codexThreadId: parsed.thread_id,
      providerResumeId: parsed.thread_id,
    };
  }
  return null;
}

async function appendCodexContextMetrics(runId) {
  const current = await getRun(runId);
  if (!current?.codexThreadId) return null;

  const metrics = await readLatestCodexSessionMetrics(current.codexThreadId);
  const payload = buildCodexContextMetricsPayload(metrics);
  if (!payload) return null;

  const line = JSON.stringify(payload);
  await appendRunSpoolRecord(runId, {
    ts: nowIso(),
    stream: 'stdout',
    line,
    json: payload,
  });

  await updateRun(runId, (draft) => ({
    ...draft,
    contextInputTokens: metrics.contextTokens,
    ...(Number.isInteger(metrics.contextWindowTokens)
      ? { contextWindowTokens: metrics.contextWindowTokens }
      : {}),
  }));

  return metrics;
}


async function main() {
  if (!runId) {
    process.exit(1);
  }

  const run = await getRun(runId);
  const manifest = await getRunManifest(runId);
  if (!run || !manifest) {
    process.exit(1);
  }

  await updateRun(runId, (current) => ({
    ...current,
    state: 'running',
    startedAt: current.startedAt || nowIso(),
    runnerProcessId: process.pid,
  }));

  const materializedImages = await materializeFileAssetAttachments(manifest.options?.images || []);
  if (materializedImages.some((attachment) => typeof attachment?.assetId === 'string' && typeof attachment?.savedPath === 'string')) {
    await appendRunSpoolRecord(runId, {
      ts: nowIso(),
      stream: 'stdout',
      line: JSON.stringify({
        type: 'status',
        content: 'Localized external file attachments for this run.',
      }),
      json: {
        type: 'status',
        content: 'Localized external file attachments for this run.',
      },
    });
  }

  const prompt = prependAttachmentPaths(manifest.prompt || '', materializedImages);
  const { command, args, runtimeFamily } = await createToolInvocation(manifest.tool, prompt, {
    dangerouslySkipPermissions: true,
    claudeSessionId: manifest.options?.claudeSessionId,
    codexThreadId: manifest.options?.codexThreadId,
    thinking: manifest.options?.thinking,
    model: manifest.options?.model,
    effort: manifest.options?.effort,
  });

  const proc = spawn(await resolveCommand(command), args, {
    cwd: resolveCwd(manifest.folder),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: await cleanEnv(manifest.tool, manifest, { runtimeFamily }),
  });
  const providerTransportFailureGraceMs = getProviderTransportFailureGraceMs(process.env);
  const providerTerminationGraceMs = getProviderTerminationGraceMs(process.env);

  await updateRun(runId, (current) => ({
    ...current,
    toolProcessId: proc.pid,
  }));

  let finalized = false;
  let cancelSent = false;
  let forcedFailureReason = '';
  let transportAbortRequested = false;
  const terminationController = createTerminationController(proc, {
    terminationGraceMs: providerTerminationGraceMs,
  });
  const transportMonitor = createCodexTransportMonitor({
    runtimeFamily,
    graceMs: providerTransportFailureGraceMs,
  });

  const cancelTimer = setInterval(() => {
    void (async () => {
      const current = await getRun(runId);
      if (!current?.cancelRequested || cancelSent) return;
      cancelSent = true;
      terminationController.requestTermination();
    })();
  }, 250);
  const transportWatchdog = setInterval(() => {
    void (async () => {
      if (finalized || transportAbortRequested) return;
      const pendingFailure = transportMonitor.getPendingFailure();
      if (!pendingFailure) return;
      transportAbortRequested = true;
      forcedFailureReason = forcedFailureReason || pendingFailure.reason;
      await appendRunSpoolRecord(runId, {
        ts: nowIso(),
        stream: 'error',
        line: forcedFailureReason,
      });
      await updateRun(runId, (current) => ({
        ...current,
        failureReason: forcedFailureReason,
      }));
      terminationController.requestTermination();
    })();
  }, 500);
  if (typeof transportWatchdog.unref === 'function') {
    transportWatchdog.unref();
  }

  const recordStdoutLine = async (line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {}
    transportMonitor.observeStdoutJson(parsed);
    await appendRunSpoolRecord(runId, {
      ts: nowIso(),
      stream: 'stdout',
      line,
      ...(parsed ? { json: parsed } : {}),
    });
    const resumeUpdate = captureResume(await getRun(runId), parsed);
    if (resumeUpdate) {
      await updateRun(runId, (current) => ({
        ...current,
        ...resumeUpdate,
      }));
    }
  };

  const recordStderrText = async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    for (const line of trimmed.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean) continue;
      transportMonitor.observeStderrLine(clean);
      await appendRunSpoolRecord(runId, {
        ts: nowIso(),
        stream: 'stderr',
        line: clean,
      });
    }
  };

  // Backpressure-aware stdout reader: pause the readline interface while
  // the async spool write is in flight so the tool process is never blocked
  // by a full pipe buffer.
  const rl = createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    rl.pause();
    recordStdoutLine(line).finally(() => rl.resume());
  });
  proc.stderr.on('data', (chunk) => {
    void recordStderrText(chunk.toString());
  });

  proc.on('error', (error) => {
    void (async () => {
      finalized = true;
      clearInterval(cancelTimer);
      clearInterval(transportWatchdog);
      terminationController.clearTerminateTimer();
      await finalizeSidecarRunError(runId, {
        nowIso,
        error,
        forcedFailureReason,
      });
      process.exit(1);
    })();
  });

  proc.on('exit', (code, signal) => {
    void (async () => {
      finalized = true;
      clearInterval(cancelTimer);
      clearInterval(transportWatchdog);
      terminationController.clearTerminateTimer();
      const exitCode = await finalizeSidecarRunExit(runId, run, {
        nowIso,
        appendCodexContextMetrics,
        code,
        signal,
        forcedFailureReason,
      });
      process.exit(exitCode);
    })();
  });
}

main().catch((error) => {
  void (async () => {
    await finalizeSidecarRunError(runId, {
      nowIso,
      error,
    });
    process.exit(1);
  })();
});
