import { enqueueHostCompletionSpeech } from '../completion-speech-queue.mjs';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { VOICE_LOGS_DIR } from '../../lib/config.mjs';

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
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?；;：:]+$/g, '')
    .trim();
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = normalizeSpeechClause(value);
    if (text) return text;
  }
  return '';
}

function pickActionHint(session = {}) {
  const taskCard = session?.taskCard || {};
  const needsFromUser = Array.isArray(taskCard?.needsFromUser) ? taskCard.needsFromUser : [];
  const nextSteps = Array.isArray(taskCard?.nextSteps) ? taskCard.nextSteps : [];
  return firstNonEmptyText(
    needsFromUser[0],
    nextSteps[0],
    taskCard.checkpoint,
  );
}

function buildSessionCompletionSpeech(session = {}) {
  const name = firstNonEmptyText(session?.name);
  const actionHint = pickActionHint(session);
  if (name) return `${name}，需要你处理。`;
  if (actionHint) return '需要你处理。';
  return '需要你处理。';
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

export async function hostCompletionVoiceHook(
  {
    sessionId,
    session,
    run,
    completionNoticeKey,
  },
  options = {},
) {
  const {
    enqueueHostCompletionSpeechImpl = enqueueHostCompletionSpeech,
    logError = console.error,
  } = options;
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
