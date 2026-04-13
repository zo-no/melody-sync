import { getHistorySnapshot, loadHistory } from '../../../history.mjs';
import { getRun, getRunManifest, isTerminalRunState } from '../../../run/store.mjs';
import { buildSessionActivity, resolveSessionRunActivity } from '../../../session/activity.mjs';
import { loadSessionsMeta, findSessionMeta } from '../../../session/meta-store.mjs';
import {
  getSessionTaskListOrigin,
  getSessionTaskListVisibility,
  shouldExposeSession,
  shouldIncludeSessionInPrimaryTaskList,
} from '../../../session/visibility.mjs';
import {
  normalizeAppId,
  resolveSessionSourceId,
  resolveSessionSourceName,
} from '../../../session-source/meta-fields.mjs';
import { stripEventAttachmentSavedPaths } from '../../../attachment-utils.mjs';
import {
  buildLongTermSessionProjection,
  createLongTermProjectionContext,
} from '../../../session/long-term-projection.mjs';

export function createSessionQueryHelpers({
  getLiveSession,
  getFollowUpQueue,
  getFollowUpQueueCount,
  serializeQueuedFollowUp,
  normalizeSourceContext,
  stabilizeSessionTaskCard,
  syncDetachedRun,
  collectNormalizedRunEvents,
  dropActiveRunGeneratedHistoryEvents,
  withSyntheticSeqs,
  organizerInternalOperation,
} = {}) {
  async function buildSessionTimelineEvents(sessionId, options = {}) {
    const includeBodies = options.includeBodies !== false;
    const history = await loadHistory(sessionId, { includeBodies });
    const sessionMeta = options.sessionMeta || await findSessionMeta(sessionId);
    const activeRunId = typeof sessionMeta?.activeRunId === 'string' ? sessionMeta.activeRunId.trim() : '';
    if (!activeRunId) {
      return history;
    }

    const run = await getRun(activeRunId);
    if (!run || run.finalizedAt) {
      return history;
    }

    const manifest = await getRunManifest(activeRunId);
    if (!manifest) {
      return history;
    }
    if (manifest.internalOperation === organizerInternalOperation) {
      return history;
    }

    const projected = await collectNormalizedRunEvents(run, manifest);
    if (projected.normalizedEvents.length === 0) {
      return dropActiveRunGeneratedHistoryEvents(history, activeRunId);
    }

    const committedLatestSeq = history.reduce(
      (maxSeq, event) => (Number.isInteger(event?.seq) && event.seq > maxSeq ? event.seq : maxSeq),
      0,
    );

    return [
      ...dropActiveRunGeneratedHistoryEvents(history, activeRunId),
      ...withSyntheticSeqs(projected.normalizedEvents, committedLatestSeq),
    ];
  }

  function getSessionSortTime(meta) {
    const stamp = meta?.updatedAt || meta?.created || '';
    const time = new Date(stamp).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function getSessionPinSortRank(meta) {
    return meta?.pinned === true ? 1 : 0;
  }

  function applyLongTermProjection(session, sessionsOrContext = []) {
    if (!session || typeof session !== 'object') return session;
    const longTerm = buildLongTermSessionProjection(session, sessionsOrContext);
    if (!longTerm) return session;
    return {
      ...session,
      sessionState: {
        ...(session?.sessionState && typeof session.sessionState === 'object' ? session.sessionState : {}),
        longTerm,
      },
    };
  }

  async function enrichSessionMeta(meta, _options = {}) {
    const live = typeof getLiveSession === 'function' ? getLiveSession(meta?.id) : null;
    const snapshot = await getHistorySnapshot(meta.id);
    const queuedCount = getFollowUpQueueCount(meta);
    const runActivity = await resolveSessionRunActivity(meta);
    const taskCard = stabilizeSessionTaskCard(meta, meta.taskCard, {
      managedBindingKeys: meta?.taskCardManagedBindings,
    });
    const {
      followUpQueue,
      recentFollowUpRequestIds,
      activeRunId,
      activeRun,
      sourceId: _rawSourceId,
      sourceName: _rawSourceName,
      taskCard: _rawTaskCard,
      taskCardManagedBindings: _taskCardManagedBindings,
      ...rest
    } = meta;
    const sourceId = resolveSessionSourceId(meta);
    return {
      ...rest,
      ...(taskCard ? { taskCard } : {}),
      taskListOrigin: getSessionTaskListOrigin(meta),
      taskListVisibility: getSessionTaskListVisibility(meta),
      sourceId,
      sourceName: resolveSessionSourceName(meta, sourceId),
      latestSeq: snapshot.latestSeq,
      lastEventAt: snapshot.lastEventAt,
      messageCount: snapshot.messageCount,
      activeMessageCount: snapshot.activeMessageCount,
      contextMode: snapshot.contextMode,
      activeFromSeq: snapshot.activeFromSeq,
      compactedThroughSeq: snapshot.compactedThroughSeq,
      contextTokenEstimate: snapshot.contextTokenEstimate,
      activity: buildSessionActivity(meta, live, {
        runState: runActivity.state,
        run: runActivity.run,
        queuedCount,
      }),
    };
  }

  async function enrichSessionMetaForClient(meta, options = {}) {
    if (!meta) return null;
    const session = await enrichSessionMeta(meta, options);
    if (options.includeQueuedMessages) {
      session.queuedMessages = getFollowUpQueue(meta).map(serializeQueuedFollowUp);
    }
    return session;
  }

  async function flushDetachedRunIfNeeded(sessionId, runId) {
    if (!sessionId || !runId) return null;
    const run = await getRun(runId);
    if (!run) return null;
    if (!run.finalizedAt || !isTerminalRunState(run.state)) {
      return await syncDetachedRun(sessionId, runId) || await getRun(runId);
    }
    return run;
  }

  async function reconcileLinkedCompactionSession(meta) {
    const compactionSessionId = typeof meta?.compactionSessionId === 'string'
      ? meta.compactionSessionId.trim()
      : '';
    if (!compactionSessionId) return false;
    const compactionMeta = await findSessionMeta(compactionSessionId);
    if (!compactionMeta?.activeRunId) return false;
    await syncDetachedRun(compactionMeta.id, compactionMeta.activeRunId);
    return true;
  }

  async function reconcileSessionMeta(meta) {
    let changed = false;
    if (meta?.activeRunId) {
      await syncDetachedRun(meta.id, meta.activeRunId);
      changed = true;
    }
    if (await reconcileLinkedCompactionSession(meta)) {
      changed = true;
    }
    return changed ? (await findSessionMeta(meta.id) || meta) : meta;
  }

  async function reconcileSessionsMetaList(list) {
    let changed = false;
    for (const meta of list) {
      if (meta?.activeRunId) {
        await syncDetachedRun(meta.id, meta.activeRunId);
        changed = true;
      }
      if (await reconcileLinkedCompactionSession(meta)) {
        changed = true;
      }
    }
    return changed ? loadSessionsMeta() : list;
  }

  async function listSessions({
    includeArchived = true,
    sourceId = '',
    includeQueuedMessages = false,
    taskListVisibility = 'all',
  } = {}) {
    const metas = await reconcileSessionsMetaList(await loadSessionsMeta());
    const normalizedSourceId = normalizeAppId(sourceId);
    const filtered = metas
      .filter((meta) => shouldExposeSession(meta))
      .filter((meta) => (
        taskListVisibility === 'primary'
          ? shouldIncludeSessionInPrimaryTaskList(meta)
          : true
      ))
      .filter((meta) => {
        if (includeArchived) return true;
        if (meta.archived) return false;
        // Persistent sessions (skills, recurring tasks) are always active regardless of workflowState
        const persistentKind = String(meta?.persistent?.kind || '').trim().toLowerCase();
        if (persistentKind === 'skill' || persistentKind === 'recurring_task' || persistentKind === 'scheduled_task' || persistentKind === 'waiting_task') return true;
        const wf = String(meta?.workflowState || '').trim().toLowerCase();
        return wf !== 'done' && wf !== 'complete' && wf !== 'completed';
      })
      .filter((meta) => !normalizedSourceId || resolveSessionSourceId(meta) === normalizedSourceId)
      .sort((a, b) => (
        getSessionPinSortRank(b) - getSessionPinSortRank(a)
        || getSessionSortTime(b) - getSessionSortTime(a)
      ));
    const enriched = await Promise.all(filtered.map((meta) => enrichSessionMetaForClient(meta, {
      includeQueuedMessages,
    })));
    const projectionContext = createLongTermProjectionContext(
      metas.filter((meta) => shouldExposeSession(meta)),
    );
    return enriched.map((session) => applyLongTermProjection(session, projectionContext));
  }

  async function getSession(id, options = {}) {
    const metas = await loadSessionsMeta();
    const meta = metas.find((entry) => entry.id === id) || await findSessionMeta(id);
    if (!meta) return null;
    const session = await enrichSessionMetaForClient(await reconcileSessionMeta(meta), options);
    const projectionContext = createLongTermProjectionContext(
      metas.filter((entry) => shouldExposeSession(entry)),
    );
    return applyLongTermProjection(session, projectionContext);
  }

  async function getSessionEventsAfter(sessionId, afterSeq = 0, options = {}) {
    const events = await buildSessionTimelineEvents(sessionId, {
      includeBodies: options?.includeBodies !== false,
    });
    const filtered = (Array.isArray(events) ? events : []).filter((event) => Number.isInteger(event?.seq) && event.seq > afterSeq);
    if (options?.includeAttachmentPaths === true) return filtered;
    return filtered.map((event) => stripEventAttachmentSavedPaths(event));
  }

  async function getSessionTimelineEvents(sessionId, options = {}) {
    return buildSessionTimelineEvents(sessionId, options);
  }

  async function getSessionSourceContext(sessionId, options = {}) {
    const session = await getSession(sessionId);
    if (!session) return null;
    const requestedRequestId = typeof options.requestId === 'string' ? options.requestId.trim() : '';
    const events = await loadHistory(sessionId, { includeBodies: false });
    let matchedRequestId = requestedRequestId;
    let messageContext = null;

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'message' || event.role !== 'user') continue;
      if (requestedRequestId && (event.requestId || '') !== requestedRequestId) continue;
      const candidate = normalizeSourceContext(event.sourceContext);
      if (!candidate) continue;
      messageContext = candidate;
      matchedRequestId = event.requestId || matchedRequestId;
      break;
    }

    return {
      session: normalizeSourceContext(session.sourceContext),
      message: messageContext,
      requestId: matchedRequestId,
    };
  }

  async function getHistory(sessionId) {
    await reconcileSessionMeta(await findSessionMeta(sessionId));
    return loadHistory(sessionId);
  }

  return {
    buildSessionTimelineEvents,
    enrichSessionMeta,
    enrichSessionMetaForClient,
    flushDetachedRunIfNeeded,
    reconcileSessionMeta,
    reconcileSessionsMetaList,
    listSessions,
    getSession,
    getSessionEventsAfter,
    getSessionTimelineEvents,
    getSessionSourceContext,
    getHistory,
  };
}
