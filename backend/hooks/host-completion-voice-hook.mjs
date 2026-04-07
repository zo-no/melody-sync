import { enqueueHostCompletionSpeech } from '../completion-speech-queue.mjs';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HOST_COMPLETION_HOOK_LOG = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.melodysync',
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

export async function hostCompletionVoiceHook(
  { sessionId, session },
  options = {},
) {
  const {
    enqueueHostCompletionSpeechImpl = enqueueHostCompletionSpeech,
    logError = console.error,
  } = options;
  await appendHostCompletionHookLog(`[invoke] sessionId="${sessionId}" speech="${buildSessionCompletionSpeech(session)}"`);
  await enqueueHostCompletionSpeechImpl({
    speechText: buildSessionCompletionSpeech(session),
  }).catch((error) => {
    void appendHostCompletionHookLog(`[error] sessionId="${sessionId}" message="${error?.message || error}"`);
    logError(`[session-hooks] host-completion-voice ${sessionId}: ${error?.message || error}`);
  });
}
