#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
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
const renderPersistentSessionDockSource = extractFunctionSource(sessionListSource, 'renderPersistentSessionDock');
const renderSessionListSource = extractFunctionSource(sessionListSource, 'renderSessionList');

const routingContext = {
  console,
  sessionList: createElement('div'),
  sessionListFooter: createElement('div'),
  collapsedFolders: {},
  localStorage: { setItem() {} },
  getVisiblePinnedSessions() {
    return [];
  },
  getVisibleActiveSessions() {
    return [
      { id: 'recommended-long-term', name: '写日记', group: '长期任务' },
      { id: 'persistent-long-term', name: '每日进食提醒', group: '长期任务', persistent: { kind: 'recurring_task' } },
    ];
  },
  getSessionGroupInfoForList(session) {
    return session.group === '长期任务'
      ? { key: 'group:long-term', label: '长期任务', title: '长期任务', order: 99998 }
      : { key: 'group:inbox', label: '收集箱', title: '收集箱', order: 0 };
  },
  appendSessionItems(host, entries = []) {
    for (const session of entries) {
      const row = createElement('div');
      row.sessionId = session.id;
      host.appendChild(row);
    }
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
};
routingContext.globalThis = routingContext;

vm.runInNewContext(`
  ${getSidebarPersistentKindSource}
  ${getPersistentDockGroupKeySource}
  ${renderSessionListSource}
  globalThis.getPersistentDockGroupKey = getPersistentDockGroupKey;
  globalThis.renderSessionList = renderSessionList;
`, routingContext, {
  filename: 'static/frontend/session-list/ui.js',
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
  1,
  'ordinary long-term sessions should still render in the grouped session list',
);
assert.equal(
  routingContext.capturedDockGroups['group:long-term']?.map((entry) => entry.id).join(','),
  'persistent-long-term',
  'bottom dock should only include true persistent items',
);

const footerContext = {
  console,
  sessionListFooter: createElement('div'),
  document: { createElement },
  t(key) {
    return key === 'persistent.sectionTitle' ? '长期项' : key;
  },
  esc(value) {
    return String(value || '');
  },
  renderPersistentDockSection(groupKey) {
    const node = createElement('div');
    node.groupKey = groupKey;
    return node;
  },
};
footerContext.sessionListFooter.className = 'session-list-footer';
footerContext.globalThis = footerContext;

vm.runInNewContext(`
  ${renderPersistentSessionDockSource}
  globalThis.renderPersistentSessionDock = renderPersistentSessionDock;
`, footerContext, {
  filename: 'static/frontend/session-list/ui.js',
});

footerContext.renderPersistentSessionDock({
  'group:long-term': [{ id: 'persistent-long-term' }],
});

assert.match(
  footerContext.sessionListFooter.className,
  /session-list-footer/,
  'persistent dock should preserve the base footer class so bottom positioning styles stay active',
);
assert.match(
  footerContext.sessionListFooter.className,
  /has-persistent-dock/,
  'persistent dock should add a dedicated modifier class instead of replacing the footer class',
);
assert.equal(
  footerContext.sessionListFooter.children[0]?.children[0]?.innerHTML.includes('长期项'),
  true,
  'persistent dock should show an explicit long-lived section heading',
);

console.log('test-chat-persistent-dock-ui: ok');
