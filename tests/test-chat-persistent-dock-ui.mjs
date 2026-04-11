#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionListSourcePath = existsSync(join(repoRoot, 'frontend-src', 'session-list', 'ui.js'))
  ? join(repoRoot, 'frontend-src', 'session-list', 'ui.js')
  : join(repoRoot, 'static', 'frontend', 'session-list', 'ui.js');
const sessionListSource = readFileSync(sessionListSourcePath, 'utf8');

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
      if (depth === 0) return code.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function createClassList(host) {
  const values = new Set();
  function sync() {
    host.className = [...values].join(' ');
  }
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(token));
      sync();
    },
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(token));
      sync();
    },
    contains(token) {
      return values.has(token);
    },
  };
}

function createElement(tag = 'div') {
  const element = {
    tag,
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  element.classList = createClassList(element);
  return element;
}

const getSidebarPersistentKindSource = extractFunctionSource(sessionListSource, 'getSidebarPersistentKind');
const getPersistentDockGroupKeySource = extractFunctionSource(sessionListSource, 'getPersistentDockGroupKey');
const getSessionListModelSource = extractFunctionSource(sessionListSource, 'getSessionListModel');
const getActiveSidebarTabForListSource = extractFunctionSource(sessionListSource, 'getActiveSidebarTabForList');
const isLongTermProjectSessionForListSource = extractFunctionSource(sessionListSource, 'isLongTermProjectSessionForList');
const isLongTermLineSessionForListSource = extractFunctionSource(sessionListSource, 'isLongTermLineSessionForList');
const isSkillSessionForListSource = extractFunctionSource(sessionListSource, 'isSkillSessionForList');
const getShowLongTermSessionsInTasksTabSource = extractFunctionSource(sessionListSource, 'getShowLongTermSessionsInTasksTab');
const shouldIncludeSessionInSidebarTabSource = extractFunctionSource(sessionListSource, 'shouldIncludeSessionInSidebarTab');
const filterSessionsForSidebarTabSource = extractFunctionSource(sessionListSource, 'filterSessionsForSidebarTab');
const shouldShowSessionInSidebarForListSource = extractFunctionSource(sessionListSource, 'shouldShowSessionInSidebarForList');
const resetSessionListFooterSource = extractFunctionSource(sessionListSource, 'resetSessionListFooter');
const renderSessionListSource = extractFunctionSource(sessionListSource, 'renderSessionList');

const sessions = [
  {
    id: 'recommended-long-term',
    name: '写日记',
    group: '长期任务',
  },
  {
    id: 'persistent-long-term',
    name: '每日进食提醒',
    group: '长期任务',
    persistent: { kind: 'recurring_task' },
  },
  {
    id: 'maintenance-branch',
    name: '细化提醒文案',
    sessionState: {
      longTerm: {
        role: 'member',
        rootSessionId: 'persistent-long-term',
        rootTitle: '每日进食提醒',
        rootSummary: '长期维护提醒节奏与文案。',
      },
    },
  },
  {
    id: 'closed-branch',
    name: '已收束支线',
    taskCard: { lineRole: 'branch' },
    _branchStatus: 'merged',
  },
];

const routingContext = {
  console,
  sessionList: createElement('div'),
  sessionListFooter: createElement('div'),
  collapsedFolders: {},
  archivedSessionsLoading: false,
  archivedSessionsLoaded: true,
  archivedSessionCount: 0,
  activeTab: 'sessions',
  currentSessionId: 'maintenance-branch',
  sessions,
  localStorage: { setItem() {} },
  getSessionGroupingModeForList() {
    return 'user';
  },
  getSessionListGroupPriority() {
    return 0;
  },
  isUserTemplateFolderGroup() {
    return false;
  },
  payloadSafeTranslate(_key, fallback) {
    return fallback;
  },
  t(key) {
    return key === 'sidebar.pinned' ? '置顶' : key;
  },
  getVisiblePinnedSessions() {
    return [sessions[0]];
  },
  getVisibleActiveSessions() {
    return sessions;
  },
  getSessionFocusSectionData() {
    return {
      sessions: [],
      hintLabel: '',
    };
  },
  renderFocusSection() {
    return null;
  },
  getSessionGroupInfoForList(session) {
    return session?.id === 'maintenance-branch'
      ? { key: 'group:template:project-a', label: '项目 A', title: '项目 A', order: 1 }
      : { key: 'group:uncategorized', label: '未分类', title: '未分类', order: 999 };
  },
  getPersistentSidebarGroupInfo(groupKey) {
    return groupKey === 'group:long-term'
      ? { key: 'group:long-term', label: '长期任务', title: '长期任务', order: 90000 }
      : { key: 'group:quick-actions', label: 'AI快捷按钮', title: 'AI快捷按钮', order: 90001 };
  },
  isUserTemplateFolderGroup(groupKey) {
    return String(groupKey || '').startsWith('group:template:');
  },
  getVisibleArchivedSessions() {
    return [];
  },
  appendSessionItems(host, entries = []) {
    for (const session of entries) {
      const row = createElement('div');
      row.sessionId = session.id;
      host.appendChild(row);
    }
  },
  resetSessionListFooter() {
    routingContext.footerReset = true;
  },
  renderPersistentSessionDock(groups) {
    routingContext.capturedDockGroups = groups;
  },
  renderArchivedSection() {},
  renderUiIcon(name) {
    return `<svg data-icon="${name}"></svg>`;
  },
  esc(value) {
    return String(value || '');
  },
  document: {
    createElement,
  },
  window: {
    getActiveSidebarTab() {
      return routingContext.activeTab;
    },
    MelodySyncSessionListModel: {
      shouldShowSessionInSidebar(session) {
        return session?._branchStatus !== 'merged';
      },
    },
  },
};
routingContext.globalThis = routingContext;

vm.runInNewContext(`
  const LONG_TERM_BUCKET_DEFS = [
    { key: "long_term", label: "长期任务", order: 0 },
    { key: "short_term", label: "短期任务", order: 1 },
    { key: "waiting", label: "等待任务", order: 2 },
    { key: "inbox", label: "收集箱", order: 3 },
    { key: "skill", label: "快捷按钮", order: 4 },
  ];
  ${getSidebarPersistentKindSource}
  ${getPersistentDockGroupKeySource}
  ${getSessionListModelSource}
  ${getActiveSidebarTabForListSource}
  ${isLongTermProjectSessionForListSource}
  ${isLongTermLineSessionForListSource}
  ${isSkillSessionForListSource}
  let showLongTermSessionsInTasksTab = false;
  ${getShowLongTermSessionsInTasksTabSource}
  ${shouldIncludeSessionInSidebarTabSource}
  ${filterSessionsForSidebarTabSource}
  ${shouldShowSessionInSidebarForListSource}
  ${renderSessionListSource}
  globalThis.getPersistentDockGroupKey = getPersistentDockGroupKey;
  globalThis.renderSessionList = renderSessionList;
`, routingContext, {
  filename: 'frontend-src/session-list/ui.js',
});

assert.equal(
  routingContext.getPersistentDockGroupKey({ group: '长期任务' }),
  '',
  'ordinary sessions in the long-term group should stay in the main list',
);
assert.equal(
  routingContext.getPersistentDockGroupKey({ persistent: { kind: 'recurring_task' } }),
  'group:long-term',
  'persistent recurring sessions should route into the bottom dock',
);
assert.equal(
  routingContext.getPersistentDockGroupKey({ persistent: { kind: 'scheduled_task' } }),
  '',
  'scheduled tasks should stay in the main list instead of the bottom dock',
);
assert.equal(
  routingContext.getPersistentDockGroupKey({ persistent: { kind: 'waiting_task' } }),
  '',
  'waiting tasks should stay in the main list instead of the bottom dock',
);

routingContext.renderSessionList();

function collectRenderedSessionIds(host, output = []) {
  for (const child of host.children || []) {
    if (child?.sessionId) {
      output.push(child.sessionId);
    }
    collectRenderedSessionIds(child, output);
  }
  return output;
}

assert.equal(
  routingContext.sessionList.children.some((child) => child?.className === 'session-long-term-context'),
  false,
  'fallback sidebar rendering should no longer prepend long-term ownership context panels',
);
// Tasks tab (sessions) is now an aggregate view of long_term + short_term members across projects.
// Project roots are NOT shown in the tasks tab — only their members with the right buckets.
// 'maintenance-branch' has longTerm.role=member but no explicit bucket, infers 'inbox' from no kind.
// Since inbox is excluded from tasks tab, no sessions are rendered in this test fixture.
const renderedIds = collectRenderedSessionIds(routingContext.sessionList).sort();
assert.equal(
  renderedIds.includes('persistent-long-term'),
  false,
  'fallback sidebar rendering should NOT show project roots in the tasks tab (only their long/short members)',
);
assert.equal(
  Object.keys(routingContext.capturedDockGroups || {}).length,
  0,
  'fallback sidebar rendering should leave dock grouping to the dedicated dock renderer path',
);

const footerContext = {
  console,
  sessionListFooter: createElement('div'),
  document: { createElement },
};
footerContext.sessionListFooter.className = 'session-list-footer';
footerContext.sessionListFooter.hidden = false;
footerContext.sessionListFooter.innerHTML = 'legacy';
footerContext.globalThis = footerContext;

vm.runInNewContext(`
  ${resetSessionListFooterSource}
  globalThis.resetSessionListFooter = resetSessionListFooter;
`, footerContext, {
  filename: 'frontend-src/session-list/ui.js',
});

footerContext.resetSessionListFooter();

assert.equal(
  footerContext.sessionListFooter.className,
  'session-list-footer',
  'footer reset should preserve the base footer class so shared bottom positioning styles stay active',
);
assert.equal(
  footerContext.sessionListFooter.hidden,
  true,
  'footer reset should hide the now-unused dock container',
);
assert.equal(
  footerContext.sessionListFooter.innerHTML,
  '',
  'footer reset should clear any legacy dock markup',
);

console.log('test-chat-persistent-dock-ui: ok');
