import { buildSessionContinuationContextFromBody } from '../session/continuation.mjs';

export function buildPreparedContinuationContext(
  prepared,
  previousTool,
  effectiveTool,
  sessionState = null,
  options = {},
) {
  if (!prepared) return '';

  const summary = typeof prepared.summary === 'string' ? prepared.summary.trim() : '';
  const continuationBody = typeof prepared.continuationBody === 'string'
    ? prepared.continuationBody.trim()
    : '';
  const includeSessionState = options?.includeSessionState !== false;
  const continuation = continuationBody
    ? buildSessionContinuationContextFromBody(continuationBody, {
        fromTool: previousTool,
        toTool: effectiveTool,
        sessionState: includeSessionState ? sessionState : null,
      })
    : '';

  if (!summary) {
    return continuation;
  }

  if (continuation) {
    return continuation;
  }

  return `[Conversation summary]\n\n${summary}`;
}

export function isPreparedForkContextCurrent(prepared, snapshot, contextHead) {
  if (!prepared) return false;

  const summary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const handoffSeq = Number.isInteger(contextHead?.handoffSeq) ? contextHead.handoffSeq : 0;
  const expectedMode = (summary || handoffSeq > 0) ? 'summary' : 'history';
  const expectedSummary = '';

  return (prepared.mode || 'history') === expectedMode
    && (prepared.summary || '') === expectedSummary
    && (prepared.activeFromSeq || 0) === activeFromSeq
    && (prepared.handoffSeq || 0) === handoffSeq
    && (prepared.preparedThroughSeq || 0) === (snapshot?.latestSeq || 0);
}
