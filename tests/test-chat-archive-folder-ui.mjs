#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionSurfaceSource = readFileSync(join(repoRoot, 'static', 'chat', 'session-surface-ui.js'), 'utf8');
const sessionListSource = readFileSync(join(repoRoot, 'static', 'chat', 'session-list-ui.js'), 'utf8');

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

function createFakeDocument() {
  const byId = new Map();

  function makeElement(tag = 'div') {
    return {
      tag,
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      children: [],
      parentNode: null,
      listeners: {},
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      remove() {
        if (this.parentNode) {
          const index = this.parentNode.children.indexOf(this);
          if (index >= 0) this.parentNode.children.splice(index, 1);
        }
        if (this.id) byId.delete(this.id);
      },
    };
  }

  return {
    byId,
    createElement: makeElement,
    getElementById(id) {
      return byId.get(id) || null;
    },
  };
}

const buildSessionActionConfigsSource = extractFunctionSource(sessionSurfaceSource, 'buildSessionActionConfigs');
const renderArchivedSectionSource = extractFunctionSource(sessionListSource, 'renderArchivedSection');

const actionContext = {
  t(key) {
    return {
      'action.organize': 'Organize',
      'action.archive': 'Archive',
      'action.restore': 'Restore',
      'action.delete': 'Delete',
    }[key] || key;
  },
};
actionContext.globalThis = actionContext;

vm.runInNewContext(`
  ${buildSessionActionConfigsSource}
  globalThis.buildSessionActionConfigs = buildSessionActionConfigs;
`, actionContext, {
  filename: 'static/chat/session-surface-ui.js',
});

assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'active-task' }).map((entry) => entry.action).join(','),
  'organize,archive',
  'active tasks should expose organize and archive as the default sidebar actions',
);
assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'archived-task', archived: true }).map((entry) => entry.action).join(','),
  'unarchive,delete',
  'archived tasks should expose restore and delete actions inside the archived folder',
);

const renderDocument = createFakeDocument();
const createdRows = [];
const renderContext = {
  document: renderDocument,
  sessionList: renderDocument.createElement('div'),
  collapsedFolders: {},
  archivedSessionsLoading: false,
  archivedSessionsLoaded: true,
  archivedSessionCount: 2,
  COLLAPSED_GROUPS_STORAGE_KEY: 'collapsedSessionGroups',
  localStorage: { setItem() {} },
  console,
  t(key) {
    return {
      'sidebar.archive': 'Archived',
      'sidebar.loadingArchived': 'Loading archived tasks…',
      'sidebar.noArchived': 'No archived tasks',
    }[key] || key;
  },
  esc(value) {
    return String(value || '');
  },
  renderUiIcon(name) {
    return `<svg data-icon="${name}"></svg>`;
  },
  getVisibleArchivedSessions() {
    return [
      { id: 'archived-main', archived: true, name: 'Main task' },
      { id: 'archived-branch', archived: true, name: 'Branch task', sourceContext: { parentSessionId: 'archived-main' } },
    ];
  },
  getFilteredSessionEmptyText() {
    return 'No archived tasks';
  },
  isBranchTaskSession(session) {
    return Boolean(session?.sourceContext?.parentSessionId);
  },
  createActiveSessionItem(session, options = {}) {
    const row = renderDocument.createElement('div');
    row.sessionId = session.id;
    row.className = `session-item ${options.extraClassName || ''}`.trim();
    createdRows.push({ session, options, row });
    return row;
  },
  fetchArchivedSessions() {
    throw new Error('fetchArchivedSessions should not be called when archived sessions are already loaded');
  },
};
renderContext.globalThis = renderContext;

vm.runInNewContext(`
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, renderContext, {
  filename: 'static/chat/session-list-ui.js',
});

renderContext.renderArchivedSection();

assert.equal(renderContext.sessionList.children.length, 1, 'sidebar should render a dedicated archived folder section');
const archivedSection = renderContext.sessionList.children[0];
assert.equal(archivedSection.id, 'archivedSection', 'archived folder should keep a stable section id');
assert.match(archivedSection.children[0]?.innerHTML || '', /Archived/, 'archived folder header should use the archived label');
assert.match(archivedSection.children[0]?.innerHTML || '', />2</, 'archived folder header should show the archived task count');
assert.equal(archivedSection.children[1]?.children.length, 2, 'archived folder should render archived tasks as rows');
assert.match(createdRows[1]?.options?.extraClassName || '', /is-archived-branch/, 'archived branch tasks should stay visually nested inside the archived folder');

const loadingDocument = createFakeDocument();
let loadingFetchCalls = 0;
const loadingContext = {
  document: loadingDocument,
  sessionList: loadingDocument.createElement('div'),
  collapsedFolders: {},
  archivedSessionsLoading: true,
  archivedSessionsLoaded: false,
  archivedSessionCount: 2,
  COLLAPSED_GROUPS_STORAGE_KEY: 'collapsedSessionGroups',
  localStorage: { setItem() {} },
  console,
  t: renderContext.t,
  esc: renderContext.esc,
  renderUiIcon: renderContext.renderUiIcon,
  getVisibleArchivedSessions() {
    return [];
  },
  getFilteredSessionEmptyText() {
    return 'No archived tasks';
  },
  isBranchTaskSession() {
    return false;
  },
  createActiveSessionItem() {
    throw new Error('createActiveSessionItem should not run while archived items are still loading');
  },
  fetchArchivedSessions() {
    loadingFetchCalls += 1;
    return Promise.resolve([]);
  },
};
loadingContext.globalThis = loadingContext;

vm.runInNewContext(`
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, loadingContext, {
  filename: 'static/chat/session-list-ui.js',
});

loadingContext.renderArchivedSection();

assert.equal(
  loadingFetchCalls,
  0,
  'archived folder should not recursively refetch while an archived-session load is already in flight',
);

const emptyDocument = createFakeDocument();
const emptyContext = {
  document: emptyDocument,
  sessionList: emptyDocument.createElement('div'),
  collapsedFolders: {},
  archivedSessionsLoading: false,
  archivedSessionsLoaded: true,
  archivedSessionCount: 0,
  COLLAPSED_GROUPS_STORAGE_KEY: 'collapsedSessionGroups',
  localStorage: { setItem() {} },
  console,
  t: renderContext.t,
  esc: renderContext.esc,
  renderUiIcon: renderContext.renderUiIcon,
  getVisibleArchivedSessions() {
    return [];
  },
  getFilteredSessionEmptyText() {
    return 'No archived tasks';
  },
  isBranchTaskSession() {
    return false;
  },
  createActiveSessionItem() {
    throw new Error('createActiveSessionItem should not run when there are no archived tasks');
  },
  fetchArchivedSessions() {
    throw new Error('fetchArchivedSessions should not run when there are no archived tasks');
  },
};
emptyContext.globalThis = emptyContext;

vm.runInNewContext(`
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, emptyContext, {
  filename: 'static/chat/session-list-ui.js',
});

emptyContext.renderArchivedSection();

assert.equal(
  emptyContext.sessionList.children.length,
  0,
  'archived folder should stay hidden when there are no archived tasks',
);

console.log('test-chat-archive-folder-ui: ok');
