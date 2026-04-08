import { listWorkbenchSessions } from './session-ports.mjs';
import { createSessionListItem } from '../session/api-shapes.mjs';
import { loadWorkbenchState } from './state-store.mjs';
import {
  normalizeBranchContextStatus,
  normalizeNullableText,
  sortByCreatedAsc,
  sortByUpdatedDesc,
} from './shared.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';

function getStableBranchEntryTimestamp(entry) {
  return Date.parse(
    entry?.context?.createdAt
    || entry?.session?.createdAt
    || entry?.session?.created
    || entry?.context?.updatedAt
    || entry?.session?.updatedAt
    || entry?.session?.lastEventAt
    || ''
  ) || 0;
}

function sortBranchEntriesStable(items) {
  return [...items].sort((left, right) => {
    const leftTime = getStableBranchEntryTimestamp(left);
    const rightTime = getStableBranchEntryTimestamp(right);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.session?.id || '').localeCompare(String(right?.session?.id || ''));
  });
}

export function getLatestSessionContext(state, sessionId) {
  const normalized = normalizeNullableText(sessionId);
  if (!normalized) return null;
  return sortByUpdatedDesc((state.branchContexts || []).filter((entry) => (
    normalizeNullableText(entry.sessionId) === normalized
  )))[0] || null;
}

export function getLatestBranchContextEntry(state, sessionId) {
  return getLatestSessionContext(state, sessionId);
}

function getSessionClusterGoal(session, context = null) {
  const state = resolveSessionStateFromSession(session, context);
  return normalizeNullableText(
    state.mainGoal
    || state.goal
    || session?.name
  );
}

function getRecordedParentSessionId(session, context = null) {
  return normalizeNullableText(
    context?.parentSessionId
    || session?.sourceContext?.parentSessionId,
  );
}

function getSessionClusterLineRole(session, context = null) {
  return resolveSessionStateFromSession(session, context).lineRole;
}

export function buildTaskClusters(state, sessions = []) {
  const allSessions = (Array.isArray(sessions) ? sessions : []).filter((session) => session?.id);
  const sessionMap = new Map(allSessions.map((session) => [session.id, session]));
  const visibleRootSessions = allSessions.filter((session) => !session?.archived);
  const mainSessionsByGoal = new Map();

  for (const session of visibleRootSessions) {
    const context = getLatestSessionContext(state, session.id);
    const lineRole = getSessionClusterLineRole(session, context);
    if (lineRole !== 'main') continue;
    const goalKey = getSessionClusterGoal(session, context).toLowerCase();
    if (goalKey && !mainSessionsByGoal.has(goalKey)) {
      mainSessionsByGoal.set(goalKey, session);
    }
  }

  const branchChildren = new Map();
  const roots = [];
  for (const session of allSessions) {
    const context = getLatestSessionContext(state, session.id);
    const lineRole = getSessionClusterLineRole(session, context);
    const explicitParentId = normalizeNullableText(context?.parentSessionId || session?.sourceContext?.parentSessionId);
    const explicitParent = explicitParentId && sessionMap.has(explicitParentId)
      ? sessionMap.get(explicitParentId)
      : null;
    const goalParent = !explicitParent && lineRole === 'branch'
      ? mainSessionsByGoal.get(getSessionClusterGoal(session, context).toLowerCase()) || null
      : null;
    const parent = explicitParent || goalParent;
    if (lineRole === 'branch' && parent?.id) {
      if (!branchChildren.has(parent.id)) branchChildren.set(parent.id, []);
      branchChildren.get(parent.id).push({ session, context });
      continue;
    }
    if (!session?.archived) {
      roots.push(session);
    }
  }

  function collectBranchEntries(parentSessionId, depth = 1, visited = new Set()) {
    const directChildren = sortBranchEntriesStable((branchChildren.get(parentSessionId) || []).map((entry) => ({
      id: entry.session.id,
      updatedAt: entry.context?.updatedAt || entry.session.updatedAt || entry.session.lastEventAt || entry.session.created || '',
      status: normalizeBranchContextStatus(entry.context?.status),
      session: entry.session,
      context: entry.context,
      depth,
      parentSessionId,
    })));
    const results = [];
    for (const entry of directChildren) {
      if (!entry?.session?.id || visited.has(entry.session.id)) continue;
      visited.add(entry.session.id);
      results.push(entry);
      results.push(...collectBranchEntries(entry.session.id, depth + 1, visited));
    }
    return results;
  }

  return roots.map((root) => {
    const branchEntries = collectBranchEntries(root.id);
    const activeBranch = sortByUpdatedDesc(branchEntries).find((entry) => entry.status === 'active') || null;
    const recentBranchEntries = sortByUpdatedDesc(branchEntries).slice(0, 3);
    return {
      id: `cluster:${root.id}`,
      mainSessionId: root.id,
      mainSession: createSessionListItem(root),
      mainGoal: getSessionClusterGoal(root, getLatestSessionContext(state, root.id)),
      currentBranchSessionId: activeBranch?.session?.id || '',
      branchCount: branchEntries.length,
      branchSessionIds: branchEntries.map((entry) => entry.session.id),
      recentBranchSessionIds: recentBranchEntries.map((entry) => entry.session.id),
      branchSessions: branchEntries.map((entry) => ({
        ...createSessionListItem(entry.session),
        _branchDepth: entry.depth,
        _branchParentSessionId: entry.parentSessionId,
        _branchStatus: entry.status,
      })),
    };
  });
}

export function buildWorkbenchSnapshot(state, sessions = []) {
  return {
    captureItems: sortByUpdatedDesc(state.captureItems || []),
    projects: sortByUpdatedDesc(state.projects || []),
    nodes: sortByCreatedAsc(state.nodes || []),
    branchContexts: sortByUpdatedDesc(state.branchContexts || []),
    taskMapPlans: sortByUpdatedDesc(state.taskMapPlans || []),
    taskClusters: buildTaskClusters(state, sessions),
    skills: sortByUpdatedDesc(state.skills || []),
    summaries: sortByUpdatedDesc(state.summaries || []),
  };
}

export async function getWorkbenchSnapshot() {
  const state = await loadWorkbenchState();
  const sessions = await listWorkbenchSessions({ includeArchived: true });
  return buildWorkbenchSnapshot(state, sessions);
}

export async function getWorkbenchTrackerSnapshot(sessionId) {
  const normalizedSessionId = normalizeNullableText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }
  const state = await loadWorkbenchState();
  const sessions = await listWorkbenchSessions({ includeArchived: true });
  const taskClusters = buildTaskClusters(state, sessions);
  const cluster = taskClusters.find((entry) => (
    entry?.mainSessionId === normalizedSessionId
    || entry?.currentBranchSessionId === normalizedSessionId
    || (Array.isArray(entry?.branchSessionIds) && entry.branchSessionIds.includes(normalizedSessionId))
  )) || null;
  const relevantSessionIds = new Set([normalizedSessionId]);
  if (cluster?.mainSessionId) relevantSessionIds.add(cluster.mainSessionId);
  for (const branchSessionId of Array.isArray(cluster?.branchSessionIds) ? cluster.branchSessionIds : []) {
    if (normalizeNullableText(branchSessionId)) relevantSessionIds.add(normalizeNullableText(branchSessionId));
  }
  return {
    branchContexts: sortByUpdatedDesc((state.branchContexts || []).filter((entry) => (
      relevantSessionIds.has(normalizeNullableText(entry?.sessionId))
    ))),
    taskMapPlans: sortByUpdatedDesc((state.taskMapPlans || []).filter((plan) => {
      if (relevantSessionIds.has(normalizeNullableText(plan?.rootSessionId))) return true;
      if (normalizeNullableText(plan?.activeNodeId) && relevantSessionIds.has(normalizeNullableText(plan.activeNodeId.replace(/^session:/, '')))) {
        return true;
      }
      return (Array.isArray(plan?.nodes) ? plan.nodes : []).some((node) => (
        relevantSessionIds.has(normalizeNullableText(node?.sessionId))
        || relevantSessionIds.has(normalizeNullableText(node?.sourceSessionId))
      ));
    })),
    taskClusters: cluster ? [cluster] : [],
  };
}
