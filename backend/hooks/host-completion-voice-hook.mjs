import { enqueueHostCompletionSpeech } from '../completion-speech-queue.mjs';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { VOICE_LOGS_DIR } from '../../lib/config.mjs';
import { formatSessionOrdinalSpeechLabel } from '../session/naming.mjs';

const HOST_COMPLETION_HOOK_LOG = join(
  VOICE_LOGS_DIR,
  'host-completion-hook.log',
);
async function appendHostCompletionHookLog(message) {
  try {
    await mkdir(dirname(HOST_COMPLETION_HOOK_LOG), { recursive: true });
    await appendFile(HOST_COMPLETION_HOOK_LOG, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function normalizeSpeechClause(value) {
  return String(value || '')
    .replace(/^[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?；;：:]+$/g, '')
    .trim();
}

function normalizeSpeechCompareText(value) {
  return normalizeSpeechClause(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, '');
}

function speechTextsEquivalent(left, right) {
  const leftText = normalizeSpeechCompareText(left);
  const rightText = normalizeSpeechCompareText(right);
  if (!leftText || !rightText) return false;
  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText);
}

function clipSpeechClause(value, maxChars = 32) {
  const text = normalizeSpeechClause(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  const slice = text.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf('，'),
    slice.lastIndexOf('、'),
    slice.lastIndexOf(','),
  );
  if (boundary >= Math.floor(maxChars / 2)) {
    return slice.slice(0, boundary).trim();
  }
  return slice.trim();
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = normalizeSpeechClause(value);
    if (text) return text;
  }
  return '';
}

function firstListText(value, maxChars = 32) {
  const items = Array.isArray(value) ? value : [];
  for (const item of items) {
    const text = clipSpeechClause(item, maxChars);
    if (text) return text;
  }
  return '';
}

function pickActionHint(session = {}) {
  const taskCard = session?.taskCard || {};
  return firstNonEmptyText(
    firstListText(taskCard?.needsFromUser, 28),
    firstListText(taskCard?.nextSteps, 28),
  );
}

function pickStatusHint(session = {}) {
  const taskCard = session?.taskCard || {};
  return firstNonEmptyText(
    clipSpeechClause(taskCard?.checkpoint, 28),
    firstListText(taskCard?.knownConclusions, 28),
  );
}

function buildSessionCompletionSpeech(session = {}) {
  const taskCard = session?.taskCard || {};
  const taskLabel = firstNonEmptyText(
    formatSessionOrdinalSpeechLabel(session?.ordinal),
    clipSpeechClause(taskCard?.mainGoal, 18),
    clipSpeechClause(taskCard?.goal, 18),
    clipSpeechClause(session?.name, 18),
    clipSpeechClause(taskCard?.summary, 18),
  );
  const summaryHint = clipSpeechClause(taskCard?.summary, 18);
  const actionHint = pickActionHint(session);
  const statusHint = pickStatusHint(session);

  if (actionHint) {
    if (taskLabel && !speechTextsEquivalent(taskLabel, actionHint)) {
      if (speechTextsEquivalent(actionHint, firstListText(taskCard?.nextSteps, 28))) {
        return `${taskLabel}，下一步，${actionHint}。`;
      }
      return `${taskLabel}，${actionHint}。`;
    }
    if (speechTextsEquivalent(actionHint, firstListText(taskCard?.nextSteps, 28))) {
      return `下一步，${actionHint}。`;
    }
    return `${actionHint}。`;
  }

  if (statusHint) {
    if (taskLabel && !speechTextsEquivalent(taskLabel, statusHint)) {
      return `${taskLabel}，${statusHint}。`;
    }
    return `${statusHint}。`;
  }

  if (summaryHint && taskLabel && !speechTextsEquivalent(taskLabel, summaryHint)) {
    return `${taskLabel}，${summaryHint}。`;
  }
  if (taskLabel) return `${taskLabel}，你可以看一下。`;
  return '有新进展，你可以看一下。';
}

function normalizeCompletionNoticeKey(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : '';
}

function buildSpeechHash(value) {
  const text = String(value || '').trim();
  if (!text) return 'default';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function buildCompletionNoticeKey({
  sessionId = '',
  runId = '',
  speechText = '',
  completionNoticeKey = '',
}) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedRunId = String(runId || '').trim();
  const normalizedBaseKey = normalizeCompletionNoticeKey(completionNoticeKey);
  const speechHash = buildSpeechHash(speechText);

  if (normalizedBaseKey) {
    return normalizedBaseKey;
  }
  if (normalizedSessionId && normalizedRunId) {
    return `completion:session:${normalizedSessionId}:run:${normalizedRunId}:speech:${speechHash}`;
  }
  if (normalizedSessionId) {
    return `completion:session:${normalizedSessionId}:speech:${speechHash}`;
  }
  return `completion:session:unknown:speech:${speechHash}`;
}

function normalizeInternalRole(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldSuppressCompletionVoice({ session, manifest, userInitiated } = {}) {
  if (userInitiated === true) return true;
  if (normalizeInternalRole(session?.internalRole)) return true;
  return typeof manifest?.internalOperation === 'string' && manifest.internalOperation.trim();
}

export async function hostCompletionVoiceHook(
  {
    sessionId,
    session,
    run,
    manifest,
    completionNoticeKey,
    userInitiated,
  },
  options = {},
) {
  const {
    enqueueHostCompletionSpeechImpl = enqueueHostCompletionSpeech,
    logError = console.error,
  } = options;
  if (shouldSuppressCompletionVoice({ session, manifest, userInitiated })) {
    const effectiveRunId = run?.id || session?.activeRunId || '';
    await appendHostCompletionHookLog(`[skip] sessionId="${sessionId}" runId="${effectiveRunId}" internalRole="${normalizeInternalRole(session?.internalRole)}" internalOperation="${String(manifest?.internalOperation || '').trim()}" name="${String(session?.name || '').trim()}"`);
    return;
  }
  const speechText = buildSessionCompletionSpeech(session);
  const effectiveRunId = run?.id || session?.activeRunId || '';
  const resolvedCompletionNoticeKey = buildCompletionNoticeKey({
    sessionId,
    runId: effectiveRunId,
    speechText,
    completionNoticeKey,
  });
  await appendHostCompletionHookLog(`[invoke] sessionId="${sessionId}" runId="${effectiveRunId}" key="${resolvedCompletionNoticeKey}" speech="${speechText}"`);
  await enqueueHostCompletionSpeechImpl({
    speechText,
    completionNoticeKey: resolvedCompletionNoticeKey,
    runId: effectiveRunId,
  }).catch((error) => {
    void appendHostCompletionHookLog(`[error] sessionId="${sessionId}" message="${error?.message || error}"`);
    logError(`[session-hooks] host-completion-voice ${sessionId}: ${error?.message || error}`);
  });
}
