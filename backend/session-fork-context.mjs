import { buildSessionContinuationContextFromBody } from './session-continuation.mjs';

export function buildPreparedContinuationContext(prepared, previousTool, effectiveTool, sessionState = null) {
  if (!prepared) return '';

  const summary = typeof prepared.summary === 'string' ? prepared.summary.trim() : '';
  const includesCompactionHandoff = prepared?.includesCompactionHandoff === true;
  const continuationBody = typeof prepared.continuationBody === 'string'
    ? prepared.continuationBody.trim()
    : '';
  const continuation = continuationBody
    ? buildSessionContinuationContextFromBody(continuationBody, {
        fromTool: previousTool,
        toTool: effectiveTool,
        sessionState,
      })
    : '';

  if (!summary) {
    return continuation;
  }

  if (continuation) {
    if (includesCompactionHandoff) {
      return continuation;
    }
    const summaryLabel = sessionState
      ? '[Earlier compressed summary]'
      : '[Conversation summary]';
    return `${continuation}\n\n---\n\n${summaryLabel}\n\n${summary}`;
  }

  return `[Conversation summary]\n\n${summary}`;
}

export function isPreparedForkContextCurrent(prepared, snapshot, contextHead) {
  if (!prepared) return false;

  const summary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const handoffSeq = Number.isInteger(contextHead?.handoffSeq) ? contextHead.handoffSeq : 0;
  const expectedMode = (summary || handoffSeq > 0) ? 'summary' : 'history';
  const expectedSummary = handoffSeq > 0 ? '' : summary;

  return (prepared.mode || 'history') === expectedMode
    && (prepared.summary || '') === expectedSummary
    && (prepared.activeFromSeq || 0) === activeFromSeq
    && (prepared.handoffSeq || 0) === handoffSeq
    && (prepared.preparedThroughSeq || 0) === (snapshot?.latestSeq || 0);
}
