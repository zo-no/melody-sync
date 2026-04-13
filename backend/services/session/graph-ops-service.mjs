import { isLongTermProjectSession as isTaskPoolLongTermProjectSession } from '../../session/task-pool-membership.mjs';

function normalizeAssistantGraphLookupKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getAssistantGraphSessionTitleCandidates(session) {
  const candidates = [
    session?.name,
    session?.taskCard?.goal,
    session?.taskCard?.mainGoal,
    session?.sessionState?.goal,
    session?.sessionState?.mainGoal,
  ];
  const titles = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeAssistantGraphLookupKey(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    titles.push(normalized);
  }
  return titles;
}

function getAssistantGraphSessionDisplayTitle(session) {
  return String(
    session?.name
    || session?.taskCard?.goal
    || session?.taskCard?.mainGoal
    || session?.sessionState?.goal
    || session?.sessionState?.mainGoal
    || session?.id
    || '当前任务',
  ).trim();
}

function resolveAssistantGraphSessionRef(ref, {
  currentSessionId = '',
  rootSessionId = '',
  sessions = [],
} = {}) {
  const currentId = String(currentSessionId || '').trim();
  const rootId = String(rootSessionId || '').trim();
  const sessionId = String(
    ref && typeof ref === 'object' && !Array.isArray(ref)
      ? (ref.sessionId || ref.id || '')
      : '',
  ).trim();
  const rawRef = String(
    typeof ref === 'string'
      ? ref
      : (ref && typeof ref === 'object' && !Array.isArray(ref)
        ? (ref.ref || ref.title || ref.name || ref.goal || sessionId || '')
        : ''),
  ).trim();
  const lookupKey = normalizeAssistantGraphLookupKey(rawRef || sessionId);
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const activeSessions = allSessions.filter((session) => {
    if (session?.archived === true) return false;
    const wf = String(session?.workflowState || '').trim().toLowerCase();
    return wf !== 'done' && wf !== 'complete' && wf !== 'completed';
  });
  const searchPools = [activeSessions, allSessions];

  for (const pool of searchPools) {
    if (sessionId) {
      const bySessionId = pool.find((session) => String(session?.id || '').trim() === sessionId);
      if (bySessionId) return bySessionId;
    }
    if (rawRef) {
      const byLiteralId = pool.find((session) => String(session?.id || '').trim() === rawRef);
      if (byLiteralId) return byLiteralId;
    }
  }

  if (!lookupKey) return null;
  if (['current', 'self', 'this', '当前', '当前任务', '本任务'].includes(lookupKey)) {
    return allSessions.find((session) => String(session?.id || '').trim() === currentId) || null;
  }
  if (['main', 'root', '主线', '主任务', '根任务'].includes(lookupKey)) {
    return allSessions.find((session) => String(session?.id || '').trim() === rootId)
      || allSessions.find((session) => String(session?.rootSessionId || '').trim() === rootId && String(session?.id || '').trim() === rootId)
      || null;
  }

  for (const pool of searchPools) {
    const exactMatches = pool.filter((session) => getAssistantGraphSessionTitleCandidates(session).includes(lookupKey));
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return null;
  }

  for (const pool of searchPools) {
    const partialMatches = pool.filter((session) => (
      getAssistantGraphSessionTitleCandidates(session).some((candidate) => candidate.includes(lookupKey) || lookupKey.includes(candidate))
    ));
    if (partialMatches.length === 1) return partialMatches[0];
    if (partialMatches.length > 1) return null;
  }

  return null;
}

function isLongTermProjectRootSession(session) {
  if (!session || session.archived === true) return false;
  const wf = String(session?.workflowState || '').trim().toLowerCase();
  if (wf === 'done' || wf === 'complete' || wf === 'completed') return false;
  const sessionId = String(session.id || '').trim();
  const rootSessionId = String(session.rootSessionId || sessionId).trim();
  const parentSessionId = String(session?.sourceContext?.parentSessionId || '').trim();
  return Boolean(sessionId)
    && !parentSessionId
    && sessionId === rootSessionId
    && isTaskPoolLongTermProjectSession(session);
}

function resolveAssistantGraphExpandTitle(operation = {}) {
  return String(
    operation?.title
    || operation?.goal
    || operation?.branchTitle
    || operation?.target?.title
    || operation?.target?.ref
    || operation?.target?.goal
    || operation?.target?.name
    || '',
  ).trim();
}

function resolveAssistantGraphExpandCheckpoint(operation = {}, branchTitle = '') {
  return String(
    operation?.checkpoint
    || operation?.checkpointSummary
    || operation?.resumeHint
    || branchTitle
    || '',
  ).trim();
}

export function createSessionGraphOpsService({
  appendEvent,
  createBranchFromSession: createBranchFromSessionOverride,
  getSession,
  listSessions,
  setSessionArchived,
  updateSessionWorkflowState,
  statusEvent,
}) {
  async function applySessionGraphOps(sessionId, graphOps = null, options = {}) {
    const normalizedSessionId = String(sessionId || '').trim();
    const operations = Array.isArray(graphOps?.operations) ? graphOps.operations : [];
    const requireCurrentAsSource = options?.requireCurrentAsSource === true;
    const requireLongTermRootTarget = options?.requireLongTermRootTarget === true;
    const onlyWhenSourceStandaloneRoot = options?.onlyWhenSourceStandaloneRoot === true;
    if (!normalizedSessionId || operations.length === 0) {
      return {
        historyChanged: false,
        sessionChanged: false,
        appliedCount: 0,
      };
    }

    const branchLifecycleModule = await import('../../workbench/branch-lifecycle.mjs');
    const reparentSession = branchLifecycleModule?.reparentSession;
    const createBranchFromSession = typeof createBranchFromSessionOverride === 'function'
      ? createBranchFromSessionOverride
      : branchLifecycleModule?.createBranchFromSession;
    let rootSessionId = '';
    let rootScopedSessions = [];
    let allSessions = [];

    const refreshScopedSessions = async () => {
      const currentSession = await getSession(normalizedSessionId);
      allSessions = await listSessions({ includeArchived: true });
      if (!currentSession) {
        rootSessionId = normalizedSessionId;
        rootScopedSessions = [];
        return;
      }
      rootSessionId = String(currentSession.rootSessionId || currentSession.id || normalizedSessionId).trim();
      rootScopedSessions = allSessions.filter((session) => {
        const candidateId = String(session?.id || '').trim();
        const candidateRootId = String(session?.rootSessionId || candidateId).trim();
        return candidateRootId === rootSessionId || candidateId === rootSessionId;
      });
    };

    await refreshScopedSessions();

    let historyChanged = false;
    let sessionChanged = false;
    let appliedCount = 0;

    for (const operation of operations) {
      const sourceSession = resolveAssistantGraphSessionRef(operation?.source, {
        currentSessionId: normalizedSessionId,
        rootSessionId,
        sessions: rootScopedSessions,
      });
      if (!sourceSession) {
        console.warn(`[assistant-graph-ops] source session not found in root ${rootSessionId || '(unknown)'}`);
        continue;
      }
      if (requireCurrentAsSource && String(sourceSession.id || '').trim() !== normalizedSessionId) {
        continue;
      }

      const currentParentSessionId = String(sourceSession?.sourceContext?.parentSessionId || '').trim();

      if (operation?.type === 'expand') {
        const branchTitle = resolveAssistantGraphExpandTitle(operation);
        if (!branchTitle || typeof createBranchFromSession !== 'function') {
          continue;
        }
        await createBranchFromSession(sourceSession.id, {
          goal: branchTitle,
          branchReason: operation.reason || `AI整理任务图：从「${getAssistantGraphSessionDisplayTitle(sourceSession)}」继续展开`,
          checkpointSummary: resolveAssistantGraphExpandCheckpoint(operation, branchTitle),
        });
        historyChanged = true;
        sessionChanged = true;
        appliedCount += 1;
        await refreshScopedSessions();
        continue;
      }

      if (operation?.type === 'attach') {
        const targetSession = resolveAssistantGraphSessionRef(operation?.target, {
          currentSessionId: normalizedSessionId,
          rootSessionId,
          sessions: allSessions,
        });
        if (!targetSession || String(targetSession.id || '').trim() === String(sourceSession.id || '').trim()) {
          console.warn('[assistant-graph-ops] attach target missing or self-referential');
          continue;
        }
        if (onlyWhenSourceStandaloneRoot && currentParentSessionId) {
          continue;
        }
        if (requireLongTermRootTarget && !isLongTermProjectRootSession(targetSession)) {
          continue;
        }
        if (String(targetSession.id || '').trim() === currentParentSessionId) {
          continue;
        }
        await reparentSession(sourceSession.id, {
          targetSessionId: targetSession.id,
          branchReason: operation.reason || `AI整理任务图：挂到「${getAssistantGraphSessionDisplayTitle(targetSession)}」下`,
        });
        historyChanged = true;
        sessionChanged = true;
        appliedCount += 1;
        await refreshScopedSessions();
        continue;
      }

      if (operation?.type === 'promote_main') {
        if (!currentParentSessionId) {
          continue;
        }
        await reparentSession(sourceSession.id, {
          targetSessionId: '',
          branchReason: operation.reason || 'AI整理任务图：移为主线',
        });
        historyChanged = true;
        sessionChanged = true;
        appliedCount += 1;
        await refreshScopedSessions();
        continue;
      }

      if (operation?.type === 'archive') {
        if (String(sourceSession.id || '').trim() === normalizedSessionId) {
          console.warn('[assistant-graph-ops] refusing to archive the current session during its own finalization');
          continue;
        }
        const sourceWf = String(sourceSession?.workflowState || '').trim().toLowerCase();
        if (sourceSession.archived === true || sourceWf === 'done' || sourceWf === 'complete' || sourceWf === 'completed') {
          continue;
        }
        const targetSession = operation?.target
          ? resolveAssistantGraphSessionRef(operation.target, {
            currentSessionId: normalizedSessionId,
            rootSessionId,
            sessions: rootScopedSessions,
          })
          : null;
        const archiveLabel = targetSession
          ? `已完成重复任务：并入「${getAssistantGraphSessionDisplayTitle(targetSession)}」`
          : (operation.reason ? `已完成任务：${operation.reason}` : '已完成重复任务');
        await appendEvent(sourceSession.id, statusEvent(archiveLabel, {
          statusKind: 'assistant_graph_archived',
        }));
        await updateSessionWorkflowState(sourceSession.id, 'done');
        historyChanged = true;
        sessionChanged = true;
        appliedCount += 1;
        await refreshScopedSessions();
      }
    }

    return {
      historyChanged,
      sessionChanged,
      appliedCount,
    };
  }

  return {
    applySessionGraphOps,
  };
}
