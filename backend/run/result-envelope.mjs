import { normalizeAgentResultEnvelope } from '../session-runtime/agent-result-envelope.mjs';

function normalizeText(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';
}

function extractLatestAssistantMessage(normalizedEvents = []) {
  const events = Array.isArray(normalizedEvents) ? normalizedEvents : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'message' && event.role === 'assistant') {
      return normalizeText(event.content);
    }
  }
  return '';
}

function buildStatePatchFromTaskCard(taskCard = null) {
  if (!taskCard || typeof taskCard !== 'object') return {};
  const needsFromUser = Array.isArray(taskCard.needsFromUser)
    ? taskCard.needsFromUser.some((entry) => normalizeText(entry))
    : Boolean(normalizeText(taskCard.needsFromUser));
  return {
    goal: normalizeText(taskCard.goal),
    checkpoint: normalizeText(taskCard.checkpoint || taskCard.summary),
    needsUser: needsFromUser,
    lineRole: normalizeText(taskCard.lineRole) || 'main',
    branchFrom: normalizeText(taskCard.branchFrom),
  };
}

export function buildNormalizedRunResultEnvelope({
  result = null,
  normalizedEvents = [],
  parseTaskCardFromAssistantContent = () => null,
} = {}) {
  const assistantMessage = normalizeText(
    result?.assistantMessage
    || result?.message
    || result?.reply
    || extractLatestAssistantMessage(normalizedEvents)
  );
  const latestTaskCard = assistantMessage
    ? parseTaskCardFromAssistantContent(assistantMessage)
    : null;
  return normalizeAgentResultEnvelope({
    ...(result && typeof result === 'object' ? result : {}),
    assistantMessage,
    statePatch: result?.statePatch || buildStatePatchFromTaskCard(latestTaskCard),
  });
}

export function runResultEnvelopeHasMeaningfulContent(envelope = null) {
  if (!envelope || typeof envelope !== 'object') return false;
  const statePatch = envelope.statePatch || {};
  return Boolean(
    envelope.assistantMessage
    || statePatch.goal
    || statePatch.checkpoint
    || statePatch.needsUser
    || statePatch.lineRole === 'branch'
    || statePatch.branchFrom
    || (Array.isArray(envelope.actionRequests) && envelope.actionRequests.length > 0)
    || (Array.isArray(envelope.memoryCandidates) && envelope.memoryCandidates.length > 0)
    || (Array.isArray(envelope.trace) && envelope.trace.length > 0)
  );
}

export function mergeRunResultWithEnvelope(result = null, envelope = null) {
  const merged = {
    ...(result && typeof result === 'object' ? result : {}),
  };
  if (!envelope || typeof envelope !== 'object') return merged;
  if (envelope.assistantMessage) merged.assistantMessage = envelope.assistantMessage;
  if (runResultEnvelopeHasMeaningfulContent({ statePatch: envelope.statePatch })) {
    merged.statePatch = envelope.statePatch;
  }
  if (Array.isArray(envelope.actionRequests) && envelope.actionRequests.length > 0) {
    merged.actionRequests = envelope.actionRequests;
  }
  if (Array.isArray(envelope.memoryCandidates) && envelope.memoryCandidates.length > 0) {
    merged.memoryCandidates = envelope.memoryCandidates;
  }
  if (Array.isArray(envelope.trace) && envelope.trace.length > 0) {
    merged.trace = envelope.trace;
  }
  return merged;
}
