import {
  appendEvent,
  appendEvents,
  clearContextHead,
  clearForkContext,
  getContextHead,
  getHistorySnapshot,
  loadHistory,
  setContextHead,
  setForkContext,
} from '../../history.mjs';
import { messageEvent } from '../../normalizer.mjs';
import { clipCompactionSection } from '../../session-runtime/session-compaction.mjs';
import { buildTemporarySessionName } from '../../session/naming.mjs';
import { getOrPrepareForkContext } from './fork-context-service.mjs';

export function buildForkSessionName(session) {
  const sourceName = typeof session?.name === 'string' ? session.name.trim() : '';
  return `fork - ${sourceName || 'session'}`;
}

export function buildDelegatedSessionName(session, task) {
  const taskLabel = buildTemporarySessionName(task, 48);
  if (taskLabel) {
    return `delegate - ${taskLabel}`;
  }
  const sourceName = typeof session?.name === 'string' ? session.name.trim() : '';
  return `delegate - ${sourceName || 'session'}`;
}

function buildSessionNavigationHref(sessionId) {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalized) return '/?tab=sessions';
  return `/?session=${encodeURIComponent(normalized)}&tab=sessions`;
}

export function buildDelegationNoticeMessage(task, childSession) {
  const normalizedTask = clipCompactionSection(task, 240)
    .replace(/\s+/g, ' ')
    .trim();
  const childName = typeof childSession?.name === 'string'
    ? childSession.name.trim()
    : 'new session';
  const childId = typeof childSession?.id === 'string' ? childSession.id.trim() : '';
  const link = childId ? `[${childName}](${buildSessionNavigationHref(childId)})` : childName;
  return [
    'Spawned a parallel session for this work.',
    '',
    normalizedTask ? `- Task: ${normalizedTask}` : '',
    `- Session: ${link}`,
    '',
    'This new session is independent and can continue on its own.',
  ].filter(Boolean).join('\n');
}

export function sanitizeForkedEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const next = JSON.parse(JSON.stringify(event));
  delete next.seq;
  delete next.runId;
  delete next.requestId;
  delete next.bodyRef;
  delete next.bodyField;
  delete next.bodyAvailable;
  delete next.bodyLoaded;
  delete next.bodyBytes;
  delete next.bodyPersistence;
  delete next.bodyTruncated;
  delete next.bodyPreview;
  return next;
}

export function buildDelegationHandoff({
  source,
  task,
}) {
  const normalizedTask = clipCompactionSection(task, 4000);
  const sourceId = typeof source?.id === 'string' ? source.id.trim() : '';
  const lines = [normalizedTask || '(no delegated task provided)'];
  if (sourceId) {
    lines.push('', `Parent session id: ${sourceId}`);
  }
  return lines.join('\n');
}

export function createSessionBranchingService({
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  createInternalRequestId,
  createSession,
  getSession,
  internalSessionRoleAgentDelegate,
  isSessionRunning,
  nowIso,
  submitHttpMessage,
}) {
  async function forkSession(sessionId) {
    const source = await getSession(sessionId);
    if (!source) return null;
    if (isSessionRunning(source)) return null;

    const [history, contextHead, snapshot] = await Promise.all([
      loadHistory(sessionId, { includeBodies: true }),
      getContextHead(sessionId),
      getHistorySnapshot(sessionId),
    ]);
    const forkContext = await getOrPrepareForkContext(sessionId, snapshot, contextHead);

    const child = await createSession(source.folder, source.tool, buildForkSessionName(source), {
      group: source.group || '',
      description: source.description || '',
      sourceId: source.sourceId || '',
      sourceName: source.sourceName || '',
      systemPrompt: source.systemPrompt || '',
      activeAgreements: source.activeAgreements || [],
      userId: source.userId || '',
      userName: source.userName || '',
      forkedFromSessionId: source.id,
      forkedFromSeq: source.latestSeq || 0,
      rootSessionId: source.rootSessionId || source.id,
      forkedAt: nowIso(),
      taskListOrigin: 'user',
      taskListVisibility: 'secondary',
    });
    if (!child) return null;

    const copiedEvents = history
      .map((event) => sanitizeForkedEvent(event))
      .filter(Boolean);
    if (copiedEvents.length > 0) {
      await appendEvents(child.id, copiedEvents);
    }

    if (contextHead) {
      const copiedContextHead = Number.isInteger(contextHead?.handoffSeq) && contextHead.handoffSeq > 0
        ? { ...contextHead, summary: '' }
        : contextHead;
      await setContextHead(child.id, {
        ...copiedContextHead,
        updatedAt: copiedContextHead.updatedAt || nowIso(),
      });
    } else {
      await clearContextHead(child.id);
    }

    if (forkContext) {
      await setForkContext(child.id, {
        ...forkContext,
        updatedAt: nowIso(),
      });
    } else {
      await clearForkContext(child.id);
    }

    broadcastSessionsInvalidation();
    return getSession(child.id);
  }

  async function delegateSession(sessionId, payload = {}) {
    const source = await getSession(sessionId);
    if (!source) return null;

    const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
    if (!task) {
      throw new Error('task is required');
    }

    const requestedName = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const requestedTool = typeof payload?.tool === 'string' ? payload.tool.trim() : '';
    const runInternally = payload?.internal === true;
    const nextTool = requestedTool || source.tool;
    const inheritRuntimePreferences = !requestedTool || requestedTool === source.tool;

    const child = await createSession(source.folder, nextTool, requestedName || buildDelegatedSessionName(source, task), {
      sourceId: source.sourceId || '',
      sourceName: source.sourceName || '',
      systemPrompt: source.systemPrompt || '',
      activeAgreements: source.activeAgreements || [],
      model: inheritRuntimePreferences ? source.model || '' : '',
      effort: inheritRuntimePreferences ? source.effort || '' : '',
      thinking: inheritRuntimePreferences && source.thinking === true,
      userId: source.userId || '',
      userName: source.userName || '',
      sourceContext: {
        kind: 'delegate_session',
        parentSessionId: source.id,
      },
      taskListOrigin: runInternally ? 'system' : 'assistant',
      taskListVisibility: runInternally ? 'hidden' : 'secondary',
      ...(runInternally ? { internalRole: internalSessionRoleAgentDelegate } : {}),
    });
    if (!child) return null;

    const handoffText = buildDelegationHandoff({
      source,
      task,
    });
    const outcome = await submitHttpMessage(child.id, handoffText, [], {
      requestId: createInternalRequestId('delegate'),
      tool: requestedTool || undefined,
      model: inheritRuntimePreferences ? source.model || undefined : undefined,
      effort: inheritRuntimePreferences ? source.effort || undefined : undefined,
      thinking: inheritRuntimePreferences && source.thinking === true,
    });

    if (!runInternally) {
      await appendEvent(source.id, messageEvent('assistant', buildDelegationNoticeMessage(task, child), undefined, {
        messageKind: 'session_delegate_notice',
      }));
      broadcastSessionInvalidation(source.id);
    }

    return {
      session: outcome.session || await getSession(child.id) || child,
      run: outcome.run || null,
    };
  }

  return {
    delegateSession,
    forkSession,
  };
}
