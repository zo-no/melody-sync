import {
  createWorkbenchSession,
  getWorkbenchSession,
  listWorkbenchSessions,
  submitWorkbenchSessionMessage,
  updateWorkbenchSessionLineage,
  updateWorkbenchSessionTaskCard,
  updateWorkbenchSessionTaskPoolMembership,
} from './session-ports.mjs';
import { appendEvent, getHistorySnapshot } from '../history.mjs';
import { messageEvent, statusEvent } from '../normalizer.mjs';
import { normalizeSessionTaskCard } from '../session/task-card.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import {
  createWorkbenchId,
  dedupeTexts,
  nowIso,
  normalizeLineRole,
  normalizeBranchContextStatus,
  normalizeNodeState,
  normalizeNodeType,
  normalizeNullableText,
} from './shared.mjs';
import { getLatestBranchContextEntry, getWorkbenchSnapshot } from './continuity-store.mjs';
import { buildBranchSeedPrompt } from './exporters.mjs';
import {
  loadWorkbenchState as loadState,
  saveWorkbenchState as saveState,
} from './state-store.mjs';
import { emit as emitHook } from '../hooks/runtime/registry.mjs';
import {
  getNodeById,
  getProjectById,
  getProjectByScopeKey,
} from './project-records.mjs';
import { workbenchQueue } from './queues.mjs';

function getRecordedParentSessionId(session, context = null) {
  return normalizeNullableText(
    context?.parentSessionId
    || session?.sourceContext?.parentSessionId,
  );
}

function getActiveSessionContext(state, sessionId) {
  const normalized = normalizeNullableText(sessionId);
  if (!normalized) return null;
  return (state.branchContexts || []).find((entry) => (
    normalizeNullableText(entry.sessionId) === normalized
    && normalizeBranchContextStatus(entry.status) === 'active'
  )) || null;
}

function clipText(value, max = 64) {
  const text = normalizeNullableText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toConciseGoal(value, max = 64) {
  const compact = normalizeNullableText(value);
  if (!compact) return '';
  const firstSegment = compact
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return clipText(firstSegment || compact, max);
}

function getSessionTitle(session) {
  const name = normalizeNullableText(session?.name || '');
  const goal = normalizeNullableText(session?.taskCard?.goal || '');
  const mainGoal = normalizeNullableText(session?.taskCard?.mainGoal || '');
  const lineRole = normalizeLineRole(
    session?.taskCard?.lineRole
    || (session?.sourceContext?.parentSessionId ? 'branch' : 'main'),
  );
  return toConciseGoal(
    lineRole === 'branch'
      ? (goal || name || mainGoal || '当前任务')
      : (name || mainGoal || goal || '当前任务'),
    64,
  );
}

function buildActiveParentSessionMap(state, sessions = []) {
  const parentMap = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = normalizeNullableText(session?.id);
    if (!sessionId) continue;
    const context = getLatestBranchContextEntry(state, sessionId);
    const parentSessionId = getRecordedParentSessionId(session, context);
    if (!parentSessionId) continue;
    parentMap.set(sessionId, parentSessionId);
  }
  return parentMap;
}

function collectSessionSubtreeIds(rootSessionId, parentMap = new Map()) {
  const normalizedRootSessionId = normalizeNullableText(rootSessionId);
  const subtreeIds = new Set();
  if (!normalizedRootSessionId) return subtreeIds;
  const childrenByParent = new Map();
  for (const [sessionId, parentSessionId] of parentMap.entries()) {
    if (!childrenByParent.has(parentSessionId)) {
      childrenByParent.set(parentSessionId, []);
    }
    childrenByParent.get(parentSessionId).push(sessionId);
  }
  const stack = [normalizedRootSessionId];
  while (stack.length > 0) {
    const currentSessionId = stack.pop();
    if (!currentSessionId || subtreeIds.has(currentSessionId)) continue;
    subtreeIds.add(currentSessionId);
    for (const childSessionId of childrenByParent.get(currentSessionId) || []) {
      stack.push(childSessionId);
    }
  }
  return subtreeIds;
}

async function syncSessionSubtreeLineage(sourceSessionId, {
  targetSession = null,
  sessions = [],
  subtreeIds = new Set(),
} = {}) {
  const normalizedSourceSessionId = normalizeNullableText(sourceSessionId);
  if (!normalizedSourceSessionId || !(subtreeIds instanceof Set) || subtreeIds.size === 0) {
    return;
  }
  const sessionMap = new Map(
    (Array.isArray(sessions) ? sessions : [])
      .filter((session) => normalizeNullableText(session?.id))
      .map((session) => [normalizeNullableText(session.id), session]),
  );
  const nextRootSessionId = normalizeNullableText(targetSession?.rootSessionId || targetSession?.id)
    || normalizedSourceSessionId;

  for (const sessionId of subtreeIds) {
    const normalizedSessionId = normalizeNullableText(sessionId);
    if (!normalizedSessionId) continue;
    const session = sessionMap.get(normalizedSessionId) || null;
    const nextParentSessionId = normalizedSessionId === normalizedSourceSessionId
      ? normalizeNullableText(targetSession?.id)
      : normalizeNullableText(session?.sourceContext?.parentSessionId);
    await updateWorkbenchSessionLineage(normalizedSessionId, {
      parentSessionId: nextParentSessionId,
      rootSessionId: nextRootSessionId,
    });
  }
}

function buildReparentedTaskCard(sourceSession, {
  targetSession = null,
  targetMainGoal = '',
  branchReason = '',
} = {}) {
  const current = normalizeSessionTaskCard(sourceSession?.taskCard || {}) || {};
  const currentGoal = normalizeNullableText(
    current.goal
    || sourceSession?.name
    || current.mainGoal
    || '当前任务'
  );
  if (!targetSession) {
    return normalizeSessionTaskCard({
      ...current,
      goal: currentGoal,
      mainGoal: normalizeNullableText(
        sourceSession?.name
        || current.goal
        || current.mainGoal
        || currentGoal
      ),
      lineRole: 'main',
      branchFrom: '',
      branchReason: '',
    });
  }
  const targetTitle = getSessionTitle(targetSession);
  return normalizeSessionTaskCard({
    ...current,
    goal: currentGoal,
    mainGoal: normalizeNullableText(
      targetMainGoal
      || current.mainGoal
      || current.goal
      || targetTitle
      || currentGoal
    ),
    lineRole: 'branch',
    branchFrom: targetTitle,
    branchReason: normalizeNullableText(branchReason) || `挂到「${targetTitle}」下`,
  });
}

function pickProjectTitle(session, taskCard) {
  return normalizeNullableText(
    session?.name
    || taskCard?.mainGoal
    || taskCard?.goal
    || session?.group
    || 'Continuity Workspace'
  );
}

function pickMainGoal(session, taskCard, options = {}) {
  const lineRole = options.lineRole || (getRecordedParentSessionId(session, options.context) ? 'branch' : 'main');
  const goal = normalizeNullableText(
    lineRole === 'branch'
      ? (taskCard?.goal || session?.name || '')
      : (session?.name || taskCard?.goal || ''),
  );
  const branchFrom = normalizeNullableText(taskCard?.branchFrom);
  return normalizeNullableText(
    (lineRole === 'branch' ? taskCard?.mainGoal : '')
    || (lineRole === 'branch' ? branchFrom : '')
    || goal
  );
}

function pickCheckpoint(taskCard, fallback = '') {
  return normalizeNullableText(
    taskCard?.checkpoint
    || taskCard?.summary
    || (Array.isArray(taskCard?.knownConclusions) ? taskCard.knownConclusions[0] : '')
    || (Array.isArray(taskCard?.nextSteps) ? taskCard.nextSteps[0] : '')
    || fallback
  );
}

function buildBranchCarryoverLine(branchTitle, broughtBack) {
  const title = normalizeNullableText(branchTitle) || '支线';
  const summary = normalizeNullableText(broughtBack);
  if (!summary) return '';
  return `来自支线「${title}」：${summary}`;
}

function buildBranchCarryoverSeed({
  sourceSession = null,
  mainGoal = '',
  branchFrom = '',
  checkpointSummary = '',
  nextStep = '',
  projectTitle = '',
} = {}) {
  const sourceTaskCard = normalizeSessionTaskCard(sourceSession?.taskCard || {}) || {};
  const resolvedMainGoal = normalizeNullableText(
    mainGoal
    || sourceTaskCard.mainGoal
    || sourceTaskCard.goal
    || projectTitle
    || sourceSession?.name
  );
  const resolvedBranchFrom = normalizeNullableText(
    branchFrom
    || sourceTaskCard.goal
    || sourceTaskCard.branchFrom
    || resolvedMainGoal
  );
  const resolvedCheckpoint = normalizeNullableText(
    checkpointSummary
    || sourceTaskCard.checkpoint
    || sourceTaskCard.summary
    || (sourceTaskCard.nextSteps || [])[0]
  );
  const resolvedNextStep = normalizeNullableText(
    nextStep
    || (sourceTaskCard.nextSteps || [])[0]
    || resolvedCheckpoint
  );
  const resolvedSummary = normalizeNullableText(sourceTaskCard.summary);
  return {
    mainGoal: resolvedMainGoal,
    branchFrom: resolvedBranchFrom,
    checkpointSummary: resolvedCheckpoint,
    nextStep: resolvedNextStep,
    carryoverSummary: normalizeNullableText(
      [
        resolvedSummary ? `主线摘要：${resolvedSummary}` : '',
        resolvedCheckpoint ? `分叉前进度：${resolvedCheckpoint}` : '',
      ].filter(Boolean).join('；')
    ),
    background: dedupeTexts([
      resolvedMainGoal ? `主线目标：${resolvedMainGoal}` : '',
      resolvedBranchFrom ? `分叉位置：${resolvedBranchFrom}` : '',
      resolvedSummary ? `主线当前摘要：${resolvedSummary}` : '',
      resolvedCheckpoint ? `切出前推进点：${resolvedCheckpoint}` : '',
      resolvedNextStep ? `主线下一步：${resolvedNextStep}` : '',
      ...(sourceTaskCard.background || []).slice(0, 2),
    ]),
    rawMaterials: dedupeTexts([
      ...(sourceTaskCard.rawMaterials || []).slice(0, 2),
      ...(sourceTaskCard.knownConclusions || []).slice(0, 2),
    ]),
    knownConclusions: dedupeTexts((sourceTaskCard.knownConclusions || []).slice(0, 2)),
  };
}

function buildSeedBranchTaskCard({
  goal = '',
  mainGoal = '',
  branchFrom = '',
  branchReason = '',
  checkpointSummary = '',
  nextStep = '',
  summary = '',
  background = [],
  rawMaterials = [],
  knownConclusions = [],
} = {}) {
  return normalizeSessionTaskCard({
    mode: 'continue',
    summary: normalizeNullableText(summary),
    goal: normalizeNullableText(goal),
    mainGoal: normalizeNullableText(mainGoal || goal),
    lineRole: 'branch',
    branchFrom: normalizeNullableText(branchFrom),
    branchReason: normalizeNullableText(branchReason),
    checkpoint: normalizeNullableText(checkpointSummary),
    candidateBranches: [],
    background: dedupeTexts(background),
    rawMaterials: dedupeTexts(rawMaterials),
    assumptions: [],
    knownConclusions: dedupeTexts(knownConclusions),
    nextSteps: normalizeNullableText(nextStep) ? [normalizeNullableText(nextStep)] : [],
    memory: [],
    needsFromUser: [],
  });
}

async function appendBranchEnteredStatus(sessionId, { branchTitle = '', branchFrom = '' } = {}) {
  const title = normalizeNullableText(branchTitle) || '支线';
  const from = normalizeNullableText(branchFrom);
  await appendEvent(sessionId, statusEvent(`已进入支线：${title}`, {
    statusKind: 'branch_entered',
    branchTitle: title,
    branchFrom: from,
  }));
}

function buildMergedParentTaskCard(parentSession, {
  branchTitle,
  mergeType,
  broughtBack,
  nextStep,
} = {}) {
  const current = normalizeSessionTaskCard(parentSession?.taskCard || {}) || {};
  const carryoverLine = buildBranchCarryoverLine(branchTitle, broughtBack);
  const carriedBackground = mergeType === 'conclusion'
    ? (current.background || [])
    : dedupeTexts([carryoverLine, ...(current.background || [])]);
  const carriedConclusions = mergeType === 'conclusion'
    ? dedupeTexts([carryoverLine, ...(current.knownConclusions || [])])
    : (current.knownConclusions || []);
  const carriedNextSteps = nextStep
    ? dedupeTexts([nextStep, ...(current.nextSteps || [])])
    : (current.nextSteps || []);
  const remainingCandidates = (current.candidateBranches || []).filter((entry) => (
    normalizeNullableText(entry).toLowerCase() !== normalizeNullableText(branchTitle).toLowerCase()
  ));

  return normalizeSessionTaskCard({
    ...current,
    goal: current.goal || normalizeNullableText(parentSession?.name),
    mainGoal: current.mainGoal || current.goal || normalizeNullableText(parentSession?.name),
    lineRole: 'main',
    branchFrom: '',
    branchReason: '',
    checkpoint: nextStep || carryoverLine || current.checkpoint || '',
    candidateBranches: remainingCandidates,
    background: carriedBackground,
    knownConclusions: carriedConclusions,
    nextSteps: carriedNextSteps,
  });
}

function upsertProject(state, session, taskCard, now) {
  const scopeKey = normalizeNullableText(session?.rootSessionId || session?.id);
  let project = getProjectByScopeKey(state, scopeKey);
  const title = pickProjectTitle(session, taskCard);
  const brief = normalizeNullableText(taskCard?.summary || session?.description || '');
  if (!project) {
    project = {
      id: createWorkbenchId('proj'),
      scopeKey,
      title,
      brief,
      obsidianPath: '',
      status: 'active',
      rootNodeId: '',
      createdAt: now,
      updatedAt: now,
    };
    state.projects.push(project);
    return project;
  }

  const nextProject = {
    ...project,
    title: title || project.title,
    brief: brief || project.brief || '',
    updatedAt: now,
  };
  const projectIndex = state.projects.findIndex((entry) => entry.id === project.id);
  if (projectIndex !== -1) {
    state.projects[projectIndex] = nextProject;
  }
  return nextProject;
}

function upsertNode(state, payload = {}) {
  const now = normalizeNullableText(payload.now) || nowIso();
  const nodeId = normalizeNullableText(payload.id);
  const existingIndex = nodeId
    ? state.nodes.findIndex((entry) => entry.id === nodeId)
    : -1;
  const nextNode = {
    id: nodeId || createWorkbenchId('node'),
    projectId: normalizeNullableText(payload.projectId),
    parentId: normalizeNullableText(payload.parentId),
    title: normalizeNullableText(payload.title) || 'Untitled task',
    type: normalizeNodeType(payload.type || 'task'),
    summary: normalizeNullableText(payload.summary),
    sourceCaptureIds: Array.isArray(payload.sourceCaptureIds)
      ? payload.sourceCaptureIds.filter((entry) => typeof entry === 'string' && entry.trim())
      : [],
    state: normalizeNodeState(payload.state || 'active'),
    nextAction: normalizeNullableText(payload.nextAction),
    createdAt: existingIndex !== -1 ? state.nodes[existingIndex].createdAt || now : now,
    updatedAt: now,
  };
  if (existingIndex !== -1) {
    state.nodes[existingIndex] = nextNode;
  } else {
    state.nodes.push(nextNode);
  }
  return nextNode;
}

function upsertSessionContext(state, payload = {}) {
  const sessionId = normalizeNullableText(payload.sessionId);
  if (!sessionId) {
    throw new Error('sessionId is required');
  }
  const now = normalizeNullableText(payload.now) || nowIso();
  const existingIndex = state.branchContexts.findIndex((entry) => (
    normalizeNullableText(entry.sessionId) === sessionId
    && normalizeBranchContextStatus(entry.status) === 'active'
  ));
  const existing = existingIndex !== -1 ? state.branchContexts[existingIndex] : null;
  const nextContext = {
    id: existing?.id || createWorkbenchId('branch'),
    projectId: normalizeNullableText(payload.projectId),
    nodeId: normalizeNullableText(payload.nodeId),
    mainNodeId: normalizeNullableText(payload.mainNodeId),
    sessionId,
    parentSessionId: normalizeNullableText(payload.parentSessionId),
    lineRole: normalizeLineRole(payload.lineRole),
    status: normalizeBranchContextStatus(payload.status),
    goal: normalizeNullableText(payload.goal),
    mainGoal: normalizeNullableText(payload.mainGoal),
    branchFrom: normalizeNullableText(payload.branchFrom),
    branchReason: normalizeNullableText(payload.branchReason),
    returnToNodeId: normalizeNullableText(payload.returnToNodeId),
    checkpointSummary: normalizeNullableText(payload.checkpointSummary),
    resumeHint: normalizeNullableText(payload.resumeHint),
    nextStep: normalizeNullableText(payload.nextStep),
    forkAtSeq: Number.isInteger(payload.forkAtSeq) ? payload.forkAtSeq : (existing?.forkAtSeq ?? null),
    snoozedUntil: normalizeNullableText(payload.snoozedUntil),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex !== -1) {
    state.branchContexts[existingIndex] = nextContext;
  } else {
    state.branchContexts.push(nextContext);
  }
  return nextContext;
}

function syncSessionContinuityState(state, session, taskCardInput, now = nowIso(), sessionStateInput = null) {
  const taskCard = normalizeSessionTaskCard(taskCardInput || session.taskCard || {});
  const project = upsertProject(state, session, taskCard, now);

  const existingContext = getActiveSessionContext(state, session.id);
  const parentSessionId = getRecordedParentSessionId(session, existingContext);
  const sessionState = resolveSessionStateFromSession({
    ...session,
    taskCard,
    sessionState: sessionStateInput || session?.sessionState || null,
  }, {
    ...(existingContext || {}),
    parentSessionId,
  });
  const lineRole = normalizeLineRole(sessionState.lineRole || (parentSessionId ? 'branch' : 'main'));
  const mainGoal = normalizeNullableText(
    sessionState.mainGoal
    || pickMainGoal(session, taskCard, {
    context: existingContext,
    lineRole,
  })
    || project.title
  );
  const currentGoal = normalizeNullableText(sessionState.goal || taskCard?.goal || session.name || mainGoal);
  const nextStep = normalizeNullableText((taskCard?.nextSteps || [])[0]);
  const checkpoint = normalizeNullableText(
    sessionState.checkpoint
    || pickCheckpoint(taskCard, currentGoal || mainGoal)
  );
  const sourceNodeId = normalizeNullableText(session?.sourceContext?.nodeId);
  const sourceNode = sourceNodeId ? getNodeById(state, sourceNodeId) : null;

  let rootNode = project.rootNodeId ? getNodeById(state, project.rootNodeId) : null;
  rootNode = upsertNode(state, {
    id: rootNode?.id,
    projectId: project.id,
    parentId: '',
    title: mainGoal,
    type: 'task',
    summary: lineRole === 'main'
      ? normalizeNullableText(taskCard?.summary || sessionState.checkpoint || checkpoint)
      : normalizeNullableText(rootNode?.summary || mainGoal),
    nextAction: lineRole === 'main'
      ? nextStep
      : normalizeNullableText(rootNode?.nextAction || nextStep),
    state: lineRole === 'main' ? 'active' : (rootNode?.state || 'active'),
    now,
  });

  const projectIndex = state.projects.findIndex((entry) => entry.id === project.id);
  if (projectIndex !== -1) {
    state.projects[projectIndex] = {
      ...state.projects[projectIndex],
      title: mainGoal || state.projects[projectIndex].title,
      rootNodeId: rootNode.id,
      updatedAt: now,
    };
  }

  if (existingContext && normalizeLineRole(existingContext.lineRole) !== lineRole) {
    const contextIndex = state.branchContexts.findIndex((entry) => entry.id === existingContext.id);
    if (contextIndex !== -1) {
      state.branchContexts[contextIndex] = {
        ...state.branchContexts[contextIndex],
        status: 'resolved',
        updatedAt: now,
      };
    }
  }

  let currentNode = rootNode;
  let branchFrom = '';
  let branchReason = '';
  let returnToNodeId = '';

  if (lineRole === 'branch') {
    branchFrom = normalizeNullableText(sessionState.branchFrom || taskCard?.branchFrom || sourceNode?.title || mainGoal);
    branchReason = normalizeNullableText(taskCard?.branchReason);
    const latestActiveContext = getActiveSessionContext(state, session.id);
    const latestBranchNode = latestActiveContext && normalizeLineRole(latestActiveContext.lineRole) === 'branch'
      ? getNodeById(state, latestActiveContext.nodeId)
      : null;
    const branchParentId = sourceNode?.id || rootNode.id;
    currentNode = upsertNode(state, {
      id: latestBranchNode?.id,
      projectId: project.id,
      parentId: branchParentId,
      title: currentGoal,
      type: 'task',
      summary: normalizeNullableText(taskCard?.summary || sessionState.checkpoint || checkpoint),
      nextAction: nextStep,
      state: 'active',
      now,
    });
    returnToNodeId = sourceNode?.id || rootNode.id;
  }

  const context = upsertSessionContext(state, {
    projectId: project.id,
    nodeId: currentNode.id,
    mainNodeId: rootNode.id,
    sessionId: session.id,
    parentSessionId,
    lineRole,
    status: 'active',
    goal: currentGoal,
    mainGoal,
    branchFrom,
    branchReason,
    returnToNodeId,
    checkpointSummary: checkpoint,
    resumeHint: normalizeNullableText(sessionState.checkpoint || taskCard?.checkpoint || nextStep || checkpoint),
    nextStep,
    snoozedUntil: existingContext?.snoozedUntil || '',
    now,
  });

  return {
    project: getProjectById(state, project.id),
    rootNode: getNodeById(state, rootNode.id),
    currentNode: getNodeById(state, currentNode.id),
    context,
  };
}

export async function syncSessionContinuityFromSession(sessionLike, options = {}) {
  const sessionId = sessionLike && typeof sessionLike === 'object'
    ? normalizeNullableText(sessionLike.id)
    : normalizeNullableText(sessionLike);
  return workbenchQueue(sessionId || '__global__', async () => {
    const session = sessionLike && typeof sessionLike === 'object'
      ? sessionLike
      : await getWorkbenchSession(sessionId);
    if (!session?.id) {
      throw new Error('Session not found');
    }

    const now = nowIso();
    const state = await loadState();
    const result = syncSessionContinuityState(state, session, options.taskCard, now, options.sessionState);
    await saveState(state);
    return result;
  });
}

export async function setSessionReminderSnooze(sessionId, payload = {}) {
  return workbenchQueue(async () => {
    const normalizedSessionId = normalizeNullableText(sessionId);
    if (!normalizedSessionId) {
      throw new Error('sessionId is required');
    }

    const session = await getWorkbenchSession(normalizedSessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const state = await loadState();
    const now = nowIso();
    syncSessionContinuityState(state, session, session.taskCard, now);
    const context = getActiveSessionContext(state, normalizedSessionId);
    if (!context) {
      throw new Error('Session continuity context not found');
    }

    const untilValue = payload && Object.prototype.hasOwnProperty.call(payload, 'until')
      ? normalizeNullableText(payload.until)
      : normalizeNullableText(payload?.snoozedUntil);
    const contextIndex = state.branchContexts.findIndex((entry) => entry.id === context.id);
    if (contextIndex === -1) {
      throw new Error('Session continuity context not found');
    }
    state.branchContexts[contextIndex] = {
      ...state.branchContexts[contextIndex],
      snoozedUntil: untilValue,
      updatedAt: now,
    };
    await saveState(state);
    return state.branchContexts[contextIndex];
  });
}

export async function createBranchFromNode(nodeId, payload = {}) {
  return workbenchQueue(async () => {
    const state = await loadState();
    const node = getNodeById(state, nodeId);
    if (!node) {
      throw new Error('Node not found');
    }
    const project = getProjectById(state, node.projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const sourceSessionId = normalizeNullableText(payload.sourceSessionId);
    if (!sourceSessionId) {
      throw new Error('sourceSessionId is required');
    }
    const sourceSession = await getWorkbenchSession(sourceSessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    const goal = normalizeNullableText(payload.goal) || `Continue node: ${node.title}`;
    const carryover = buildBranchCarryoverSeed({
      sourceSession,
      mainGoal: project.title,
      branchFrom: node.title,
      checkpointSummary: normalizeNullableText(payload.checkpointSummary) || node.summary || '',
      nextStep: normalizeNullableText(node.nextAction),
      projectTitle: project.title,
    });
    const branchSession = await createWorkbenchSession(
      sourceSession.folder,
      sourceSession.tool,
      `Branch · ${node.title}`,
      {
        group: project.title,
        description: `Branch from ${project.title} / ${node.title}`,
        sourceId: sourceSession.sourceId || '',
        sourceName: sourceSession.sourceName || '',
        model: sourceSession.model || '',
        effort: sourceSession.effort || '',
        thinking: sourceSession.thinking === true,
        activeAgreements: sourceSession.activeAgreements || [],
        taskListOrigin: 'user',
        taskListVisibility: 'secondary',
        sourceContext: {
          kind: 'workbench_node_branch',
          projectId: project.id,
          projectTitle: project.title,
          nodeId: node.id,
          nodeTitle: node.title,
          nodeType: node.type,
          parentSessionId: sourceSession.id,
        },
      },
    );
    if (!branchSession) {
      throw new Error('Unable to create branch session');
    }

    // Inherit parent session's long-term project membership so the branch stays
    // inside the same project and doesn't appear as an unaffiliated task.
    const sourceMembership = sourceSession?.taskPoolMembership?.longTerm;
    if (sourceMembership?.projectSessionId && sourceMembership?.role === 'member') {
      try {
        await updateWorkbenchSessionTaskPoolMembership(branchSession.id, {
          longTerm: {
            role: 'member',
            projectSessionId: sourceMembership.projectSessionId,
            fixedNode: false,
            ...(sourceMembership.bucket ? { bucket: sourceMembership.bucket } : {}),
          },
        });
      } catch (_err) {
        // Non-fatal: branch is still usable without membership
      }
    }

    const now = nowIso();
    const branchContext = {
      id: createWorkbenchId('branch'),
      projectId: project.id,
      nodeId: node.id,
      mainNodeId: project.rootNodeId || node.id,
      sessionId: branchSession.id,
      parentSessionId: sourceSession.id,
      lineRole: 'branch',
      status: 'active',
      goal,
      mainGoal: normalizeNullableText(project.title || node.title),
      branchFrom: normalizeNullableText(node.title),
      branchReason: '',
      returnToNodeId: normalizeNullableText(payload.returnToNodeId) || node.id,
      checkpointSummary: normalizeNullableText(payload.checkpointSummary) || node.summary || '',
      resumeHint: normalizeNullableText(payload.checkpointSummary) || node.nextAction || node.summary || '',
      nextStep: normalizeNullableText(node.nextAction),
      snoozedUntil: '',
      createdAt: now,
      updatedAt: now,
    };
    state.branchContexts.push(branchContext);
    await saveState(state);
    const seededBranchSession = await updateWorkbenchSessionTaskCard(branchSession.id, buildSeedBranchTaskCard({
      goal,
      summary: carryover.carryoverSummary,
      mainGoal: carryover.mainGoal || branchContext.mainGoal,
      branchFrom: carryover.branchFrom || node.title,
      branchReason: branchContext.branchReason,
      checkpointSummary: carryover.checkpointSummary || branchContext.checkpointSummary,
      nextStep: carryover.nextStep || branchContext.nextStep || branchContext.resumeHint,
      background: carryover.background,
      rawMaterials: carryover.rawMaterials,
      knownConclusions: carryover.knownConclusions,
    }));
    await appendBranchEnteredStatus(branchSession.id, {
      branchTitle: goal,
      branchFrom: node.title,
    });

    if (payload.seedMessage !== false) {
      await submitWorkbenchSessionMessage(branchSession.id, buildBranchSeedPrompt({ project, node, goal, carryover }), [], {
        requestId: createWorkbenchId('branch_seed'),
        ...(sourceSession.model ? { model: sourceSession.model } : {}),
        ...(sourceSession.effort ? { effort: sourceSession.effort } : {}),
        ...(sourceSession.thinking === true ? { thinking: true } : {}),
      });
    }

    const resolvedBranchSession = seededBranchSession || await getWorkbenchSession(branchSession.id) || branchSession;
    await emitHook('branch.opened', {
      sessionId: resolvedBranchSession.id,
      session: resolvedBranchSession,
      parentSessionId: sourceSession.id,
      parentSession: sourceSession,
      branchContext,
      manifest: null,
      appendEvent,
      statusEvent,
    });

    return {
      session: resolvedBranchSession,
      branchContext,
    };
  });
}

export async function createBranchFromSession(sessionId, payload = {}) {
  return workbenchQueue(async () => {
    const sourceSession = await getWorkbenchSession(sessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }

    const state = await loadState();
    const now = nowIso();
    syncSessionContinuityState(state, sourceSession, sourceSession.taskCard, now);
    const activeContext = getActiveSessionContext(state, sessionId);
    if (!activeContext) {
      throw new Error('Active continuity context not found');
    }

    const project = getProjectById(state, activeContext.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const parentNode = getNodeById(state, activeContext.nodeId) || getNodeById(state, activeContext.mainNodeId);
    if (!parentNode) {
      throw new Error('Parent node not found');
    }

    const goal = normalizeNullableText(payload.goal) || `Continue branch: ${parentNode.title}`;
    const carryover = buildBranchCarryoverSeed({
      sourceSession,
      mainGoal: activeContext.mainGoal || project.title || parentNode.title,
      branchFrom: parentNode.title,
      checkpointSummary: normalizeNullableText(payload.checkpointSummary) || activeContext.resumeHint || activeContext.checkpointSummary || '',
      nextStep: normalizeNullableText(payload.nextStep) || activeContext.nextStep || activeContext.resumeHint || '',
      projectTitle: project.title,
    });
    const branchSession = await createWorkbenchSession(
      sourceSession.folder,
      sourceSession.tool,
      `Branch · ${goal}`,
      {
        group: project.title,
        description: `Branch from ${project.title} / ${parentNode.title}`,
        sourceId: sourceSession.sourceId || '',
        sourceName: sourceSession.sourceName || '',
        model: sourceSession.model || '',
        effort: sourceSession.effort || '',
        thinking: sourceSession.thinking === true,
        activeAgreements: sourceSession.activeAgreements || [],
        taskListOrigin: 'user',
        taskListVisibility: 'secondary',
        sourceContext: {
          kind: 'workbench_node_branch',
          projectId: project.id,
          projectTitle: project.title,
          nodeId: parentNode.id,
          nodeTitle: parentNode.title,
          nodeType: parentNode.type,
          parentSessionId: sourceSession.id,
        },
      },
    );
    if (!branchSession) {
      throw new Error('Unable to create branch session');
    }

    // Inherit parent session's long-term project membership so the branch stays
    // inside the same project and doesn't appear as an unaffiliated task.
    const sourceMembership = sourceSession?.taskPoolMembership?.longTerm;
    if (sourceMembership?.projectSessionId && sourceMembership?.role === 'member') {
      try {
        await updateWorkbenchSessionTaskPoolMembership(branchSession.id, {
          longTerm: {
            role: 'member',
            projectSessionId: sourceMembership.projectSessionId,
            fixedNode: false,
            ...(sourceMembership.bucket ? { bucket: sourceMembership.bucket } : {}),
          },
        });
      } catch (_err) {
        // Non-fatal: branch is still usable without membership
      }
    }

    const sourceSnap = await getHistorySnapshot(sourceSession.id);
    const branchContext = {
      id: createWorkbenchId('branch'),
      projectId: project.id,
      nodeId: parentNode.id,
      mainNodeId: activeContext.mainNodeId || project.rootNodeId || parentNode.id,
      sessionId: branchSession.id,
      parentSessionId: sourceSession.id,
      lineRole: 'branch',
      status: 'active',
      goal,
      mainGoal: normalizeNullableText(activeContext.mainGoal || project.title || parentNode.title),
      branchFrom: normalizeNullableText(parentNode.title),
      branchReason: normalizeNullableText(payload.branchReason),
      returnToNodeId: parentNode.id,
      checkpointSummary: normalizeNullableText(payload.checkpointSummary) || activeContext.resumeHint || activeContext.checkpointSummary || '',
      resumeHint: normalizeNullableText(payload.checkpointSummary) || activeContext.nextStep || activeContext.resumeHint || '',
      nextStep: normalizeNullableText(payload.nextStep),
      forkAtSeq: sourceSnap.latestSeq || 0,
      snoozedUntil: '',
      createdAt: now,
      updatedAt: now,
    };
    state.branchContexts.push(branchContext);
    await saveState(state);
    const seededBranchSession = await updateWorkbenchSessionTaskCard(branchSession.id, buildSeedBranchTaskCard({
      goal,
      summary: carryover.carryoverSummary,
      mainGoal: carryover.mainGoal || branchContext.mainGoal,
      branchFrom: carryover.branchFrom || parentNode.title,
      branchReason: branchContext.branchReason,
      checkpointSummary: carryover.checkpointSummary || branchContext.checkpointSummary,
      nextStep: carryover.nextStep || branchContext.nextStep || branchContext.resumeHint,
      background: carryover.background,
      rawMaterials: carryover.rawMaterials,
      knownConclusions: carryover.knownConclusions,
    }));
    await appendBranchEnteredStatus(branchSession.id, {
      branchTitle: goal,
      branchFrom: parentNode.title,
    });

    const resolvedBranchSession = seededBranchSession || await getWorkbenchSession(branchSession.id) || branchSession;
    await emitHook('branch.opened', {
      sessionId: resolvedBranchSession.id,
      session: resolvedBranchSession,
      parentSessionId: sourceSession.id,
      parentSession: sourceSession,
      branchContext,
      manifest: null,
      appendEvent,
      statusEvent,
    });

    return {
      session: resolvedBranchSession,
      branchContext,
    };
  });
}

export async function reparentSession(sessionId, payload = {}) {
  return workbenchQueue(async () => {
    const sourceSessionId = normalizeNullableText(sessionId);
    if (!sourceSessionId) {
      throw new Error('sessionId is required');
    }
    const targetParentSessionId = normalizeNullableText(
      payload?.targetSessionId
      || payload?.parentSessionId
    );
    if (targetParentSessionId && targetParentSessionId === sourceSessionId) {
      throw new Error('Cannot attach a task under itself');
    }

    const sourceSession = await getWorkbenchSession(sourceSessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }

    const targetSession = targetParentSessionId
      ? await getWorkbenchSession(targetParentSessionId)
      : null;
    if (targetParentSessionId && !targetSession) {
      throw new Error('Target session not found');
    }

    const sessions = await listWorkbenchSessions({ includeArchived: true });
    const state = await loadState();
    const now = nowIso();

    syncSessionContinuityState(state, sourceSession, sourceSession.taskCard, now);
    if (targetSession) {
      syncSessionContinuityState(state, targetSession, targetSession.taskCard, now);
    }

    const parentMap = buildActiveParentSessionMap(state, sessions);
    const sourceSubtreeIds = collectSessionSubtreeIds(sourceSessionId, parentMap);
    if (targetParentSessionId && sourceSubtreeIds.has(targetParentSessionId)) {
      throw new Error('Cannot attach a task under itself or its descendants');
    }

    const sourceContext = getActiveSessionContext(state, sourceSessionId)
      || getLatestBranchContextEntry(state, sourceSessionId);
    if (!sourceContext) {
      throw new Error('Source continuity context not found');
    }

    let nextContextPayload = {
      projectId: sourceContext.projectId,
      nodeId: sourceContext.nodeId,
      mainNodeId: sourceContext.mainNodeId,
      sessionId: sourceSessionId,
      parentSessionId: '',
      lineRole: 'main',
      status: normalizeBranchContextStatus(sourceContext.status),
      goal: normalizeNullableText(sourceContext.goal),
      mainGoal: normalizeNullableText(
        sourceSession?.name
        || sourceSession?.taskCard?.goal
        || sourceSession?.taskCard?.mainGoal
        || sourceContext.mainGoal
      ),
      branchFrom: '',
      branchReason: '',
      returnToNodeId: '',
      checkpointSummary: normalizeNullableText(sourceContext.checkpointSummary),
      resumeHint: normalizeNullableText(sourceContext.resumeHint),
      nextStep: normalizeNullableText(sourceContext.nextStep),
      snoozedUntil: normalizeNullableText(sourceContext.snoozedUntil),
      now,
    };

    if (targetSession) {
      const targetContext = getActiveSessionContext(state, targetParentSessionId)
        || getLatestBranchContextEntry(state, targetParentSessionId);
      const targetTitle = getSessionTitle(targetSession);
      nextContextPayload = {
        ...nextContextPayload,
        projectId: normalizeNullableText(targetContext?.projectId || nextContextPayload.projectId),
        mainNodeId: normalizeNullableText(targetContext?.mainNodeId || targetContext?.nodeId || nextContextPayload.mainNodeId),
        parentSessionId: targetParentSessionId,
        lineRole: 'branch',
        mainGoal: normalizeNullableText(
          targetContext?.mainGoal
          || targetSession?.taskCard?.mainGoal
          || targetSession?.taskCard?.goal
          || targetSession?.name
          || nextContextPayload.mainGoal
        ),
        branchFrom: targetTitle,
        branchReason: normalizeNullableText(payload?.branchReason) || `挂到「${targetTitle}」下`,
        returnToNodeId: normalizeNullableText(
          targetContext?.nodeId
          || targetContext?.mainNodeId
          || nextContextPayload.returnToNodeId
        ),
      };
    }

    const branchContext = upsertSessionContext(state, nextContextPayload);
    await saveState(state);

    await syncSessionSubtreeLineage(sourceSessionId, {
      targetSession,
      sessions,
      subtreeIds: sourceSubtreeIds,
    });

    const nextTaskCard = buildReparentedTaskCard(sourceSession, {
      targetSession,
      targetMainGoal: branchContext.mainGoal,
      branchReason: branchContext.branchReason,
    });
    const updatedSession = await updateWorkbenchSessionTaskCard(sourceSessionId, nextTaskCard)
      || await getWorkbenchSession(sourceSessionId)
      || sourceSession;

    if (targetSession) {
      const targetTitle = getSessionTitle(targetSession);
      await appendEvent(sourceSessionId, statusEvent(`已挂到：${targetTitle}`, {
        statusKind: 'branch_reparented',
        parentSessionId: targetParentSessionId,
        parentTitle: targetTitle,
      }));
    } else {
      await appendEvent(sourceSessionId, statusEvent('已移出为主线', {
        statusKind: 'branch_promoted_main',
      }));
    }

    return {
      session: updatedSession,
      branchContext,
      snapshot: await getWorkbenchSnapshot(),
    };
  });
}

export async function mergeBranchSessionBackToMain(sessionId, payload = {}) {
  return workbenchQueue(async () => {
    const branchSession = await getWorkbenchSession(sessionId);
    if (!branchSession) {
      throw new Error('Branch session not found');
    }

    const state = await loadState();
    const now = nowIso();
    const branchContext = getActiveSessionContext(state, sessionId)
      || (state.branchContexts || []).find((entry) => normalizeNullableText(entry.sessionId) === sessionId)
      || null;
    const parentSessionId = normalizeNullableText(payload.parentSessionId)
      || normalizeNullableText(branchContext?.parentSessionId)
      || normalizeNullableText(branchSession?.sourceContext?.parentSessionId);
    if (!parentSessionId) {
      throw new Error('Parent session not found');
    }

    const parentSession = await getWorkbenchSession(parentSessionId);
    if (!parentSession) {
      throw new Error('Parent session not found');
    }

    const branchTaskCard = normalizeSessionTaskCard(branchSession.taskCard || {});
    const branchTitle = normalizeNullableText(payload.branchTitle)
      || normalizeNullableText(branchTaskCard?.goal)
      || normalizeNullableText(branchContext?.goal)
      || normalizeNullableText(branchSession.name)
      || '支线';
    const mergeType = normalizeNullableText(payload.mergeType) === 'conclusion'
      ? 'conclusion'
      : ((branchTaskCard?.knownConclusions || []).length > 0 ? 'conclusion' : 'clue');
    const broughtBack = normalizeNullableText(payload.broughtBack)
      || normalizeNullableText((branchTaskCard?.knownConclusions || [])[0])
      || normalizeNullableText(branchTaskCard?.summary)
      || normalizeNullableText(branchContext?.checkpointSummary)
      || normalizeNullableText(branchTaskCard?.checkpoint)
      || '支线已收束，可带回主线继续。';
    const nextStep = normalizeNullableText(payload.nextStep)
      || normalizeNullableText((branchTaskCard?.nextSteps || [])[0])
      || normalizeNullableText(branchContext?.resumeHint)
      || normalizeNullableText((normalizeSessionTaskCard(parentSession.taskCard || {})?.nextSteps || [])[0]);

    const mergeContent = [
      `已从支线带回：${branchTitle}`,
      broughtBack,
      nextStep ? `下一步：${nextStep}` : '',
    ].filter(Boolean).join('\n');

    const mergedParentTaskCard = buildMergedParentTaskCard(parentSession, {
      branchTitle,
      mergeType,
      broughtBack,
      nextStep,
    });
    const updatedParentSession = await updateWorkbenchSessionTaskCard(parentSessionId, mergedParentTaskCard) || parentSession;

    await appendEvent(parentSessionId, messageEvent('assistant', mergeContent, undefined, {
      messageKind: 'merge_note',
      mergeType,
      branchTitle,
      broughtBack,
      nextStep,
      sourceBranchSessionId: sessionId,
    }));

    const branchIndex = state.branchContexts.findIndex((entry) => normalizeNullableText(entry.sessionId) === sessionId);
    if (branchIndex !== -1) {
      state.branchContexts[branchIndex] = {
        ...state.branchContexts[branchIndex],
        status: 'merged',
        updatedAt: now,
      };
    }

    syncSessionContinuityState(state, updatedParentSession, updatedParentSession.taskCard, now);

    await saveState(state);

    const resolvedParentSession = await getWorkbenchSession(parentSessionId) || updatedParentSession;
    await emitHook('branch.merged', {
      sessionId: resolvedParentSession.id,
      session: resolvedParentSession,
      parentSessionId,
      parentSession: resolvedParentSession,
      branchSessionId: sessionId,
      branchSession,
      branchContext,
      mergeNote: {
        mergeType,
        branchTitle,
        broughtBack,
        nextStep,
      },
      manifest: null,
      appendEvent,
      statusEvent,
    });

    return {
      parentSession: resolvedParentSession,
      mergeNote: {
        mergeType,
        branchTitle,
        broughtBack,
        nextStep,
      },
    };
  });
}

export async function setBranchSessionStatus(sessionId, payload = {}) {
  return workbenchQueue(async () => {
    const branchSession = await getWorkbenchSession(sessionId);
    if (!branchSession) {
      throw new Error('Branch session not found');
    }

    const state = await loadState();
    const now = nowIso();
    const latestContext = getLatestBranchContextEntry(state, sessionId);
    if (!latestContext) {
      throw new Error('Branch context not found');
    }

    const requestedStatus = normalizeBranchContextStatus(payload?.status);
    if (!['active', 'resolved', 'parked'].includes(requestedStatus)) {
      throw new Error('Unsupported branch status');
    }

    const branchIndex = state.branchContexts.findIndex((entry) => entry.id === latestContext.id);
    if (branchIndex === -1) {
      throw new Error('Branch context not found');
    }

    state.branchContexts[branchIndex] = {
      ...state.branchContexts[branchIndex],
      status: requestedStatus,
      updatedAt: now,
    };

    await saveState(state);

    return {
      session: await getWorkbenchSession(sessionId) || branchSession,
      branchContext: state.branchContexts[branchIndex],
    };
  });
}
