#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionSurfaceSource = readFileSync(join(repoRoot, 'static', 'frontend', 'session/surface-ui.js'), 'utf8');
const sessionListSource = readFileSync(join(repoRoot, 'static', 'frontend', 'session-list', 'ui.js'), 'utf8');

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
const getDoneWorkflowStatusInfoSource = extractFunctionSource(sessionSurfaceSource, 'getDoneWorkflowStatusInfo');
const getSessionListTouchStatusInfoSource = extractFunctionSource(sessionSurfaceSource, 'getSessionListTouchStatusInfo');
const getSessionListModelSource = extractFunctionSource(sessionListSource, 'getSessionListModel');
const shouldShowSessionInSidebarForListSource = extractFunctionSource(sessionListSource, 'shouldShowSessionInSidebarForList');
const renderArchivedSectionSource = extractFunctionSource(sessionListSource, 'renderArchivedSection');

const actionContext = {
  t(key) {
    return {
      'action.archive': 'Archive',
      'action.restore': 'Restore',
      'action.delete': 'Delete',
      'action.acknowledge': 'Acknowledge',
      'action.pin': 'Pin',
      'action.unpin': 'Unpin',
    }[key] || key;
  },
  getSessionReviewStatusInfo() {
    return null;
  },
  markSessionReviewed() {},
};
actionContext.globalThis = actionContext;

vm.runInNewContext(`
  ${buildSessionActionConfigsSource}
  globalThis.buildSessionActionConfigs = buildSessionActionConfigs;
`, actionContext, {
  filename: 'static/frontend/session/surface-ui.js',
});

assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'active-task' }).map((entry) => entry.action).join(','),
  'pin,archive',
  'active tasks should expose pin and archive as the default sidebar actions',
);
assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'active-task-pinned', pinned: true }).map((entry) => entry.action).join(','),
  'unpin,archive',
  'pinned tasks should expose an unpin action in place of pin',
);
assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'archived-task', archived: true }).map((entry) => entry.action).join(','),
  'unarchive,delete',
  'archived tasks should expose restore and delete actions inside the archived folder',
);
actionContext.getSessionReviewStatusInfo = () => ({ label: "Unread" });
assert.equal(
  actionContext.buildSessionActionConfigs({ id: 'active-task-unread' }).map((entry) => entry.action).join(','),
  'pin,archive,acknowledge',
  'active tasks with unread updates should append acknowledge without disturbing the primary pin/archive action order',
);

const statusContext = {
  t(key) {
    return {
      'status.running': 'Running',
      'workflow.status.done': 'Completed',
      'workflow.status.doneTitle': 'Current task completed',
      'workflow.status.finished': 'Completed',
      'workflow.status.finishedTitle': 'Completed since last view',
    }[key] || key;
  },
  getSessionStatusSummary(session) {
    return { primary: session?.summaryStatus || null };
  },
  window: {
    MelodySyncSessionStateModel: {
      isSessionBusy(session) {
        return session?.busy === true;
      },
      getWorkflowStatusInfo(value) {
        return value === 'done'
          ? {
              key: 'done',
              label: 'Completed',
              className: 'status-done',
              itemClass: 'is-done-session',
              title: 'Current task completed',
            }
          : null;
      },
      getSessionReviewStatusInfo(session) {
        return session?.reviewed === true
          ? {
              key: 'unread',
              label: 'Updated',
              className: 'status-unread',
              title: 'Updated since last view',
            }
          : null;
      },
    },
  },
};
statusContext.globalThis = statusContext;
vm.runInNewContext(`
  ${getDoneWorkflowStatusInfoSource}
  ${getSessionListTouchStatusInfoSource}
  globalThis.getDoneWorkflowStatusInfo = getDoneWorkflowStatusInfo;
  globalThis.getSessionListTouchStatusInfo = getSessionListTouchStatusInfo;
`, statusContext, {
  filename: 'static/frontend/session/surface-ui.js',
});
assert.equal(
  JSON.stringify(statusContext.getSessionListTouchStatusInfo({
    busy: true,
    summaryStatus: { title: 'Queued follow-ups' },
  })),
  JSON.stringify({
    key: 'running',
    label: 'Running',
    className: 'status-running',
    title: 'Queued follow-ups',
  }),
  'busy tasks should collapse to a single running list state',
);
assert.equal(
  JSON.stringify(statusContext.getSessionListTouchStatusInfo({ reviewed: true, workflowState: 'done' })),
  JSON.stringify({
    key: 'done',
    label: 'Completed',
    className: 'status-done',
    itemClass: 'is-done-session',
    title: 'Completed since last view',
  }),
  'review-pending completed tasks should keep the completed state and highlight class in sync',
);
assert.equal(
  JSON.stringify(statusContext.getSessionListTouchStatusInfo({ reviewed: true, workflowState: 'waiting_user' })),
  JSON.stringify({
    key: 'finished',
    label: 'Completed',
    className: 'status-done',
    itemClass: 'is-done-session',
    title: 'Completed since last view',
  }),
  'review-pending idle tasks should still surface the completed sidebar emphasis even when workflowState is missing',
);
assert.equal(
  statusContext.getSessionListTouchStatusInfo({}),
  null,
  'ordinary tasks should render with no extra list-state badge',
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
  window: {
    MelodySyncSessionListModel: {
      shouldShowSessionInSidebar() {
        return true;
      },
    },
  },
};
renderContext.globalThis = renderContext;
renderContext.appendSessionItems = (host, entries = [], options = {}) => {
  for (const session of entries) {
    if (!session?.id) continue;
    const extraClassNames = [];
    if (options.archived) extraClassNames.push('archived-item');
    if (renderContext.isBranchTaskSession(session)) {
      extraClassNames.push(options.archived ? 'is-archived-branch' : 'is-branch-session');
    }
    host.appendChild(renderContext.createActiveSessionItem(session, {
      ...options,
      extraClassName: extraClassNames.join(' '),
    }));
  }
};

vm.runInNewContext(`
  ${getSessionListModelSource}
  ${shouldShowSessionInSidebarForListSource}
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, renderContext, {
  filename: 'static/frontend/session-list/ui.js',
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
  window: {
    MelodySyncSessionListModel: {
      shouldShowSessionInSidebar() {
        return true;
      },
    },
  },
};
loadingContext.globalThis = loadingContext;
loadingContext.appendSessionItems = () => {
  throw new Error('appendSessionItems should not run while archived items are still loading');
};

vm.runInNewContext(`
  ${getSessionListModelSource}
  ${shouldShowSessionInSidebarForListSource}
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, loadingContext, {
  filename: 'static/frontend/session-list/ui.js',
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
  window: {
    MelodySyncSessionListModel: {
      shouldShowSessionInSidebar() {
        return true;
      },
    },
  },
};
emptyContext.globalThis = emptyContext;
emptyContext.appendSessionItems = () => {
  throw new Error('appendSessionItems should not run when there are no archived tasks');
};

vm.runInNewContext(`
  ${getSessionListModelSource}
  ${shouldShowSessionInSidebarForListSource}
  ${renderArchivedSectionSource}
  globalThis.renderArchivedSection = renderArchivedSection;
`, emptyContext, {
  filename: 'static/frontend/session-list/ui.js',
});

emptyContext.renderArchivedSection();

assert.equal(
  emptyContext.sessionList.children.length,
  0,
  'archived folder should stay hidden when there are no archived tasks',
);

console.log('test-chat-archive-folder-ui: ok');
