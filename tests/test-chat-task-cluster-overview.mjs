#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'chat', 'session-surface-ui.js'), 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = code.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = code.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) { tokens.filter(Boolean).forEach((token) => values.add(token)); },
    remove(...tokens) { tokens.filter(Boolean).forEach((token) => values.delete(token)); },
    contains(token) { return values.has(token); },
    toArray() { return [...values]; },
  };
}

function makeElement(tag = 'div') {
  return {
    tag,
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    children: [],
    classList: makeClassList(),
    style: { setProperty() {} },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      if (index === -1) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
      return child;
    },
    addEventListener() {},
    querySelector() { return null; },
    setAttribute(name, value) { this[name] = value; },
  };
}

const createTaskClusterNodesSource = extractFunctionSource(source, 'createTaskClusterNodes');
const createCalls = [];

const context = {
  console,
  currentSessionId: '',
  expandedTaskClusters: {},
  document: {
    createElement(tag) {
      return makeElement(tag);
    },
  },
  esc(value) {
    return String(value || '');
  },
  dedupeBranchSessions(branches = []) {
    return [...branches];
  },
  buildBranchStatusCounts(branches = []) {
    return branches.reduce((counts, entry) => {
      const status = String(entry?._branchStatus || 'active').toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, { active: 0, parked: 0, resolved: 0, merged: 0 });
  },
  getBranchStatusValue(session) {
    return String(session?._branchStatus || 'active').toLowerCase();
  },
  getBranchLineageNames(rootSession, branchSession) {
    return [rootSession.name, branchSession._lineage || branchSession.name].filter(Boolean);
  },
  getBranchStatusLabel(session) {
    return `当前支线：${session.name}`;
  },
  buildBranchStatusSummary(counts) {
    const parts = [];
    if (counts.active > 0) parts.push(`进行中 ${counts.active}`);
    if (counts.parked > 0) parts.push(`已挂起 ${counts.parked}`);
    if (counts.resolved > 0) parts.push(`已关闭 ${counts.resolved}`);
    if (counts.merged > 0) parts.push(`已带回主线 ${counts.merged}`);
    return parts.join(' · ');
  },
  getTaskBranchDisplayName(session) {
    return session.name;
  },
  getSessionDisplayName(session) {
    return session.name;
  },
  renderTaskChevronIcon(expanded, className = '') {
    return `<span class="${className}">${expanded ? '▾' : '▸'}</span>`;
  },
  buildSessionMetaParts() {
    return [];
  },
  createActiveSessionItem(session, options = {}) {
    createCalls.push({ session, options });
    const item = makeElement('div');
    item.className = `session-item ${options.extraClassName || ''}`.trim();
    const metaNode = makeElement('div');
    const nameNode = makeElement('div');
    const infoNode = makeElement('div');
    infoNode.className = 'session-item-info';
    nameNode.textContent = session.name;
    item.querySelector = (selector) => {
      if (selector === '.session-item-info') return infoNode;
      if (selector === '.session-item-name') return nameNode;
      if (selector === '.session-item-meta') return metaNode;
      return null;
    };
    item.children.push(infoNode);
    if (typeof options.onMetaReady === 'function') {
      options.onMetaReady(metaNode, item);
    }
    return item;
  },
  toggleTaskClusterExpanded() {},
  attachSession() {},
  closeSidebarFn() {},
  isDesktop: true,
  window: { MelodySyncWorkbench: { setCurrentBranchStatus() {} } },
};
context.globalThis = context;
vm.runInNewContext(`${createTaskClusterNodesSource}\nglobalThis.createTaskClusterNodes = createTaskClusterNodes;`, context, {
  filename: 'static/chat/session-surface-ui.js',
});

const root = {
  id: 'main',
  name: '学习电影史',
  taskCard: {
    checkpoint: '先搭建电影史主线框架',
    nextSteps: ['先搭建电影史主线框架'],
  },
};

createCalls.length = 0;
const collapsedNodes = context.createTaskClusterNodes(root, [
  { id: 'b1', name: '表现主义', _branchStatus: 'parked', _lineage: '表现主义' },
  { id: 'b2', name: '黑色电影', _branchStatus: 'resolved', _lineage: '黑色电影' },
  { id: 'b3', name: '法国新浪潮', _branchStatus: 'merged', _lineage: '法国新浪潮' },
], {});
assert.doesNotMatch(createCalls[0].options.metaOverrideHtml, /主线任务/, 'collapsed task cluster should not repeat a main-task label in the sidebar tree');
assert.match(createCalls[0].options.metaOverrideHtml, /先搭建电影史主线框架/, 'collapsed task cluster should keep a single compact summary line');
assert.match(createCalls[0].options.metaOverrideHtml, /先搭建电影史主线框架/, 'collapsed task cluster should show the main task checkpoint when no branch is active');
assert.equal(collapsedNodes[0]?.children[0]?.className, 'task-cluster-expander', 'collapsed task cluster should expose a compact chevron expander');
assert.equal(collapsedNodes.length, 1, 'collapsed task cluster should not auto-render a sibling branch map panel');

createCalls.length = 0;
context.currentSessionId = 'b4';
context.expandedTaskClusters.main = true;
const expandedNodes = context.createTaskClusterNodes(root, [
  { id: 'b4', name: '表现主义', _branchStatus: 'active', _lineage: '表现主义', _branchDepth: 1, _branchParentSessionId: 'main' },
  { id: 'b5', name: '德国表现主义电影', _branchStatus: 'active', _lineage: '表现主义 / 德国表现主义电影', _branchDepth: 2, _branchParentSessionId: 'b4' },
  { id: 'b6', name: '法国新浪潮', _branchStatus: 'parked', _lineage: '法国新浪潮', _branchDepth: 1, _branchParentSessionId: 'main' },
], { currentBranchSessionId: 'b4' });
assert.equal(expandedNodes[0]?.classList.contains('is-expanded'), true, 'task cluster should expand only when the user explicitly opens it');
assert.match(createCalls[0].options.metaOverrideHtml, /表现主义/, 'expanded cluster summary should keep the current branch visible without extra prefix labels');
assert.match(createCalls[0].options.metaOverrideHtml, /表现主义/, 'expanded cluster summary should show the current branch name');
assert.equal(expandedNodes[0]?.children[0]?.className, 'task-cluster-expander is-expanded', 'expanded cluster should rotate the same chevron expander instead of using a text button');
assert.equal(expandedNodes[1]?.className, 'task-cluster-tree-card', 'expanded task cluster should render the branch tree as a sibling card');
assert.equal(expandedNodes[1]?.children[0]?.className, 'task-cluster-tree', 'expanded task cluster should switch into the nested task tree');
assert.equal(expandedNodes[1]?.children[0]?.children[0]?.className, 'task-cluster-tree-item depth-1', 'expanded branch card should render tree items instead of horizontal mind-map rows');
assert.equal(createCalls[1].session.id, 'b4', 'expanded list should keep the first created root branch first');
assert.match(createCalls[1].options.metaOverrideHtml, /task-branch-dot is-active/, 'current task row should expose an active-status dot instead of a text label');
assert.equal(createCalls[2].session.id, 'b5', 'expanded list should keep nested children under the same parent in fixed order');
assert.match(createCalls[2].options.metaOverrideHtml, /task-branch-dot is-active/, 'follow-up active tasks should use the same active-status dot treatment');
assert.equal(createCalls[3].session.id, 'b6', 'expanded list should place later sibling branches after earlier ones without promoting the current branch');
assert.match(createCalls[3].options.metaOverrideHtml, /task-branch-dot is-parked/, 'non-active tasks should use a status dot instead of a text badge');

createCalls.length = 0;
context.currentSessionId = 'b6';
const stableOrderNodes = context.createTaskClusterNodes(root, [
  { id: 'b4', name: '表现主义', _branchStatus: 'parked', _lineage: '表现主义', _branchDepth: 1, _branchParentSessionId: 'main' },
  { id: 'b5', name: '德国表现主义电影', _branchStatus: 'parked', _lineage: '表现主义 / 德国表现主义电影', _branchDepth: 2, _branchParentSessionId: 'b4' },
  { id: 'b6', name: '法国新浪潮', _branchStatus: 'active', _lineage: '法国新浪潮', _branchDepth: 1, _branchParentSessionId: 'main' },
], { currentBranchSessionId: 'b6' });
assert.equal(stableOrderNodes[1]?.className, 'task-cluster-tree-card', 'switching branches should keep the same tree container');
assert.deepEqual(
  createCalls.slice(1).map((entry) => entry.session.id),
  ['b4', 'b5', 'b6'],
  'switching to another branch should not reshuffle the fixed sidebar branch order',
);

const noBranchNodes = context.createTaskClusterNodes(root, [], {});
assert.equal(
  noBranchNodes[0]?.children[0]?.className,
  'task-cluster-expander task-cluster-expander-placeholder',
  'root task rows should reserve the expander slot even before the first branch is created',
);

console.log('test-chat-task-cluster-overview: ok');
