import {
  clearForkContext,
  getForkContext,
  loadHistory,
  setForkContext,
} from '../../history.mjs';
import { messageEvent } from '../../normalizer.mjs';
import { prepareSessionContinuationBody } from '../../session/continuation.mjs';
import { buildFallbackCompactionHandoff } from '../../session-runtime/session-compaction.mjs';
import { isPreparedForkContextCurrent } from '../../session-runtime/session-fork-context.mjs';

function nowIso() {
  return new Date().toISOString();
}

export async function prepareForkContextSnapshot(sessionId, snapshot, contextHead) {
  const summary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const handoffSeq = Number.isInteger(contextHead?.handoffSeq) ? contextHead.handoffSeq : 0;
  const preparedThroughSeq = snapshot?.latestSeq || 0;
  const hasCarryForwardContext = Boolean(summary) || handoffSeq > 0;

  if (hasCarryForwardContext) {
    const [recentEvents, handoffHistory] = await Promise.all([
      preparedThroughSeq > activeFromSeq
        ? loadHistory(sessionId, {
            fromSeq: Math.max(1, activeFromSeq + 1),
            includeBodies: true,
          })
        : [],
      handoffSeq > 0
        ? loadHistory(sessionId, {
            fromSeq: handoffSeq,
            includeBodies: true,
          })
        : [],
    ]);
    const handoffEvent = handoffSeq > 0
      ? handoffHistory.find((event) => (event?.seq || 0) === handoffSeq && event?.type === 'message')
      : null;
    const fallbackHandoffEvent = !handoffEvent && summary
      ? messageEvent('assistant', buildFallbackCompactionHandoff(summary, ''), undefined, {
          source: 'context_compaction_handoff',
          synthetic: true,
        })
      : null;
    const continuationEvents = handoffEvent
      ? [handoffEvent, ...recentEvents]
      : (fallbackHandoffEvent ? [fallbackHandoffEvent, ...recentEvents] : recentEvents);
    const continuationBody = prepareSessionContinuationBody(continuationEvents);
    return {
      mode: 'summary',
      summary: '',
      continuationBody,
      activeFromSeq,
      handoffSeq,
      includesCompactionHandoff: Boolean(handoffEvent || fallbackHandoffEvent),
      preparedThroughSeq,
      contextUpdatedAt: contextHead?.updatedAt || null,
      updatedAt: nowIso(),
      source: contextHead?.source || 'context_head',
    };
  }

  if (preparedThroughSeq <= 0) {
    return null;
  }

  const priorHistory = await loadHistory(sessionId, { includeBodies: true });
  const continuationBody = prepareSessionContinuationBody(priorHistory);
  if (!continuationBody) {
    return null;
  }

  return {
    mode: 'history',
    summary: '',
    continuationBody,
    activeFromSeq: 0,
    handoffSeq: 0,
    includesCompactionHandoff: false,
    preparedThroughSeq,
    contextUpdatedAt: null,
    updatedAt: nowIso(),
    source: 'history',
  };
}

export async function getOrPrepareForkContext(sessionId, snapshot, contextHead) {
  const prepared = await getForkContext(sessionId);
  if (isPreparedForkContextCurrent(prepared, snapshot, contextHead)) {
    return prepared;
  }

  const next = await prepareForkContextSnapshot(sessionId, snapshot, contextHead);
  if (next) {
    await setForkContext(sessionId, next);
    return next;
  }

  await clearForkContext(sessionId);
  return null;
}
