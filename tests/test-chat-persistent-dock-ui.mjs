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
const shouldShowSessionInSidebarForListSource = extractFunctionSource(sessionListSource, 'shouldShowSessionInSidebarForList');
const resetSessionListFooterSource = extractFunctionSource(sessionListSource, 'resetSessionListFooter');
const renderSessionListSource = extractFunctionSource(sessionListSource, 'renderSessionList');

const routingContext = {
  console,
  sessionList: createElement('div'),
  sessionListFooter: createElement('div'),
  collapsedFolders: {},
  archivedSessionsLoading: false,
  archivedSessionsLoaded: true,
  archivedSessionCount: 0,
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
  getVisiblePinnedSessions() {
    return [];
  },
  getVisibleActiveSessions() {
    return [
      { id: 'recommended-long-term', name: '写日记', group: '长期任务' },
      { id: 'persistent-long-term', name: '每日进食提醒', group: '长期任务', persistent: { kind: 'recurring_task' } },
      { id: 'closed-branch', name: '已收束支线', taskCard: { lineRole: 'branch' }, _branchStatus: 'merged' },
    ];
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
    return session.group === '长期任务'
      ? { key: 'group:long-term', label: '长期任务', title: '长期任务', order: 99998 }
      : { key: 'group:inbox', label: '收集箱', title: '收集箱', order: 0 };
  },
  getPersistentSidebarGroupInfo(groupKey) {
    return groupKey === 'group:long-term'
      ? { key: 'group:long-term', label: '长期任务', title: '长期任务', order: 90000 }
      : { key: 'group:quick-actions', label: 'AI快捷按钮', title: 'AI快捷按钮', order: 90001 };
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
    MelodySyncSessionListModel: {
      shouldShowSessionInSidebar(session) {
        return session?._branchStatus !== 'merged';
      },
    },
  },
};
routingContext.globalThis = routingContext;

vm.runInNewContext(`
  ${getSidebarPersistentKindSource}
  ${getPersistentDockGroupKeySource}
  ${getSessionListModelSource}
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

routingContext.renderSessionList();

assert.equal(
  routingContext.sessionList.children.length,
  2,
  'fallback sidebar rendering should keep both ordinary and persistent sessions visible when the React dock renderer is absent',
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
