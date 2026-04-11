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

function normalizeLongTermBucket(value) {
  const normalized = normalizeNullableText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['long_term', 'long_term_iteration', '长期任务', '长期迭代'].includes(normalized)) return 'long_term';
  if (['short_term', 'short_term_iteration', '短期任务', '短期迭代'].includes(normalized)) return 'short_term';
  if (['waiting', 'waiting_user', 'waiting_for', '等待任务', '等待'].includes(normalized)) return 'waiting';
  if (['inbox', 'collect', 'collection', 'capture', '收集箱'].includes(normalized)) return 'inbox';
  return '';
}

function inferLongTermBucketFromSession(session = null) {
  const explicitBucket = normalizeLongTermBucket(session?.taskPoolMembership?.longTerm?.bucket || '');
  if (explicitBucket) return explicitBucket;
  const persistentKind = normalizeNullableText(session?.persistent?.kind).toLowerCase().replace(/[\s-]+/g, '_');
  if (persistentKind === 'recurring_task') return 'long_term';
  if (persistentKind === 'scheduled_task') return 'short_term';
  if (persistentKind === 'waiting_task') return 'waiting';
  const workflowState = normalizeNullableText(session?.workflowState).toLowerCase().replace(/[\s-]+/g, '_');
  if (workflowState === 'waiting_user') return 'waiting';
  return 'inbox';
}

function getLongTermBucketOrder(session = null) {
  switch (inferLongTermBucketFromSession(session)) {
    case 'long_term':
      return 0;
    case 'short_term':
      return 1;
    case 'waiting':
      return 2;
    case 'inbox':
      return 3;
    default:
      return 4;
  }
}

function sortBranchEntriesStable(items) {
  return [...items].sort((left, right) => {
    const leftBucketOrder = getLongTermBucketOrder(left?.session);
    const rightBucketOrder = getLongTermBucketOrder(right?.session);
    if (leftBucketOrder !== rightBucketOrder) return leftBucketOrder - rightBucketOrder;
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

  // Build a map of long-term project memberships:
  // projectSessionId → Set of member session IDs
  const longTermProjectMembers = new Map();
  for (const session of allSessions) {
    const membership = session?.taskPoolMembership?.longTerm;
    if (!membership?.projectSessionId) continue;
    const projectId = normalizeNullableText(membership.projectSessionId);
    const role = normalizeNullableText(membership.role).toLowerCase();
    if (!projectId || role === 'project') continue;
    if (!longTermProjectMembers.has(projectId)) {
      longTermProjectMembers.set(projectId, new Set());
    }
    longTermProjectMembers.get(projectId).add(session.id);
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

    // Long-term project membership: treat project root as parent
    const ltMembership = session?.taskPoolMembership?.longTerm;
    const ltProjectId = ltMembership?.projectSessionId
      ? normalizeNullableText(ltMembership.projectSessionId)
      : '';
    const ltRole = ltMembership?.role ? normalizeNullableText(ltMembership.role).toLowerCase() : '';
    const ltProjectRoot = ltProjectId && ltRole !== 'project' && sessionMap.has(ltProjectId)
      ? sessionMap.get(ltProjectId)
      : null;

    const goalParent = !explicitParent && lineRole === 'branch'
      ? mainSessionsByGoal.get(getSessionClusterGoal(session, context).toLowerCase()) || null
      : null;

    // Priority: explicit parent > long-term project root > goal-matched parent
    const parent = explicitParent || ltProjectRoot || goalParent;
    if (parent?.id && (lineRole === 'branch' || ltProjectRoot)) {
      if (!branchChildren.has(parent.id)) branchChildren.set(parent.id, []);
      // Avoid duplicates
      const existing = branchChildren.get(parent.id);
      if (!existing.some((e) => e.session.id === session.id)) {
        existing.push({ session, context });
      }
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
