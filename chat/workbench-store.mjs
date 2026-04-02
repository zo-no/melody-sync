import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { extname, join, resolve } from 'path';
import { CONFIG_DIR } from '../lib/config.mjs';
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
const LOCAL_OBSIDIAN_PROJECT_DIR = join(
  homedir(),
  'Desktop',
  'diary',
  'diary',
  '04-🧰projects',
  '01-📂2-长期项目',
  '2-3-MelodySync',
);

function nowIso() {
  return new Date().toISOString();
}

function resolveFsPath(value) {
  const trimmed = trimText(value);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function slugify(value) {
  const trimmed = trimText(value).toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled-project';
}

function createId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function deriveCaptureTitle(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Untitled capture';
  return compact.slice(0, 72);
}

function normalizeNodeType(value) {
  const type = trimText(value).toLowerCase();
  if ([
    'question',
    'insight',
    'solution',
    'task',
    'risk',
    'conclusion',
    'knowledge',
  ].includes(type)) {
    return type;
  }
  return 'insight';
}

function normalizeNodeState(value) {
  const state = trimText(value).toLowerCase();
  if (['open', 'active', 'done', 'parked'].includes(state)) return state;
  return 'open';
}

function normalizeLineRole(value) {
  const role = trimText(value).toLowerCase();
  if (role === 'branch') return 'branch';
  return 'main';
}


function dedupeTexts(items) {
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeNullableText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }
  return results;
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

async function resolveDefaultObsidianBaseDir() {
  if (await pathExists(LOCAL_OBSIDIAN_PROJECT_DIR)) {
    return LOCAL_OBSIDIAN_PROJECT_DIR;
  }
  return join(CONFIG_DIR, 'obsidian-export');
}

async function resolveProjectObsidianPath(input, title) {
  const explicit = resolveFsPath(input);
  if (explicit) return explicit;
  const baseDir = await resolveDefaultObsidianBaseDir();
  return join(baseDir, slugify(title));
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

function buildTreeLines(nodes, branchContexts) {
  const childrenByParent = new Map();
  const branchesByNode = new Map();
  for (const node of nodes) {
    const key = trimText(node.parentId) || '__root__';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(node);
  }
  for (const context of branchContexts) {
    if (normalizeLineRole(context.lineRole) !== 'branch') continue;
    const list = branchesByNode.get(context.nodeId) || [];
    list.push(context);
    branchesByNode.set(context.nodeId, list);
  }

  const lines = [];
  const renderLevel = (parentId = '', depth = 0) => {
    const key = trimText(parentId) || '__root__';
    const entries = childrenByParent.get(key) || [];
    for (const node of entries) {
      const indent = '  '.repeat(depth);
      const typeLabel = normalizeNodeType(node.type);
      lines.push(`${indent}- [${typeLabel}] ${node.title}`);
      if (trimText(node.summary)) {
        lines.push(`${indent}  - 摘要：${node.summary}`);
      }
      if (trimText(node.nextAction)) {
        lines.push(`${indent}  - 下一步：${node.nextAction}`);
      }
      if (trimText(node.state)) {
        lines.push(`${indent}  - 状态：${node.state}`);
      }
      const branchEntries = branchesByNode.get(node.id) || [];
      for (const branch of branchEntries.slice(0, 3)) {
        const branchGoal = trimText(branch.goal) || '继续推进该节点';
        lines.push(`${indent}  - 分支：${branchGoal}`);
      }
      renderLevel(node.id, depth + 1);
    }
  };

  renderLevel('', 0);
  return lines.length > 0 ? lines : ['- 暂无节点'];
}

function buildProjectSummaryMarkdown(project, nodes, branchContexts) {
  const generatedAt = nowIso();
  const openNodes = nodes.filter((entry) => normalizeNodeState(entry.state) !== 'done');
  const nextActions = openNodes
    .map((entry) => trimText(entry.nextAction))
    .filter(Boolean)
    .slice(0, 6);
  const recentBranches = branchContexts
    .filter((entry) => normalizeLineRole(entry.lineRole) === 'branch')
    .slice(0, 6);

  const lines = [
    `# ${project.title}｜阶段总结`,
    '',
    `- 生成时间：${generatedAt}`,
    `- 项目状态：${project.status || 'active'}`,
    `- 节点总数：${nodes.length}`,
    `- 未完成节点：${openNodes.length}`,
    '',
    '## 当前结论',
    '',
    trimText(project.brief) || '当前项目仍在持续推进，核心上下文已经开始沉淀到项目树。',
    '',
    '## 待办',
    '',
  ];

  if (nextActions.length === 0) {
    lines.push('- 暂无明确待办');
  } else {
    for (const action of nextActions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push('', '## 未决问题', '');
  const unresolved = openNodes
    .filter((entry) => normalizeNodeType(entry.type) === 'question' || normalizeNodeType(entry.type) === 'risk')
    .slice(0, 8);
  if (unresolved.length === 0) {
    lines.push('- 暂无明确未决问题');
  } else {
    for (const node of unresolved) {
      lines.push(`- [${normalizeNodeType(node.type)}] ${node.title}`);
    }
  }

  lines.push('', '## 最近分支', '');
  if (recentBranches.length === 0) {
    lines.push('- 暂无分支记录');
  } else {
    for (const branch of recentBranches) {
      lines.push(`- ${trimText(branch.goal) || '继续推进该节点'}（session: ${branch.sessionId}）`);
    }
  }

  lines.push('', '## 项目树快照', '');
  lines.push(...buildTreeLines(nodes, branchContexts));
  lines.push('');
  return lines.join('\n');
}

function buildProjectTreeMarkdown(project, nodes, branchContexts) {
  const lines = [
    `# ${project.title}`,
    '',
    trimText(project.brief) || '暂无项目简介。',
    '',
    `- 项目状态：${project.status || 'active'}`,
    `- Obsidian 路径：${project.obsidianPath}`,
    '',
    '## Tree',
    '',
    ...buildTreeLines(nodes, branchContexts),
    '',
  ];
  return lines.join('\n');
}

function buildSkillsMarkdown(project, skills) {
  const lines = [
    `# ${project.title}｜Skills`,
    '',
  ];
  if (!skills.length) {
    lines.push('- 当前还没有经过验证的 skill。', '');
    return lines.join('\n');
  }
  for (const skill of skills) {
    lines.push(`## ${skill.title}`);
    lines.push('');
    lines.push(`- 触发条件：${trimText(skill.trigger) || '未定义'}`);
    lines.push(`- 状态：${trimText(skill.status) || 'draft'}`);
    if (trimText(skill.procedure)) {
      lines.push('', trimText(skill.procedure));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildSingleProjectDocument(project, treeMarkdown, summaryMarkdown, skillsMarkdown) {
  return [
    treeMarkdown.trim(),
    '',
    '---',
    '',
    summaryMarkdown.trim(),
    '',
    '---',
    '',
    skillsMarkdown.trim(),
    '',
  ].join('\n');
}

function formatSeedList(label, items = []) {
  const entries = dedupeTexts(items);
  if (!entries.length) return '';
  return `${label}:\n${entries.map((entry) => `- ${entry}`).join('\n')}`;
}

function buildBranchSeedPrompt({ project, node, goal, carryover = null }) {
  return [
    'Continue this branch based on the existing project node context.',
    '',
    `Project: ${project.title}`,
    `Node: ${node.title}`,
    `Node type: ${normalizeNodeType(node.type)}`,
    goal ? `Branch goal: ${goal}` : 'Branch goal: Continue exploring this node without losing the main line.',
    normalizeNullableText(carryover?.carryoverSummary) ? `Mainline carryover: ${carryover.carryoverSummary}` : '',
    trimText(node.summary) ? `Node summary: ${node.summary}` : '',
    trimText(node.nextAction) ? `Suggested next action: ${node.nextAction}` : '',
    formatSeedList('Carryover background', carryover?.background || []),
    formatSeedList('Carryover materials', carryover?.rawMaterials || []),
    formatSeedList('Carryover conclusions', carryover?.knownConclusions || []),
    '',
    'Start by restating the branch objective, then propose the next concrete step.',
  ].filter(Boolean).join('\n');
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
      obsidianPath: await resolveProjectObsidianPath(payload.obsidianPath, title),
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
    const targetPath = resolveFsPath(project.obsidianPath) || await resolveProjectObsidianPath('', project.title);
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
