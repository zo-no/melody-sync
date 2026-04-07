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
const MAX_RAW_FALLBACK_LINES = 40;
const MAX_RAW_FALLBACK_CHARS = 8000;
const DEFAULT_API_RETRY_COUNT_LIMIT = 8;
const DEFAULT_API_RETRY_STALL_MS = 25000;

function toPositiveInt(value, fallback, { min = 1 } = {}) {
  const parsed = parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function truncateText(text, maxChars) {
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizeFallbackLines(lines) {
  const compact = (Array.isArray(lines) ? lines : [])
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)
    .join('\n');
  return truncateText(compact.replace(/\s+/g, ' ').trim(), MAX_RAW_FALLBACK_CHARS);
}

function toStringOrUndefined(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return String(value.message || value.toString()).trim();
  if (typeof value === 'object') {
    if (typeof value.message === 'string') {
      return value.message.trim();
    }
    try {
      return JSON.stringify(value).trim();
    } catch {
      return '';
    }
  }
  return '';
}

function extractFailureReasonFromParsedLine(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  if (parsed.type !== 'result' || parsed.is_error !== true) return '';
  const candidates = [
    parsed.result,
    parsed.error,
    parsed.message,
    parsed.summary,
  ];
  for (const candidate of candidates) {
    const text = toStringOrUndefined(candidate);
    if (text) return truncateText(text, MAX_RAW_FALLBACK_CHARS);
  }
  return '';
}

function classifyProviderFailureText(value) {
  const text = toStringOrUndefined(value);
  if (!text) return '';
  if (/Detached runner disappeared before writing a result/i.test(text)) {
    return `Provider terminated before persisting result: ${text}`;
  }
  if (/connection (closed|reset|terminated|was forcibly closed)|socket hang up|EPIPE|ECONNRESET/i.test(text)) {
    return `Provider transport disrupted before result completion: ${text}`;
  }
  return '';
}

async function cleanEnv(toolId, manifest = {}, options = {}) {
  const env = buildToolProcessEnv();
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  env.MELODYSYNC_CHAT_BASE_URL = process.env.MELODYSYNC_CHAT_BASE_URL || `http://127.0.0.1:${CHAT_PORT}`;
  env.MELODYSYNC_PROJECT_ROOT = process.env.MELODYSYNC_PROJECT_ROOT || PROJECT_ROOT;
  if (typeof manifest?.sessionId === 'string' && manifest.sessionId.trim()) {
    env.MELODYSYNC_SESSION_ID = manifest.sessionId.trim();
  }
  if (runId) {
    env.MELODYSYNC_RUN_ID = runId;
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
  const apiRetryCountLimit = toPositiveInt(
    process.env.MELODYSYNC_CLAUDE_API_RETRY_LIMIT,
    DEFAULT_API_RETRY_COUNT_LIMIT,
  );
  const apiRetryStallMs = toPositiveInt(
    process.env.MELODYSYNC_CLAUDE_API_RETRY_STALL_MS,
    DEFAULT_API_RETRY_STALL_MS,
    { min: 5000 },
  );

  await updateRun(runId, (current) => ({
    ...current,
    toolProcessId: proc.pid,
  }));

  let finalized = false;
  let cancelSent = false;
  let forcedFailureReason = '';
  const apiRetryEvents = [];
  let hasAssistantMessage = false;
  let transportAbortRequested = false;
  const terminationController = createTerminationController(proc, {
    terminationGraceMs: providerTerminationGraceMs,
  });
  const transportMonitor = createCodexTransportMonitor({
    runtimeFamily,
    graceMs: providerTransportFailureGraceMs,
  });
  const rawStdoutLines = [];
  const rawStderrLines = [];
  let sawStructuredStdout = false;
  const applyProviderFailure = async (reason) => {
    const classified = classifyProviderFailureText(reason);
    if (!classified || forcedFailureReason) return;
    forcedFailureReason = classified;
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
  };
  const applyProviderFailureFromTransport = async (reason) => {
    const normalized = toStringOrUndefined(reason);
    if (!normalized || forcedFailureReason) return;
    forcedFailureReason = normalized;
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
  };

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
      await applyProviderFailureFromTransport(pendingFailure.reason);
    })();
  }, 500);
  const pruneApiRetryEvents = (now = Date.now()) => {
    while (apiRetryEvents.length > 0 && (now - apiRetryEvents[0]) > apiRetryStallMs) {
      apiRetryEvents.shift();
    }
  };
  const trackApiRetryEvent = (line, now = Date.now()) => {
    if (!line || typeof line !== 'string') return;
    if (!/api_retry/i.test(line)) return;
    apiRetryEvents.push(now);
    pruneApiRetryEvents(now);
  };
  const hasApiRetryStall = () => apiRetryEvents.length >= apiRetryCountLimit;
  const collectRawFallbackText = () => normalizeFallbackLines([...rawStdoutLines, ...rawStderrLines]);

  const appendClaudeRawOutputFallback = async ({ code }) => {
    if (
      runtimeFamily !== 'claude-stream-json'
      || code !== 0
      || forcedFailureReason
      || sawStructuredStdout
      || !(rawStdoutLines.length || rawStderrLines.length)
    ) return;

    const combinedText = collectRawFallbackText();
    if (!combinedText) return;

    await appendRunSpoolRecord(runId, {
      ts: nowIso(),
      stream: 'error',
      line: `No structured runtime output was produced for this session. Raw output: ${combinedText}`,
    });
  };

  const apiRetryWatchdog = setInterval(() => {
    void (async () => {
      if (
        finalized
        || hasAssistantMessage
        || forcedFailureReason
      ) return;
      const now = Date.now();
      pruneApiRetryEvents(now);
      if (!hasApiRetryStall()) return;
      forcedFailureReason = `Claude API retry loop without assistant output for ${Math.round(apiRetryStallMs / 1000)}s`;
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
  if (typeof apiRetryWatchdog.unref === 'function') {
    apiRetryWatchdog.unref();
  }

  const recordStdoutLine = async (line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      sawStructuredStdout = true;
      if (parsed.type === 'assistant') {
        hasAssistantMessage = true;
      }
      if (!forcedFailureReason) {
        const parsedFailureReason = extractFailureReasonFromParsedLine(parsed);
        if (parsedFailureReason) {
          forcedFailureReason = parsedFailureReason;
          await updateRun(runId, (current) => ({
            ...current,
            failureReason: forcedFailureReason,
          }));
          await appendRunSpoolRecord(runId, {
            ts: nowIso(),
            stream: 'error',
            line: forcedFailureReason,
          });
        }
      }
      trackApiRetryEvent(String(parsed.subtype || ''));
    } else if (line && typeof line === 'string') {
      const clean = line.trim();
      if (clean) {
        rawStdoutLines.push(clean);
        if (rawStdoutLines.length > MAX_RAW_FALLBACK_LINES) {
          rawStdoutLines.shift();
        }
        await applyProviderFailure(clean);
        trackApiRetryEvent(clean);
      }
    }
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
      await applyProviderFailure(clean);
      trackApiRetryEvent(clean);
      rawStderrLines.push(clean);
      if (rawStderrLines.length > MAX_RAW_FALLBACK_LINES) {
        rawStderrLines.shift();
      }
      await appendRunSpoolRecord(runId, {
        ts: nowIso(),
        stream: 'stderr',
        line: clean,
      });
    }
  };

  const markClaudeRawFailureFromFallback = async () => {
    if (
      runtimeFamily !== 'claude-stream-json'
      || sawStructuredStdout
      || hasAssistantMessage
      || forcedFailureReason
    ) return;

    const combinedText = collectRawFallbackText();
    if (!combinedText) return;

    forcedFailureReason = `Provider exited without structured output despite raw content: ${combinedText}`;
    await updateRun(runId, (current) => ({
      ...current,
      failureReason: forcedFailureReason,
    }));
    await appendRunSpoolRecord(runId, {
      ts: nowIso(),
      stream: 'error',
      line: forcedFailureReason,
    });
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
      try {
        finalized = true;
        clearInterval(cancelTimer);
        clearInterval(transportWatchdog);
        clearInterval(apiRetryWatchdog);
        terminationController.clearTerminateTimer();
        await finalizeSidecarRunError(runId, {
          nowIso,
          error,
          forcedFailureReason,
        });
      } catch (finalizationError) {
        await finalizeSidecarRunError(runId, {
          nowIso,
          error: finalizationError,
          forcedFailureReason,
        });
      } finally {
        process.exit(1);
      }
    })();
  });

  proc.on('exit', (code, signal) => {
    void (async () => {
      try {
        finalized = true;
        clearInterval(cancelTimer);
        clearInterval(transportWatchdog);
        clearInterval(apiRetryWatchdog);
        terminationController.clearTerminateTimer();
        if (!forcedFailureReason) {
          await markClaudeRawFailureFromFallback();
        }
        await appendClaudeRawOutputFallback({ code: code ?? 1 });
        const exitCode = await finalizeSidecarRunExit(runId, run, {
          nowIso,
          appendCodexContextMetrics,
          code,
          signal,
          forcedFailureReason,
        });
        process.exit(exitCode);
      } catch (finalizationError) {
        await finalizeSidecarRunError(runId, {
          nowIso,
          error: finalizationError,
          forcedFailureReason,
        });
        process.exit(1);
      }
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
