import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { extname, join, resolve } from 'path';
import {
  CONFIG_DIR,
  WORKBENCH_BRANCH_CONTEXTS_FILE,
  WORKBENCH_CAPTURE_ITEMS_FILE,
  WORKBENCH_NODES_FILE,
  WORKBENCH_PROJECTS_FILE,
  WORKBENCH_SKILLS_FILE,
  WORKBENCH_SUMMARIES_FILE,
} from '../lib/config.mjs';
import {
  createSession,
  getSession,
  submitHttpMessage,
} from './session-manager.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  pathExists,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-utils.mjs';

const WORKBENCH_QUEUE = createSerialTaskQueue();
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

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value) {
  const trimmed = trimText(value);
  return trimmed || '';
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

function sortByCreatedAsc(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a?.createdAt || a?.created || '') || 0;
    const right = Date.parse(b?.createdAt || b?.created || '') || 0;
    return left - right;
  });
}

function sortByUpdatedDesc(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a?.updatedAt || a?.createdAt || a?.created || '') || 0;
    const right = Date.parse(b?.updatedAt || b?.createdAt || b?.created || '') || 0;
    return right - left;
  });
}

async function loadArrayStore(filePath) {
  const data = await readJson(filePath, []);
  return Array.isArray(data) ? data : [];
}

async function loadState() {
  const [captureItems, projects, nodes, branchContexts, skills, summaries] = await Promise.all([
    loadArrayStore(WORKBENCH_CAPTURE_ITEMS_FILE),
    loadArrayStore(WORKBENCH_PROJECTS_FILE),
    loadArrayStore(WORKBENCH_NODES_FILE),
    loadArrayStore(WORKBENCH_BRANCH_CONTEXTS_FILE),
    loadArrayStore(WORKBENCH_SKILLS_FILE),
    loadArrayStore(WORKBENCH_SUMMARIES_FILE),
  ]);
  return {
    captureItems,
    projects,
    nodes,
    branchContexts,
    skills,
    summaries,
  };
}

async function saveState(state) {
  await Promise.all([
    writeJsonAtomic(WORKBENCH_CAPTURE_ITEMS_FILE, state.captureItems || []),
    writeJsonAtomic(WORKBENCH_PROJECTS_FILE, state.projects || []),
    writeJsonAtomic(WORKBENCH_NODES_FILE, state.nodes || []),
    writeJsonAtomic(WORKBENCH_BRANCH_CONTEXTS_FILE, state.branchContexts || []),
    writeJsonAtomic(WORKBENCH_SKILLS_FILE, state.skills || []),
    writeJsonAtomic(WORKBENCH_SUMMARIES_FILE, state.summaries || []),
  ]);
}

function buildSnapshot(state) {
  return {
    captureItems: sortByUpdatedDesc(state.captureItems || []),
    projects: sortByUpdatedDesc(state.projects || []),
    nodes: sortByCreatedAsc(state.nodes || []),
    branchContexts: sortByUpdatedDesc(state.branchContexts || []),
    skills: sortByUpdatedDesc(state.skills || []),
    summaries: sortByUpdatedDesc(state.summaries || []),
  };
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

function buildTreeLines(nodes, branchContexts) {
  const childrenByParent = new Map();
  const branchesByNode = new Map();
  for (const node of nodes) {
    const key = trimText(node.parentId) || '__root__';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(node);
  }
  for (const context of branchContexts) {
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
  const recentBranches = branchContexts.slice(0, 6);

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

function buildBranchSeedPrompt({ project, node, goal }) {
  return [
    'Continue this branch based on the existing project node context.',
    '',
    `Project: ${project.title}`,
    `Node: ${node.title}`,
    `Node type: ${normalizeNodeType(node.type)}`,
    goal ? `Branch goal: ${goal}` : 'Branch goal: Continue exploring this node without losing the main line.',
    trimText(node.summary) ? `Node summary: ${node.summary}` : '',
    trimText(node.nextAction) ? `Suggested next action: ${node.nextAction}` : '',
    '',
    'Start by restating the branch objective, then propose the next concrete step.',
  ].filter(Boolean).join('\n');
}

export async function getWorkbenchSnapshot() {
  const state = await loadState();
  return buildSnapshot(state);
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
    const sourceSession = await getSession(sourceSessionId);
    if (!sourceSession) {
      throw new Error('Source session not found');
    }
    const goal = normalizeNullableText(payload.goal) || `Continue node: ${node.title}`;
    const branchSession = await createSession(
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
      nodeId: node.id,
      sessionId: branchSession.id,
      goal,
      returnToNodeId: normalizeNullableText(payload.returnToNodeId) || node.id,
      checkpointSummary: normalizeNullableText(payload.checkpointSummary) || node.summary || '',
      createdAt: now,
      updatedAt: now,
    };
    state.branchContexts.push(branchContext);
    await saveState(state);

    if (payload.seedMessage !== false) {
      await submitHttpMessage(branchSession.id, buildBranchSeedPrompt({ project, node, goal }), [], {
        requestId: createId('branch_seed'),
        ...(sourceSession.model ? { model: sourceSession.model } : {}),
        ...(sourceSession.effort ? { effort: sourceSession.effort } : {}),
        ...(sourceSession.thinking === true ? { thinking: true } : {}),
      });
    }

    return {
      session: await getSession(branchSession.id) || branchSession,
      branchContext,
    };
  });
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
