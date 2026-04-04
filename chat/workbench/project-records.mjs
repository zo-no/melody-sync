import { extname, join } from 'path';
import {
  buildProjectSummaryMarkdown,
  buildProjectTreeMarkdown,
  buildSingleProjectDocument,
  buildSkillsMarkdown,
  resolveFsPath,
  resolveProjectObsidianPath,
} from './exporters.mjs';
import {
  createWorkbenchId,
  deriveCaptureTitle,
  normalizeNodeState,
  normalizeNodeType,
  normalizeNullableText,
  nowIso,
  sortByCreatedAsc,
  sortByUpdatedDesc,
} from './shared.mjs';

export function getProjectById(state, projectId) {
  return (state.projects || []).find((entry) => entry.id === projectId) || null;
}

export function getNodeById(state, nodeId) {
  return (state.nodes || []).find((entry) => entry.id === nodeId) || null;
}

export function getSummaryById(state, summaryId) {
  return (state.summaries || []).find((entry) => entry.id === summaryId) || null;
}

export function getProjectNodes(state, projectId) {
  return sortByCreatedAsc((state.nodes || []).filter((entry) => entry.projectId === projectId));
}

export function getProjectBranchContexts(state, projectId) {
  const projectNodeIds = new Set(getProjectNodes(state, projectId).map((entry) => entry.id));
  return sortByUpdatedDesc((state.branchContexts || []).filter((entry) => projectNodeIds.has(entry.nodeId)));
}

export function getProjectSkills(state, projectId) {
  const projectNodeIds = new Set(getProjectNodes(state, projectId).map((entry) => entry.id));
  return sortByUpdatedDesc((state.skills || []).filter((entry) => {
    const evidence = Array.isArray(entry?.evidenceNodeIds) ? entry.evidenceNodeIds : [];
    return evidence.some((nodeId) => projectNodeIds.has(nodeId));
  }));
}

export function getProjectByScopeKey(state, scopeKey) {
  const normalized = normalizeNullableText(scopeKey);
  if (!normalized) return null;
  return (state.projects || []).find((entry) => normalizeNullableText(entry.scopeKey) === normalized) || null;
}

export async function createCaptureItemRecord(deps, payload = {}) {
  return deps.queue(async () => {
    const text = normalizeNullableText(payload.text);
    if (!text) {
      throw new Error('text is required');
    }
    const now = nowIso();
    const state = await deps.loadState();
    const captureItem = {
      id: createWorkbenchId('cap'),
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
    await deps.saveState(state);
    return captureItem;
  });
}

export async function createProjectRecord(deps, payload = {}) {
  return deps.queue(async () => {
    const title = normalizeNullableText(payload.title);
    if (!title) {
      throw new Error('title is required');
    }
    const now = nowIso();
    const state = await deps.loadState();
    const project = {
      id: createWorkbenchId('proj'),
      title,
      brief: normalizeNullableText(payload.brief),
      obsidianPath: await resolveProjectObsidianPath(payload.obsidianPath || await deps.getDefaultObsidianPath(), title, { pathExists: deps.pathExists }),
      status: normalizeNullableText(payload.status) || 'active',
      rootNodeId: '',
      createdAt: now,
      updatedAt: now,
    };
    state.projects.push(project);
    await deps.saveState(state);
    return project;
  });
}

export async function createNodeRecord(deps, payload = {}) {
  return deps.queue(async () => {
    const projectId = normalizeNullableText(payload.projectId);
    const title = normalizeNullableText(payload.title);
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!title) {
      throw new Error('title is required');
    }
    const state = await deps.loadState();
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
      id: createWorkbenchId('node'),
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
    await deps.saveState(state);
    return node;
  });
}

export async function promoteCaptureItemRecord(deps, captureId, payload = {}) {
  return deps.queue(async () => {
    const state = await deps.loadState();
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
      id: createWorkbenchId('node'),
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
    await deps.saveState(state);
    return {
      captureItem: state.captureItems[captureIndex],
      node,
    };
  });
}

export async function createProjectSummaryRecord(deps, projectId) {
  return deps.queue(async () => {
    const state = await deps.loadState();
    const project = getProjectById(state, projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const nodes = getProjectNodes(state, projectId);
    const branchContexts = getProjectBranchContexts(state, projectId);
    const markdown = buildProjectSummaryMarkdown(project, nodes, branchContexts);
    const now = nowIso();
    const summary = {
      id: createWorkbenchId('summary'),
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
    await deps.saveState(state);
    return summary;
  });
}

export async function writeProjectRecordToObsidian(deps, projectId, payload = {}) {
  return deps.queue(async () => {
    const state = await deps.loadState();
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
        id: createWorkbenchId('summary'),
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
    const targetPath = resolveFsPath(project.obsidianPath)
      || await resolveProjectObsidianPath(await deps.getDefaultObsidianPath(), project.title, { pathExists: deps.pathExists });
    const writtenFiles = [];

    if (extname(targetPath).toLowerCase() === '.md') {
      const document = buildSingleProjectDocument(project, treeMarkdown, summaryMarkdown, skillsMarkdown);
      await deps.writeTextAtomic(targetPath, document);
      writtenFiles.push(targetPath);
    } else {
      await deps.ensureDir(targetPath);
      const treePath = join(targetPath, 'TREE.md');
      const summaryPath = join(targetPath, 'SUMMARY.md');
      const skillsPath = join(targetPath, 'SKILLS.md');
      await Promise.all([
        deps.writeTextAtomic(treePath, treeMarkdown),
        deps.writeTextAtomic(summaryPath, summaryMarkdown),
        deps.writeTextAtomic(skillsPath, skillsMarkdown),
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
    await deps.saveState(state);

    return {
      project: getProjectById(state, projectId),
      summary,
      targetPath,
      writtenFiles,
    };
  });
}
