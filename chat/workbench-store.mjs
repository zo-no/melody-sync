import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import {
  createWorkbenchSession,
  getWorkbenchSession,
  setWorkbenchSessionBranchCandidateSuppressed,
  submitWorkbenchSessionMessage,
  updateWorkbenchSessionTaskCard,
} from './workbench-session-ports.mjs';
import { appendEvent, getHistorySnapshot } from './history.mjs';
import { messageEvent, statusEvent } from './normalizer.mjs';
import { normalizeSessionTaskCard } from './session-task-card.mjs';
import {
  dedupeTexts,
  normalizeNodeState,
  normalizeNodeType,
  normalizeLineRole,
  normalizeBranchContextStatus,
  normalizeNullableText,
  sortByCreatedAsc,
  sortByUpdatedDesc,
  trimText,
} from './workbench/shared.mjs';
import {
  getLatestBranchContextEntry,
} from './workbench/continuity-store.mjs';
import {
  buildBranchSeedPrompt,
  buildProjectSummaryMarkdown,
  buildProjectTreeMarkdown,
  buildSingleProjectDocument,
  buildSkillsMarkdown,
  resolveFsPath,
  resolveProjectObsidianPath,
} from './workbench/exporters.mjs';
import {
  loadWorkbenchState as loadState,
  saveWorkbenchState as saveState,
} from './workbench/state-store.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  pathExists,
  writeTextAtomic,
} from './fs-utils.mjs';

export { getWorkbenchSnapshot, getWorkbenchTrackerSnapshot } from './workbench/continuity-store.mjs';
export { getSessionOperationRecords } from './workbench/operation-records.mjs';

// Per-scope serial queues prevent cross-session write contention while still
// serializing writes within the same project/session scope.
const _workbenchQueues = new Map();
function WORKBENCH_QUEUE(scopeKey, fn) {
  if (typeof scopeKey === 'function') {
    // Legacy call without scope key — use a global fallback queue.
    if (!_workbenchQueues.has('__global__')) {
      _workbenchQueues.set('__global__', createSerialTaskQueue());
    }
    return _workbenchQueues.get('__global__')(scopeKey);
  }
  const key = typeof scopeKey === 'string' && scopeKey ? scopeKey : '__global__';
  if (!_workbenchQueues.has(key)) {
    _workbenchQueues.set(key, createSerialTaskQueue());
  }
  return _workbenchQueues.get(key)(fn);
}
function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function deriveCaptureTitle(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Untitled capture';
  return compact.slice(0, 72);
}

function getRecordedParentSessionId(session, context = null) {
  return normalizeNullableText(
    context?.parentSessionId
    || session?.sourceContext?.parentSessionId,
  );
}

function getSessionClusterLineRole(session, context = null) {
  return getRecordedParentSessionId(session, context) ? 'branch' : 'main';
}

function getProjectById(state, projectId) {
  return (state.projects || []).find((entry) => entry.id === projectId) || null;
}

function getNodeById(state, nodeId) {
  return (state.nodes || []).find((entry) => entry.id === nodeId) || null;
}

function getSummaryById(state, summaryId) {
  return (state.summaries || []).find((entry) => entry.id === summaryId) || null;
}

function getProjectNodes(state, projectId) {
  return sortByCreatedAsc((state.nodes || []).filter((entry) => entry.projectId === projectId));
}

function getProjectBranchContexts(state, projectId) {
  const projectNodeIds = new Set(getProjectNodes(state, projectId).map((entry) => entry.id));
  return sortByUpdatedDesc((state.branchContexts || []).filter((entry) => projectNodeIds.has(entry.nodeId)));
}

function getProjectSkills(state, projectId) {
  const projectNodeIds = new Set(getProjectNodes(state, projectId).map((entry) => entry.id));
  return sortByUpdatedDesc((state.skills || []).filter((entry) => {
    const evidence = Array.isArray(entry?.evidenceNodeIds) ? entry.evidenceNodeIds : [];
    return evidence.some((nodeId) => projectNodeIds.has(nodeId));
  }));
}

function getProjectByScopeKey(state, scopeKey) {
  const normalized = normalizeNullableText(scopeKey);
  if (!normalized) return null;
  return (state.projects || []).find((entry) => normalizeNullableText(entry.scopeKey) === normalized) || null;
}

function getActiveSessionContext(state, sessionId) {
  const normalized = normalizeNullableText(sessionId);
  if (!normalized) return null;
  return (state.branchContexts || []).find((entry) => (
    normalizeNullableText(entry.sessionId) === normalized
    && normalizeBranchContextStatus(entry.status) === 'active'
  )) || null;
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
      id: createId('proj'),
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
    id: nodeId || createId('node'),
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
    id: existing?.id || createId('branch'),
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
function syncSessionContinuityState(state, session, taskCardInput, now = nowIso()) {
  const taskCard = normalizeSessionTaskCard(taskCardInput || session.taskCard || {});
  const project = upsertProject(state, session, taskCard, now);

  const existingContext = getActiveSessionContext(state, session.id);
  const parentSessionId = getRecordedParentSessionId(session, existingContext);
  const lineRole = parentSessionId ? 'branch' : 'main';
  const mainGoal = pickMainGoal(session, taskCard, {
    context: existingContext,
    lineRole,
  }) || project.title;
  const currentGoal = normalizeNullableText(taskCard?.goal || session.name || mainGoal);
  const nextStep = normalizeNullableText((taskCard?.nextSteps || [])[0]);
  const checkpoint = pickCheckpoint(taskCard, currentGoal || mainGoal);
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
      ? normalizeNullableText(taskCard?.summary || checkpoint)
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
    branchFrom = normalizeNullableText(taskCard?.branchFrom || sourceNode?.title || mainGoal);
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
      summary: normalizeNullableText(taskCard?.summary || checkpoint),
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
    resumeHint: normalizeNullableText(taskCard?.checkpoint || nextStep || checkpoint),
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
  return WORKBENCH_QUEUE(sessionId || '__global__', async () => {
    const session = sessionLike && typeof sessionLike === 'object'
      ? sessionLike
      : await getWorkbenchSession(sessionId);
    if (!session?.id) {
      throw new Error('Session not found');
    }

    const now = nowIso();
    const state = await loadState();
    const result = syncSessionContinuityState(state, session, options.taskCard, now);
    await saveState(state);
    return result;
  });
}

export async function setSessionReminderSnooze(sessionId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
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

export async function createCaptureItem(payload = {}) {
  return WORKBENCH_QUEUE(async () => {
    const text = normalizeNullableText(payload.text);
    if (!text) {
      throw new Error('text is required');
    }
    const now = nowIso();
    const state = await loadState();
    const captureItem = {
      id: createId('cap'),
      sourceSessionId: normalizeNullableText(payload.sourceSessionId),
      sourceMessageSeq: Number.isInteger(payload.sourceMessageSeq) && payload.sourceMessageSeq > 0
        ? payload.sourceMessageSeq
        : null,
      text,
      title: normalizeNullableText(payload.title) || deriveCaptureTitle(text),
      kind: normalizeNodeType(payload.kind),
      status: 'inbox',
      createdAt: now,
      updatedAt: now,
    };
    state.captureItems.push(captureItem);
    await saveState(state);
    return captureItem;
  });
}

export async function createProject(payload = {}) {
  return WORKBENCH_QUEUE(async () => {
    const title = normalizeNullableText(payload.title);
    if (!title) {
      throw new Error('title is required');
    }
    const now = nowIso();
    const state = await loadState();
    const project = {
      id: createId('proj'),
      title,
      brief: normalizeNullableText(payload.brief),
      obsidianPath: await resolveProjectObsidianPath(payload.obsidianPath, title, { pathExists }),
      status: normalizeNullableText(payload.status) || 'active',
      rootNodeId: '',
      createdAt: now,
      updatedAt: now,
    };
    state.projects.push(project);
    await saveState(state);
    return project;
  });
}

export async function createNode(payload = {}) {
  return WORKBENCH_QUEUE(async () => {
    const projectId = normalizeNullableText(payload.projectId);
    const title = normalizeNullableText(payload.title);
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!title) {
      throw new Error('title is required');
    }
    const state = await loadState();
    const project = getProjectById(state, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const parentId = normalizeNullableText(payload.parentId);
    if (parentId) {
      const parentNode = getNodeById(state, parentId);
      if (!parentNode || parentNode.projectId !== projectId) {
        throw new Error('Parent node not found');
      }
    }
    const now = nowIso();
    const node = {
      id: createId('node'),
      projectId,
      parentId,
      title,
      type: normalizeNodeType(payload.type),
      summary: normalizeNullableText(payload.summary),
      sourceCaptureIds: Array.isArray(payload.sourceCaptureIds)
        ? payload.sourceCaptureIds.filter((entry) => typeof entry === 'string' && entry.trim())
        : [],
      state: normalizeNodeState(payload.state),
      nextAction: normalizeNullableText(payload.nextAction),
      createdAt: now,
      updatedAt: now,
    };
    state.nodes.push(node);
    const projectIndex = state.projects.findIndex((entry) => entry.id === projectId);
    if (projectIndex !== -1) {
      const nextProject = { ...state.projects[projectIndex], updatedAt: now };
      if (!nextProject.rootNodeId && !parentId) {
        nextProject.rootNodeId = node.id;
      }
      state.projects[projectIndex] = nextProject;
    }
    await saveState(state);
    return node;
  });
}

export async function promoteCaptureItem(captureId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
    const state = await loadState();
    const captureIndex = state.captureItems.findIndex((entry) => entry.id === captureId);
    if (captureIndex === -1) {
      throw new Error('Capture item not found');
    }
    const capture = state.captureItems[captureIndex];
    const projectId = normalizeNullableText(payload.projectId);
    const project = getProjectById(state, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const parentId = normalizeNullableText(payload.parentId);
    if (parentId) {
      const parentNode = getNodeById(state, parentId);
      if (!parentNode || parentNode.projectId !== projectId) {
        throw new Error('Parent node not found');
      }
    }
    const now = nowIso();
    const node = {
      id: createId('node'),
      projectId,
      parentId,
      title: normalizeNullableText(payload.title) || capture.title || deriveCaptureTitle(capture.text),
      type: normalizeNodeType(payload.type || capture.kind),
      summary: normalizeNullableText(payload.summary) || capture.text,
      sourceCaptureIds: [capture.id],
      state: normalizeNodeState(payload.state),
      nextAction: normalizeNullableText(payload.nextAction),
      createdAt: now,
      updatedAt: now,
    };
    state.nodes.push(node);
    state.captureItems[captureIndex] = {
      ...capture,
      status: 'filed',
      projectId,
      promotedNodeId: node.id,
      updatedAt: now,
    };
    const projectIndex = state.projects.findIndex((entry) => entry.id === projectId);
    if (projectIndex !== -1) {
      const nextProject = { ...state.projects[projectIndex], updatedAt: now };
      if (!nextProject.rootNodeId && !parentId) {
        nextProject.rootNodeId = node.id;
      }
      state.projects[projectIndex] = nextProject;
    }
    await saveState(state);
    return {
      captureItem: state.captureItems[captureIndex],
      node,
    };
  });
}

export async function createBranchFromNode(nodeId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
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
        appId: sourceSession.appId || '',
        appName: sourceSession.appName || '',
        userId: sourceSession.userId || '',
        userName: sourceSession.userName || '',
        model: sourceSession.model || '',
        effort: sourceSession.effort || '',
        thinking: sourceSession.thinking === true,
        activeAgreements: sourceSession.activeAgreements || [],
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

    const now = nowIso();
    const branchContext = {
      id: createId('branch'),
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
        requestId: createId('branch_seed'),
        ...(sourceSession.model ? { model: sourceSession.model } : {}),
        ...(sourceSession.effort ? { effort: sourceSession.effort } : {}),
        ...(sourceSession.thinking === true ? { thinking: true } : {}),
      });
    }

    return {
      session: seededBranchSession || await getWorkbenchSession(branchSession.id) || branchSession,
      branchContext,
    };
  });
}

export async function createBranchFromSession(sessionId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
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
        appId: sourceSession.appId || '',
        appName: sourceSession.appName || '',
        userId: sourceSession.userId || '',
        userName: sourceSession.userName || '',
        model: sourceSession.model || '',
        effort: sourceSession.effort || '',
        thinking: sourceSession.thinking === true,
        activeAgreements: sourceSession.activeAgreements || [],
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

    const sourceSnap = await getHistorySnapshot(sourceSession.id);
    const branchContext = {
      id: createId('branch'),
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

    return {
      session: seededBranchSession || await getWorkbenchSession(branchSession.id) || branchSession,
      branchContext,
    };
  });
}

export async function mergeBranchSessionBackToMain(sessionId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
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

    return {
      parentSession: await getWorkbenchSession(parentSessionId) || updatedParentSession,
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
  return WORKBENCH_QUEUE(async () => {
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

export async function setBranchCandidateSuppressed(sessionId, branchTitle, suppressed = true) {
  const session = await setWorkbenchSessionBranchCandidateSuppressed(sessionId, branchTitle, suppressed);
  return { session };
}

export async function createProjectSummary(projectId) {
  return WORKBENCH_QUEUE(async () => {
    const state = await loadState();
    const project = getProjectById(state, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const nodes = getProjectNodes(state, projectId);
    const branchContexts = getProjectBranchContexts(state, projectId);
    const markdown = buildProjectSummaryMarkdown(project, nodes, branchContexts);
    const now = nowIso();
    const summary = {
      id: createId('summary'),
      projectId,
      title: `${project.title}｜阶段总结`,
      markdown,
      createdAt: now,
      updatedAt: now,
    };
    state.summaries.push(summary);
    const projectIndex = state.projects.findIndex((entry) => entry.id === projectId);
    if (projectIndex !== -1) {
      state.projects[projectIndex] = {
        ...state.projects[projectIndex],
        updatedAt: now,
      };
    }
    await saveState(state);
    return summary;
  });
}

export async function writeProjectToObsidian(projectId, payload = {}) {
  return WORKBENCH_QUEUE(async () => {
    const state = await loadState();
    const project = getProjectById(state, projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    let summary = getSummaryById(state, normalizeNullableText(payload.summaryId));
    if (!summary) {
      const latestSummary = sortByUpdatedDesc((state.summaries || []).filter((entry) => entry.projectId === projectId))[0] || null;
      summary = latestSummary;
    }
    if (!summary) {
      const now = nowIso();
      summary = {
        id: createId('summary'),
        projectId,
        title: `${project.title}｜阶段总结`,
        markdown: buildProjectSummaryMarkdown(project, getProjectNodes(state, projectId), getProjectBranchContexts(state, projectId)),
        createdAt: now,
        updatedAt: now,
      };
      state.summaries.push(summary);
    }

    const nodes = getProjectNodes(state, projectId);
    const branchContexts = getProjectBranchContexts(state, projectId);
    const skills = getProjectSkills(state, projectId);
    const treeMarkdown = buildProjectTreeMarkdown(project, nodes, branchContexts);
    const summaryMarkdown = summary.markdown;
    const skillsMarkdown = buildSkillsMarkdown(project, skills);
    const targetPath = resolveFsPath(project.obsidianPath) || await resolveProjectObsidianPath('', project.title, { pathExists });
    const writtenFiles = [];

    if (extname(targetPath).toLowerCase() === '.md') {
      const document = buildSingleProjectDocument(project, treeMarkdown, summaryMarkdown, skillsMarkdown);
      await writeTextAtomic(targetPath, document);
      writtenFiles.push(targetPath);
    } else {
      await ensureDir(targetPath);
      const treePath = join(targetPath, 'TREE.md');
      const summaryPath = join(targetPath, 'SUMMARY.md');
      const skillsPath = join(targetPath, 'SKILLS.md');
      await Promise.all([
        writeTextAtomic(treePath, treeMarkdown),
        writeTextAtomic(summaryPath, summaryMarkdown),
        writeTextAtomic(skillsPath, skillsMarkdown),
      ]);
      writtenFiles.push(treePath, summaryPath, skillsPath);
    }

    const projectIndex = state.projects.findIndex((entry) => entry.id === projectId);
    if (projectIndex !== -1) {
      state.projects[projectIndex] = {
        ...state.projects[projectIndex],
        obsidianPath: targetPath,
        updatedAt: nowIso(),
      };
    }
    await saveState(state);

    return {
      project: getProjectById(state, projectId),
      summary,
      targetPath,
      writtenFiles,
    };
  });
}
