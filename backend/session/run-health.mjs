import { readLatestCodexSessionMetrics } from '../codex-session-metrics.mjs';
import {
  getRunManifest,
  isTerminalRunState,
  materializeRunSpoolLine,
  readRunSpoolRecords,
  updateRun,
  writeRunResult,
} from '../run/store.mjs';
import {
  buildSessionFolderUnavailableMessage,
  inspectSessionFolder,
} from './folder.mjs';

const DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT = 100;

function parsePositiveIntOrInfinity(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (/^(inf|infinity)$/i.test(trimmed)) return Number.POSITIVE_INFINITY;
  const parsed = parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getConfiguredAutoCompactContextTokens() {
  return parsePositiveIntOrInfinity(process.env.MELODYSYNC_LIVE_CONTEXT_COMPACT_TOKENS);
}

export function getRunLiveContextTokens(run) {
  return Number.isInteger(run?.contextInputTokens) && run.contextInputTokens > 0
    ? run.contextInputTokens
    : null;
}

function getRunContextWindowTokens(run) {
  return Number.isInteger(run?.contextWindowTokens) && run.contextWindowTokens > 0
    ? run.contextWindowTokens
    : null;
}

export function getAutoCompactContextTokens(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  if (configured !== null) {
    return configured;
  }
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (!Number.isInteger(contextWindowTokens)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(
    1,
    Math.floor((contextWindowTokens * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT) / 100),
  );
}

export async function refreshCodexContextMetrics(run) {
  if (!run?.id || !run?.codexThreadId) return null;
  const metrics = await readLatestCodexSessionMetrics(run.codexThreadId);
  if (!Number.isInteger(metrics?.contextTokens)) return null;

  await updateRun(run.id, (current) => ({
    ...current,
    contextInputTokens: metrics.contextTokens,
    ...(Number.isInteger(metrics.contextWindowTokens)
      ? { contextWindowTokens: metrics.contextWindowTokens }
      : {}),
  }));

  return metrics;
}

export function getAutoCompactStatusText(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  const contextTokens = getRunLiveContextTokens(run);
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (configured === null && Number.isInteger(contextTokens) && Number.isInteger(contextWindowTokens)) {
    const percent = ((contextTokens / contextWindowTokens) * 100).toFixed(1);
    return `Live context exceeded the model window (${contextTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()}, ${percent}%) — compacting conversation…`;
  }
  const autoCompactTokens = getAutoCompactContextTokens(run);
  if (Number.isFinite(autoCompactTokens)) {
    return `Live context exceeded ${autoCompactTokens.toLocaleString()} tokens — compacting conversation…`;
  }
  return 'Live context overflowed — compacting conversation…';
}

function nowIso() {
  return new Date().toISOString();
}

function isRecordedProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

export function clipFailurePreview(text, maxChars = 280) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

export async function collectRunOutputPreview(runId, maxLines = 3) {
  const records = await readRunSpoolRecords(runId);
  if (!Array.isArray(records) || records.length === 0) return '';

  const lines = [];
  for (const record of records) {
    if (!record || !['stdout', 'stderr', 'error'].includes(record.stream)) continue;
    const line = clipFailurePreview(await materializeRunSpoolLine(runId, record));
    if (!line) continue;
    lines.push(line);
  }

  return lines.slice(-maxLines).join(' | ');
}

export async function deriveStructuredRuntimeFailureReason(runId, previewText = '') {
  const preview = clipFailurePreview(previewText) || await collectRunOutputPreview(runId);
  if (!preview) {
    const manifest = await getRunManifest(runId);
    const folderState = inspectSessionFolder(manifest?.folder || '', {
      allowPersistentFallback: false,
    });
    if (!folderState.available) {
      return buildSessionFolderUnavailableMessage(manifest?.folder || '');
    }
    return 'Provider exited before runtime handshake';
  }
  if (preview && /(请登录|登录超时|auth|authentication|sso|sign in|login)/i.test(preview)) {
    return `Provider requires interactive login before MelodySync can use it: ${preview}`;
  }
  if (preview && /Detached runner disappeared before writing a result/i.test(preview)) {
    return `Provider terminated before persisting result: ${preview}`;
  }
  if (preview && /connection (closed|reset|terminated|was forcibly closed)|socket hang up|EPIPE|ECONNRESET/i.test(preview)) {
    return `Provider transport disrupted before result completion: ${preview}`;
  }
  if (preview && /api_retry/i.test(preview)) {
    return `Provider is retrying API calls without returning assistant output: ${preview}`;
  }
  if (preview) {
    return `Provider exited without emitting structured events: ${preview}`;
  }
  return 'Provider exited before runtime handshake';
}

export function deriveRunStateFromResult(run, result) {
  if (!result || typeof result !== 'object') return null;
  if (result.cancelled === true) {
    return 'cancelled';
  }
  if ((result.exitCode ?? 1) === 0 && !result.error) {
    return 'completed';
  }
  if (run?.cancelRequested === true && (((result.exitCode ?? 1) !== 0) || result.signal)) {
    return 'cancelled';
  }
  return 'failed';
}

export function deriveRunFailureReasonFromResult(run, result) {
  if (!result || typeof result !== 'object') {
    return run?.failureReason || null;
  }
  if (typeof result.error === 'string' && result.error.trim()) {
    return result.error.trim();
  }
  if (typeof run?.failureReason === 'string' && run.failureReason.trim()) {
    return run.failureReason.trim();
  }
  if (result.cancelled === true) {
    return null;
  }
  if (typeof result.signal === 'string' && result.signal) {
    return `Process exited via signal ${result.signal}`;
  }
  if (Number.isInteger(result.exitCode)) {
    return `Process exited with code ${result.exitCode}`;
  }
  return run?.failureReason || null;
}

export async function synthesizeDetachedRunTermination(runId, run) {
  const hasRecordedProcess = Number.isInteger(run?.runnerProcessId) || Number.isInteger(run?.toolProcessId);
  if (!hasRecordedProcess || isTerminalRunState(run?.state)) {
    return null;
  }
  const runnerAlive = isRecordedProcessAlive(run?.runnerProcessId);
  const toolAlive = isRecordedProcessAlive(run?.toolProcessId);
  if (runnerAlive || toolAlive) {
    return null;
  }

  const completedAt = nowIso();
  const cancelled = run?.cancelRequested === true;
  const runOutputPreview = await collectRunOutputPreview(runId);
  const error = cancelled
    ? null
    : await deriveStructuredRuntimeFailureReason(runId, runOutputPreview);
  const result = {
    completedAt,
    exitCode: 1,
    signal: null,
    cancelled,
    ...(error ? { error } : {}),
  };

  await writeRunResult(runId, result);
  return await updateRun(runId, (current) => ({
    ...current,
    state: cancelled ? 'cancelled' : 'failed',
    completedAt,
    result,
    failureReason: error,
  })) || run;
}
