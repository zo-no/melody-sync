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
    addEventListener() {},
    querySelector() { return null; },
  };
}

const createTaskClusterItemSource = extractFunctionSource(source, 'createTaskClusterItem');
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
  buildSessionMetaParts() {
    return [];
  },
  createActiveSessionItem(session, options = {}) {
    createCalls.push({ session, options });
    const item = makeElement('div');
    item.className = `session-item ${options.extraClassName || ''}`.trim();
    const metaNode = makeElement('div');
    const nameNode = makeElement('div');
    nameNode.textContent = session.name;
    item.querySelector = (selector) => {
      if (selector === '.session-item-name') return nameNode;
      if (selector === '.session-item-meta') return metaNode;
      return null;
    };
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
vm.runInNewContext(`${createTaskClusterItemSource}\nglobalThis.createTaskClusterItem = createTaskClusterItem;`, context, {
  filename: 'static/chat/session-surface-ui.js',
});

const root = { id: 'main', name: '学习电影史' };

createCalls.length = 0;
const collapsedWrapper = context.createTaskClusterItem(root, [
  { id: 'b1', name: '表现主义', _branchStatus: 'parked', _lineage: '表现主义' },
  { id: 'b2', name: '黑色电影', _branchStatus: 'resolved', _lineage: '黑色电影' },
  { id: 'b3', name: '法国新浪潮', _branchStatus: 'merged', _lineage: '法国新浪潮' },
], {});
assert.match(createCalls[0].options.metaOverrideHtml, /已挂起 1/, 'collapsed task cluster should summarize parked branches');
assert.match(createCalls[0].options.metaOverrideHtml, /已关闭 1/, 'collapsed task cluster should summarize resolved branches');
assert.match(createCalls[0].options.metaOverrideHtml, /已带回主线 1/, 'collapsed task cluster should summarize merged branches');
assert.match(createCalls[0].options.metaOverrideHtml, /展开 3 个子任务/, 'collapsed task cluster should expose the expand action');
assert.equal(collapsedWrapper.children[1]?.className, 'task-cluster-overview', 'collapsed task cluster should render an overview board');
assert.equal(collapsedWrapper.children[1]?.children.length, 3, 'overview board should show one row per non-empty lifecycle state');
assert.match(collapsedWrapper.children[1]?.children[0]?.innerHTML || '', /已挂起/, 'overview rows should label lifecycle state');

createCalls.length = 0;
context.currentSessionId = 'b4';
const expandedWrapper = context.createTaskClusterItem(root, [
  { id: 'b4', name: '表现主义', _branchStatus: 'active', _lineage: '表现主义', _branchDepth: 1 },
  { id: 'b5', name: '德国表现主义电影', _branchStatus: 'active', _lineage: '表现主义 / 德国表现主义电影', _branchDepth: 2 },
  { id: 'b6', name: '法国新浪潮', _branchStatus: 'parked', _lineage: '法国新浪潮', _branchDepth: 1 },
], { currentBranchSessionId: 'b4' });
assert.equal(expandedWrapper.classList.contains('is-expanded'), true, 'task cluster should auto-expand when the current branch is active and nested');
assert.match(createCalls[0].options.metaOverrideHtml, /当前子任务链：表现主义/, 'expanded cluster summary should keep the current branch chain visible');
assert.match(createCalls[0].options.metaOverrideHtml, /收起子任务/, 'expanded cluster summary should switch the toggle label');
assert.equal(expandedWrapper.children[1]?.className, 'task-cluster-branches', 'expanded task cluster should render grouped branch sections');
assert.equal(expandedWrapper.children[1]?.children[0]?.children[0]?.textContent, '进行中的子任务 · 2', 'expanded task cluster should group active branches together');
assert.equal(expandedWrapper.children[1]?.children[1]?.children[0]?.textContent, '已挂起 · 1', 'expanded task cluster should group parked branches separately');

console.log('test-chat-task-cluster-overview: ok');
