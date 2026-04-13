import { getWorkbenchTrackerSnapshot } from './continuity-store.mjs';
import {
  appendGraphEdge,
  appendGraphNode,
  buildQuestGraphSnapshot,
  buildQuestNodeCounts,
  createQuestGraphCollections,
} from './graph-model.mjs';
import { mergeNodeInstances } from './node-instance.mjs';
import { normalizeTaskMapPlan } from './task-map-plans.mjs';
import { trimText } from './shared.mjs';
import { resolveTaskMapPlanSessionScope } from './task-map-plan-service.mjs';

function normalizeText(value) {
  return trimText(value).replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeWorkflowState(value) {
  const normalized = normalizeKey(value);
  if (!normalized) return '';
  if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'done';
  if (['parked', 'paused', 'pause', 'backlog', 'todo'].includes(normalized)) return 'parked';
  if (['waiting', 'waiting_user', 'waiting_for_user', 'waiting_on_user', 'needs_user', 'needs_input'].includes(normalized)) {
    return 'waiting_user';
  }
  return '';
}

function resolveBranchLikeStatus(...values) {
  let sawActive = false;
  let sawParked = false;
  let sawResolved = false;
  let sawMerged = false;

  for (const value of values) {
    const normalized = normalizeKey(value);
    if (!normalized) continue;
    if (normalized === 'merged') {
      sawMerged = true;
      continue;
    }
    if (['resolved', 'done', 'closed', 'complete', 'completed', 'finished'].includes(normalized)) {
      sawResolved = true;
      continue;
    }
    if (['parked', 'paused', 'pause', 'backlog', 'todo'].includes(normalized)) {
      sawParked = true;
      continue;
    }
    if (['active', 'running', 'current', 'main', 'waiting', 'waiting_user'].includes(normalized)) {
      sawActive = true;
    }
  }

  if (sawMerged) return 'merged';
  if (sawResolved) return 'resolved';
  if (sawParked) return 'parked';
  if (sawActive) return 'active';
  return 'active';
}

function clipText(value, max = 96) {
  const text = normalizeText(value);
  if (!text) return '';
  if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function slugify(value) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled';
}

function getTaskCard(session = null) {
  return session?.taskCard && typeof session.taskCard === 'object'
    ? session.taskCard
    : null;
}

function getTaskCardList(taskCard = null, key = '') {
  return Array.isArray(taskCard?.[key])
    ? taskCard[key].filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
}

function getLineRole(session = null) {
  return trimText(session?._branchParentSessionId || session?.sourceContext?.parentSessionId)
    ? 'branch'
    : 'main';
}

function getBranchStatus(session = null, branchContext = null) {
  return resolveBranchLikeStatus(
    session?._branchStatus,
    session?.branchStatus,
    session?.taskCard?.branchStatus,
    branchContext?.status,
    normalizeWorkflowState(session?.workflowState || ''),
  );
}

function getRootNodeStatus(session = null, { isCurrent = false } = {}) {
  const workflowState = normalizeWorkflowState(session?.workflowState || '');
  if (workflowState === 'done') return 'done';
  if (workflowState === 'parked') return 'parked';
  return isCurrent ? 'current' : 'main';
}

function getSessionCreatedTimestamp(session = null) {
  const stamp = Date.parse(session?.createdAt || session?.created || session?.updatedAt || session?.lastEventAt || '');
  return Number.isFinite(stamp) ? stamp : 0;
}

function sortChildSessions(childSessions = [], orderMap = new Map()) {
  return [...childSessions].sort((left, right) => {
    const leftOrder = orderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftCreated = getSessionCreatedTimestamp(left);
    const rightCreated = getSessionCreatedTimestamp(right);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function getBranchCurrentLineageSessionIds(cluster = null, currentBranchSessionId = '') {
  const branchById = new Map(
    (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
      .filter((entry) => entry?.id)
      .map((entry) => [entry.id, entry]),
  );
  const rootSessionId = trimText(cluster?.mainSessionId);
  const lineageIds = new Set();
  let cursor = currentBranchSessionId ? (branchById.get(currentBranchSessionId) || null) : null;
  while (cursor?.id && !lineageIds.has(cursor.id)) {
    lineageIds.add(cursor.id);
    const parentId = trimText(cursor?._branchParentSessionId);
    if (!parentId || parentId === rootSessionId) break;
    cursor = branchById.get(parentId) || null;
  }
  return lineageIds;
}

function toConciseGoal(value, max = 56) {
  const compact = normalizeText(value);
  if (!compact) return '';
  const firstSegment = compact
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return clipText(firstSegment || compact, max);
}

function getSessionTitle(session = null) {
  const name = trimText(session?.name);
  const goal = trimText(session?.taskCard?.goal);
  const mainGoal = trimText(session?.taskCard?.mainGoal);
  const isBranch = getLineRole(session) === 'branch';
  return toConciseGoal(
    isBranch
      ? (goal || name || mainGoal || '当前任务')
      : (name || mainGoal || goal || '当前任务'),
    64,
  );
}

function getBranchTitle(session = null) {
  const raw = getSessionTitle(session);
  return raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, '').trim() || raw;
}

function getNodeSummary(session = null) {
  const taskCard = getTaskCard(session);
  const checkpoint = trimText(taskCard?.checkpoint);
  const summary = trimText(taskCard?.summary);
  return clipText(checkpoint || summary || '', 88);
}

function getCandidateKeysForSession(session = null) {
  return new Set([
    normalizeKey(getSessionTitle(session)),
    normalizeKey(getBranchTitle(session)),
    normalizeKey(session?.taskCard?.goal || ''),
    normalizeKey(session?.taskCard?.summary || ''),
    normalizeKey(session?.taskCard?.checkpoint || ''),
  ].filter(Boolean));
}

function buildRootOnlyCluster(rootSession = null) {
  if (!rootSession?.id) return null;
  return {
    id: `cluster:${rootSession.id}`,
    mainSessionId: rootSession.id,
    mainSession: rootSession,
    mainGoal: trimText(
      rootSession?.taskCard?.mainGoal
      || rootSession?.taskCard?.goal
      || rootSession?.name
      || '当前任务',
    ),
    currentBranchSessionId: '',
    branchCount: 0,
    branchSessionIds: [],
    recentBranchSessionIds: [],
    branchSessions: [],
  };
}

function buildBranchContextBySessionId(branchContexts = []) {
  const map = new Map();
  for (const entry of Array.isArray(branchContexts) ? branchContexts : []) {
    const sessionId = trimText(entry?.sessionId);
    if (!sessionId || map.has(sessionId)) continue;
    map.set(sessionId, entry);
  }
  return map;
}

function buildQuestFromGraphData({
  questId = '',
  rootSessionId = '',
  title = '',
  summary = '',
  activeNodeId = '',
  nodes = [],
  edges = [],
} = {}) {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId || !Array.isArray(nodes) || nodes.length === 0) return null;
  const collections = createQuestGraphCollections({
    questId: trimText(questId) || `quest:${normalizedRootSessionId}`,
  });
  for (const node of Array.isArray(nodes) ? nodes : []) {
    appendGraphNode(collections, node);
  }
  for (const edge of Array.isArray(edges) ? edges : []) {
    appendGraphEdge(collections, edge);
  }
  const nodeById = collections.nodeById;
  for (const node of collections.nodes) {
    node.isCurrent = false;
    node.isCurrentPath = false;
  }
  const rootNode = nodeById.get(`session:${normalizedRootSessionId}`)
    || collections.nodes.find((node) => !trimText(node?.parentNodeId))
    || collections.nodes.find((node) => node.kind === 'main')
    || null;
  if (!rootNode) return null;

  function assignDepth(nodeId, depth, visited = new Set()) {
    const node = nodeById.get(nodeId);
    if (!node || visited.has(nodeId)) return;
    visited.add(nodeId);
    node.depth = depth;
    for (const childId of Array.isArray(node.childNodeIds) ? node.childNodeIds : []) {
      assignDepth(childId, depth + 1, visited);
    }
  }

  assignDepth(rootNode.id, 0, new Set());

  const resolvedActiveNodeId = trimText(activeNodeId) && nodeById.has(trimText(activeNodeId))
    ? trimText(activeNodeId)
    : rootNode.id;
  const currentPathNodeIds = [];
  let cursor = nodeById.get(resolvedActiveNodeId) || null;
  while (cursor?.id) {
    if (cursor.id === rootNode.id) {
      if (cursor.id === resolvedActiveNodeId) {
        cursor.isCurrentPath = true;
        currentPathNodeIds.unshift(cursor.id);
      }
      break;
    }
    cursor.isCurrentPath = true;
    currentPathNodeIds.unshift(cursor.id);
    const parentId = trimText(cursor.parentNodeId);
    cursor = parentId ? (nodeById.get(parentId) || null) : null;
  }

  const activeNode = nodeById.get(resolvedActiveNodeId) || rootNode;
  activeNode.isCurrent = true;

  return buildQuestGraphSnapshot({
    collections,
    questId: trimText(questId) || `quest:${normalizedRootSessionId}`,
    rootSessionId: normalizedRootSessionId,
    title: trimText(title) || trimText(rootNode.title) || '当前任务',
    summary: trimText(summary) || trimText(rootNode.summary),
    currentNodeId: activeNode.id,
    currentNodeTitle: trimText(activeNode.title) || trimText(rootNode.title) || '当前任务',
    currentPathNodeIds,
  });
}

function questToGraphData(quest = {}) {
  return {
    questId: quest.id,
    rootSessionId: quest.rootSessionId,
    title: quest.title,
    summary: quest.summary,
    activeNodeId: quest.currentNodeId,
    nodes: (Array.isArray(quest.nodes) ? quest.nodes : []).map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      summary: node.summary,
      sessionId: node.sessionId,
      sourceSessionId: node.sourceSessionId,
      parentNodeId: node.parentNodeId,
      status: node.status,
      lineRole: node.lineRole,
      capabilities: Array.isArray(node.capabilities) ? [...node.capabilities] : [],
      surfaceBindings: Array.isArray(node.surfaceBindings) ? [...node.surfaceBindings] : [],
      taskCardBindings: Array.isArray(node.taskCardBindings) ? [...node.taskCardBindings] : [],
      view: node.view ? JSON.parse(JSON.stringify(node.view)) : null,
      origin: node.origin ? JSON.parse(JSON.stringify(node.origin)) : null,
      actionPayload: (() => {
        if (!node?.actionPayload || typeof node.actionPayload !== 'object' || Array.isArray(node.actionPayload)) {
          return null;
        }
        const payload = {};
        for (const [key, value] of Object.entries(node.actionPayload)) {
          payload[key] = value;
        }
        return Object.keys(payload).length > 0 ? payload : null;
      })(),
    })),
    edges: (Array.isArray(quest.edges) ? quest.edges : []).map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
    })),
  };
}

function buildPlanNodeOrigin(plan = {}) {
  return {
    type: 'plan',
    planId: trimText(plan?.id),
    sourceId: trimText(plan?.source?.hookId || plan?.source?.type || plan?.id),
    sourceLabel: trimText(plan?.source?.event || plan?.summary || plan?.title),
    hookId: trimText(plan?.source?.hookId),
  };
}

function mergePlanIntoQuest(existingQuest = null, plan = null) {
  if (!existingQuest || !plan) return existingQuest;
  const base = questToGraphData(existingQuest);
  const nodeIds = new Set(base.nodes.map((node) => node.id));
  const nodeIndexById = new Map(base.nodes.map((node, index) => [node.id, index]));
  const edgeIds = new Set(base.edges.map((edge) => trimText(edge.id) || `edge:${edge.fromNodeId}:${edge.toNodeId}`));

  for (const node of Array.isArray(plan.nodes) ? plan.nodes : []) {
    if (nodeIds.has(node.id)) {
      const index = nodeIndexById.get(node.id);
      if (Number.isInteger(index) && index >= 0) {
        base.nodes[index] = mergeNodeInstances(base.nodes[index], {
          ...node,
          origin: buildPlanNodeOrigin(plan),
        }, {
          origin: buildPlanNodeOrigin(plan),
        });
      }
      continue;
    }
    nodeIds.add(node.id);
    nodeIndexById.set(node.id, base.nodes.length);
    base.nodes.push(mergeNodeInstances({}, {
      ...node,
      origin: buildPlanNodeOrigin(plan),
    }, {
      origin: buildPlanNodeOrigin(plan),
    }));
  }

  for (const edge of Array.isArray(plan.edges) ? plan.edges : []) {
    const edgeId = trimText(edge.id) || `edge:${edge.fromNodeId}:${edge.toNodeId}`;
    if (edgeIds.has(edgeId)) continue;
    edgeIds.add(edgeId);
    base.edges.push(edge);
  }

  return buildQuestFromGraphData({
    ...base,
    title: trimText(plan.title) || base.title,
    summary: trimText(plan.summary) || base.summary,
    activeNodeId: trimText(plan.activeNodeId) || base.activeNodeId,
  });
}

function normalizeRelevantTaskMapPlans(taskMapPlans = [], rootSessionId = '') {
  const normalizedRootSessionId = trimText(rootSessionId);
  const results = [];
  const seenPlanIds = new Set();
  for (const plan of Array.isArray(taskMapPlans) ? taskMapPlans : []) {
    const normalizedPlan = normalizeTaskMapPlan(plan);
    if (!normalizedPlan || trimText(normalizedPlan.rootSessionId) !== normalizedRootSessionId) continue;
    if (seenPlanIds.has(normalizedPlan.id)) continue;
    seenPlanIds.add(normalizedPlan.id);
    results.push(normalizedPlan);
  }
  return results;
}

function applyTaskMapPlansToQuestGraph({ quest = null, taskMapPlans = [] } = {}) {
  let nextQuest = quest;
  for (const plan of normalizeRelevantTaskMapPlans(taskMapPlans, quest?.rootSessionId)) {
    nextQuest = plan.mode === 'augment-default' && nextQuest
      ? mergePlanIntoQuest(nextQuest, plan)
      : buildQuestFromGraphData({
        questId: plan.questId,
        rootSessionId: plan.rootSessionId,
        title: plan.title,
        summary: plan.summary,
        activeNodeId: plan.activeNodeId,
        nodes: (Array.isArray(plan.nodes) ? plan.nodes : []).map((node) => mergeNodeInstances({}, {
          ...node,
          origin: buildPlanNodeOrigin(plan),
        }, {
          origin: buildPlanNodeOrigin(plan),
        })),
        edges: plan.edges,
      });
  }
  return nextQuest;
}

function buildDefaultQuestGraph({
  rootSession = null,
  cluster = null,
  trackerSnapshot = null,
  currentSessionId = '',
} = {}) {
  if (!rootSession?.id) return null;
  const rootNodeId = `session:${rootSession.id}`;
  const questId = `quest:${rootSession.id}`;
  const branchSessions = Array.isArray(cluster?.branchSessions)
    ? cluster.branchSessions.filter((entry) => {
        if (!entry?.id || entry?.archived === true) return false;
        const wf = String(entry?.workflowState || '').trim().toLowerCase();
        return wf !== 'done' && wf !== 'complete' && wf !== 'completed';
      })
    : [];
  const branchSessionIds = new Set(branchSessions.map((entry) => trimText(entry.id)).filter(Boolean));
  const preferredSessionIds = [trimText(currentSessionId)].filter(Boolean);
  const resolvedActiveSessionId = preferredSessionIds.find((sessionId) => (
    sessionId === rootSession.id || branchSessionIds.has(sessionId)
  )) || trimText(cluster?.currentBranchSessionId) || rootSession.id;
  const resolvedCurrentBranchSessionId = resolvedActiveSessionId === rootSession.id
    ? ''
    : resolvedActiveSessionId;
  const activeNodeId = resolvedActiveSessionId === rootSession.id
    ? rootNodeId
    : `session:${resolvedActiveSessionId}`;
  const currentLineageIds = getBranchCurrentLineageSessionIds(cluster, resolvedCurrentBranchSessionId);
  const branchOrderMap = new Map(branchSessions.map((entry, index) => [entry.id, index]));
  const childrenByParent = new Map();
  for (const branchSession of branchSessions) {
    const parentSessionId = trimText(branchSession?._branchParentSessionId) || rootSession.id;
    if (!childrenByParent.has(parentSessionId)) {
      childrenByParent.set(parentSessionId, []);
    }
    childrenByParent.get(parentSessionId).push(branchSession);
  }
  for (const [parentId, childSessions] of childrenByParent.entries()) {
    childrenByParent.set(parentId, sortChildSessions(childSessions, branchOrderMap));
  }
  const branchContextBySessionId = buildBranchContextBySessionId(trackerSnapshot?.branchContexts);
  const collections = createQuestGraphCollections({ questId });

  function addNode(node = {}) {
    return appendGraphNode(collections, {
      childNodeIds: [],
      candidateNodeIds: [],
      isCurrent: false,
      isCurrentPath: false,
      ...node,
      origin: node?.origin || { type: 'projection', sourceId: 'continuity' },
    });
  }

  addNode({
    id: rootNodeId,
    questId,
    kind: 'main',
    lineRole: 'main',
    sessionId: rootSession.id,
    sourceSessionId: rootSession.id,
    parentNodeId: null,
    depth: 0,
    title: getSessionTitle(rootSession),
    summary: getNodeSummary(rootSession),
    status: getRootNodeStatus(rootSession, { isCurrent: activeNodeId === rootNodeId }),
    workflowState: trimText(rootSession?.workflowState || ''),
    activityState: trimText(rootSession?.activity?.run?.state || ''),
    isCurrent: activeNodeId === rootNodeId,
    isCurrentPath: activeNodeId === rootNodeId,
    conclusionCount: Array.isArray(rootSession?.taskCard?.knownConclusions)
      ? rootSession.taskCard.knownConclusions.filter(Boolean).length
      : 0,
    bucket: trimText(rootSession?.taskPoolMembership?.longTerm?.bucket || ''),
    updatedAt: trimText(rootSession?.lastEventAt || rootSession?.updatedAt || ''),
  });

  function appendCandidateNodes(parentSession = null, parentNodeId = '', depth = 1, directChildSessions = []) {
    const rawCandidates = getTaskCardList(getTaskCard(parentSession), 'candidateBranches');
    if (!rawCandidates.length) return;
    const parentTaskCard = getTaskCard(parentSession);
    const branchReason = trimText(parentTaskCard?.branchReason || `从「${getSessionTitle(parentSession)}」继续拆出独立支线`);
    const checkpointSummary = trimText(parentTaskCard?.checkpoint);
    const existingChildKeys = new Set();
    for (const childSession of directChildSessions) {
      for (const key of getCandidateKeysForSession(childSession)) {
        existingChildKeys.add(key);
      }
    }
    const seenCandidates = new Set();
    for (const candidateTitle of rawCandidates) {
      const normalizedTitle = toConciseGoal(candidateTitle, 64);
      const candidateKey = normalizeKey(normalizedTitle);
      if (!candidateKey || seenCandidates.has(candidateKey) || existingChildKeys.has(candidateKey)) continue;
      seenCandidates.add(candidateKey);
      addNode({
        id: `candidate:${parentSession.id}:${slugify(normalizedTitle)}`,
        questId,
        kind: 'candidate',
        lineRole: 'candidate',
        sessionId: '',
        sourceSessionId: parentSession.id,
        parentNodeId,
        depth,
        title: normalizedTitle,
        summary: '建议拆分',
        status: 'candidate',
        actionPayload: {
          branchReason,
          checkpointSummary: checkpointSummary || normalizedTitle,
        },
      });
    }
  }

  function appendBranchTree(parentSessionId = '', parentNodeId = '', depth = 1) {
    const directChildSessions = childrenByParent.get(parentSessionId) || [];
    for (const branchSession of directChildSessions) {
      const nodeId = `session:${branchSession.id}`;
      const branchCtx = branchContextBySessionId.get(trimText(branchSession.id));
      const branchStatus = getBranchStatus(branchSession, branchCtx);
      const isMerged = branchStatus === 'merged' || branchStatus === 'resolved';
      const conclusionText = isMerged ? trimText(branchCtx?.checkpointSummary) : '';
      addNode({
        id: nodeId,
        questId,
        kind: 'branch',
        lineRole: 'branch',
        sessionId: branchSession.id,
        sourceSessionId: branchSession.id,
        parentNodeId,
        depth,
        title: getBranchTitle(branchSession),
        summary: conclusionText || getNodeSummary(branchSession),
        status: branchStatus,
        workflowState: trimText(branchSession?.workflowState || ''),
        activityState: trimText(branchSession?.activity?.run?.state || ''),
        isCurrent: nodeId === activeNodeId,
        isCurrentPath: currentLineageIds.has(branchSession.id),
        conclusionText,
        // Extra info for richer node display
        conclusionCount: Array.isArray(branchSession?.taskCard?.knownConclusions)
          ? branchSession.taskCard.knownConclusions.filter(Boolean).length
          : 0,
        bucket: trimText(branchSession?.taskPoolMembership?.longTerm?.bucket || ''),
        updatedAt: trimText(branchSession?.lastEventAt || branchSession?.updatedAt || ''),
      });
      appendBranchTree(branchSession.id, nodeId, depth + 1);
      appendCandidateNodes(branchSession, nodeId, depth + 1, childrenByParent.get(branchSession.id) || []);
    }
  }

  appendBranchTree(rootSession.id, rootNodeId, 1);
  appendCandidateNodes(rootSession, rootNodeId, 1, childrenByParent.get(rootSession.id) || []);

  const allBranchNodes = collections.nodes.filter((node) => node?.kindEffect?.countsAs?.branch === true);
  const hasOpenBranches = allBranchNodes.some((node) => node.status === 'active' || node.status === 'parked');
  if ((childrenByParent.get(rootSession.id) || []).length > 0 && allBranchNodes.length > 0 && !hasOpenBranches) {
    addNode({
      id: `done:${rootSession.id}`,
      questId,
      kind: 'done',
      lineRole: 'main',
      sessionId: rootSession.id,
      sourceSessionId: rootSession.id,
      parentNodeId: rootNodeId,
      depth: 1,
      title: '任务收束',
      summary: `${allBranchNodes.length} 条支线已全部完成`,
      status: 'done',
    });
  }

  const activeNode = collections.nodeById.get(activeNodeId)
    || collections.nodeById.get(rootNodeId)
    || collections.nodes[0]
    || null;
  const currentPathNodeIds = collections.nodes
    .filter((node) => node.isCurrent || node.isCurrentPath)
    .map((node) => node.id);

  return buildQuestGraphSnapshot({
    collections,
    questId,
    rootSessionId: rootSession.id,
    title: clipText(
      trimText(rootSession?.name || cluster?.mainGoal || rootSession?.taskCard?.mainGoal || rootSession?.taskCard?.goal || '当前任务'),
      72,
    ),
    summary: getNodeSummary(rootSession),
    currentNodeId: activeNode?.id || rootNodeId,
    currentNodeTitle: activeNode?.title || getSessionTitle(rootSession),
    currentPathNodeIds,
  });
}

export async function getTaskMapGraphForSession(sessionId = '') {
  const scope = await resolveTaskMapPlanSessionScope(sessionId);
  const trackerSnapshot = await getWorkbenchTrackerSnapshot(sessionId);
  const sessionById = new Map(scope.sessions.filter((session) => session?.id).map((session) => [session.id, session]));
  const rootSession = sessionById.get(scope.rootSessionId) || scope.session || null;
  const cluster = (Array.isArray(trackerSnapshot?.taskClusters) ? trackerSnapshot.taskClusters[0] : null)
    || buildRootOnlyCluster(rootSession);
  const defaultQuest = buildDefaultQuestGraph({
    rootSession,
    cluster,
    trackerSnapshot,
    currentSessionId: trimText(scope.session?.id || sessionId),
  });
  const taskMapGraph = applyTaskMapPlansToQuestGraph({
    quest: defaultQuest,
    taskMapPlans: trackerSnapshot?.taskMapPlans,
  });
  return {
    session: scope.session,
    rootSessionId: scope.rootSessionId,
    taskMapGraph,
    taskMapPlans: normalizeRelevantTaskMapPlans(trackerSnapshot?.taskMapPlans, scope.rootSessionId),
    counts: taskMapGraph?.counts || buildQuestNodeCounts(taskMapGraph?.nodes || []),
  };
}
