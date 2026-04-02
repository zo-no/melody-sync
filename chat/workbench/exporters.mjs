import { homedir } from 'os';
import { join, resolve } from 'path';
import { CONFIG_DIR } from '../../lib/config.mjs';
import {
  dedupeTexts,
  normalizeLineRole,
  normalizeNodeState,
  normalizeNodeType,
  normalizeNullableText,
  trimText,
} from './shared.mjs';

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

export function resolveFsPath(value) {
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

export async function resolveDefaultObsidianBaseDir(pathExists) {
  if (typeof pathExists === 'function' && await pathExists(LOCAL_OBSIDIAN_PROJECT_DIR)) {
    return LOCAL_OBSIDIAN_PROJECT_DIR;
  }
  return join(CONFIG_DIR, 'obsidian-export');
}

export async function resolveProjectObsidianPath(input, title, { pathExists } = {}) {
  const explicit = resolveFsPath(input);
  if (explicit) return explicit;
  const baseDir = await resolveDefaultObsidianBaseDir(pathExists);
  return join(baseDir, slugify(title));
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

export function buildProjectSummaryMarkdown(project, nodes, branchContexts) {
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

export function buildProjectTreeMarkdown(project, nodes, branchContexts) {
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

export function buildSkillsMarkdown(project, skills) {
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

export function buildSingleProjectDocument(project, treeMarkdown, summaryMarkdown, skillsMarkdown) {
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

export function buildBranchSeedPrompt({ project, node, goal, carryover = null }) {
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
