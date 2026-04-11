#!/usr/bin/env node
import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const workbenchStylesheet = readFileSync(join(repoRoot, 'frontend-src', 'chat-workbench.css'), 'utf8');
const sessionSurfaceUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session', 'surface-ui.js'), 'utf8');
const sidebarUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session-list', 'sidebar-ui.js'), 'utf8');
const sessionListUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session-list', 'ui.js'), 'utf8');
const sessionListReactUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session-list', 'react-ui.js'), 'utf8');
const workbenchTaskMapReactUiSource = readFileSync(join(repoRoot, 'frontend-src', 'workbench', 'task-map-react-ui.jsx'), 'utf8');
const sidebarStylesheet = readFileSync(join(repoRoot, 'frontend-src', 'chat-sidebar.css'), 'utf8');
const chatTemplateSource = readFileSync(join(repoRoot, 'templates', 'chat.html'), 'utf8');

const filesToParse = [
  join(repoRoot, 'frontend-src', 'frontend.js'),
  join(repoRoot, 'frontend-src', 'core', 'bootstrap-data.js'),
  join(repoRoot, 'frontend-src', 'core', 'i18n.js'),
  join(repoRoot, 'frontend-src', 'core', 'bootstrap.js'),
  join(repoRoot, 'frontend-src', 'core', 'bootstrap-session-catalog.js'),
  join(repoRoot, 'frontend-src', 'core', 'layout-tooling.js'),
  join(repoRoot, 'frontend-src', 'session/tooling.js'),
  join(repoRoot, 'frontend-src', 'session', 'surface-ui.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'order-contract.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'contract.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'model.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'react-ui.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'ui.js'),
  join(repoRoot, 'frontend-src', 'session-list', 'sidebar-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench/node-contract.js'),
  join(repoRoot, 'frontend-src', 'workbench/node-effects.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'node-instance.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'graph-model.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'graph-client.js'),
  join(repoRoot, 'frontend-src', 'workbench/node-capabilities.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'node-task-card.js'),
  join(repoRoot, 'frontend-src', 'workbench/task-map-plan.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'task-map-clusters.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'task-map-mock-presets.js'),
  join(repoRoot, 'frontend-src', 'workbench/task-map-model.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'quest-state.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'task-tracker-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'node-rich-view-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'node-canvas-ui.js'),
  join(repoRoot, 'public', 'app', 'task-map-react.bundle.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'task-map-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'task-list-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'status-card-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'persistent-editor-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'branch-actions.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'operation-record-ui.js'),
  join(repoRoot, 'frontend-src', 'workbench', 'output-panel-ui.js'),
  join(repoRoot, 'frontend-src', 'settings', 'hooks', 'model.js'),
  join(repoRoot, 'frontend-src', 'settings', 'voice', 'ui.js'),
  join(repoRoot, 'frontend-src', 'settings/hooks/ui.js'),
  join(repoRoot, 'frontend-src', 'session/compose.js'),
];

for (const filePath of filesToParse) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${filePath} should parse cleanly.\n${result.stderr || result.stdout}`,
  );
}

assert.match(
  sessionListUiSource,
  /session-grouping-create-section/,
  'session list fallback renderer should expose an inline create-folder section above archive',
);

assert.match(
  workbenchTaskMapReactUiSource,
  /function SessionListCreateFolderSection\(/,
  'workbench React bundle should own the inline create-folder section',
);

assert.doesNotMatch(
  workbenchTaskMapReactUiSource,
  /function SessionListFocusSection\(/,
  'workbench React bundle should not keep the retired sidebar focus section renderer',
);

assert.match(
  workbenchTaskMapReactUiSource,
  /renderSessionList\(payload = \{\}\)/,
  'workbench React bundle should expose a renderSessionList entrypoint for the sidebar',
);

assert.doesNotMatch(
  workbenchTaskMapReactUiSource,
  /function renderPersistentDock\(/,
  'workbench React bundle should not keep the retired persistent dock renderer around once the footer fallback owns that reset',
);

assert.match(
  workbenchTaskMapReactUiSource,
  /function ArchivedSessionSection\([\s\S]*onEnsureArchivedLoaded[\s\S]*archivedSessionsLoaded[\s\S]*onEnsureArchivedLoaded\?\.\(\)/,
  'workbench React bundle should auto-request archived tasks when the archive section is visible before its rows are loaded',
);

assert.match(
  workbenchTaskMapReactUiSource,
  /function renderSessionCollections\(\{[\s\S]*?grouping = null,[\s\S]*?emptyState = null,[\s\S]*?archived = null,[\s\S]*?\}\s*=\s*\{\}\)\s*\{[\s\S]*?<SessionListCollections[\s\S]*?grouping=\{grouping\}[\s\S]*?emptyState=\{emptyState\}/,
  'workbench React bundle should forward the session-list empty state through the renderSessionCollections bridge instead of dropping it before React render',
);

assert.match(
  workbenchTaskMapReactUiSource,
  /folder-group-delete/,
  'workbench React bundle should expose per-folder delete actions in user mode',
);

assert.doesNotMatch(
  sessionListReactUiSource,
  /renderCreateFolderSectionReact|appendCreateFolderSectionDom|createSessionListRenderer/,
  'session-list/react-ui.js should remain a thin compatibility shim instead of duplicating the renderer',
);
assert.doesNotMatch(
  sidebarStylesheet,
  /\.session-item\.is-done-session \.session-item-name-text,[\s\S]*?text-decoration:\s*line-through/s,
  'done session rows should keep the green completion emphasis without crossing out the sidebar title',
);

assert.match(
  sidebarStylesheet,
  /\.session-item \.session-item-meta \.status-running,[\s\S]*?\.task-cluster-tree-row\.session-item \.session-item-meta \.status-running \{\s*color:\s*var\(--notice\)\s*!important;/,
  'task list running status should keep its accent color even inside tinted running session cards',
);

assert.match(
  sidebarStylesheet,
  /\.session-item \.session-item-meta \.status-done,[\s\S]*?\.task-cluster-tree-row\.session-item \.session-item-meta \.status-persistent-recurring \{\s*color:\s*var\(--success\)\s*!important;/,
  'task list completion statuses should keep their success color even inside tinted done session cards',
);

assert.match(
  sessionListReactUiSource,
  /MelodySyncSessionListUi/,
  'session-list/react-ui.js should still expose the legacy global alias',
);

assert.doesNotMatch(
  sidebarUiSource,
  /const nextValue = prompt\(/,
  'sidebar grouping config should no longer use a blocking prompt dialog',
);

assert.doesNotMatch(
  sidebarUiSource,
  /sidebar-grouping-popover/,
  'folder creation should no longer rely on a detached popover shell',
);

assert.doesNotMatch(
  sidebarUiSource,
  /AI 会按这些分组顺序整理：/,
  'folder mode should no longer expose a visible AI ordering summary',
);

assert.doesNotMatch(
  chatTemplateSource,
  /sidebarGroupingConfigBtn/,
  'sidebar toolbar should no longer keep a top-level template edit button',
);

assert.match(
  sidebarStylesheet,
  /\.session-grouping-create-section\s*\{/,
  'sidebar stylesheet should include the create-folder section rendered above archive',
);

assert.doesNotMatch(
  sidebarStylesheet,
  /\.sidebar-tabs\s*\{[^}]*display:\s*none\s*!important;/,
  'sidebar stylesheet should not globally hide the sidebar tab switcher because the long-term lane entry lives there',
);

assert.match(
  sidebarStylesheet,
  /\.session-grouping-create-draft\s*\{/,
  'sidebar stylesheet should include the inline draft folder shell',
);

assert.match(
  sidebarStylesheet,
  /\.session-grouping-create-input\s*\{/,
  'sidebar stylesheet should include the inline draft folder input',
);

assert.match(
  sidebarStylesheet,
  /\.folder-group-delete\s*\{/,
  'sidebar stylesheet should include the per-folder delete action styling',
);

assert.match(
  sessionSurfaceUiSource,
  /session-item-leading-action archive-checkbox/,
  'session surface ui should render archive as a leading checkbox-style action',
);

assert.match(
  sessionSurfaceUiSource,
  /function renderSessionTaskPreviewHtml\(/,
  'session surface ui should build dedicated task preview rows for the sidebar',
);

assert.match(
  sessionSurfaceUiSource,
  /当前子任务：/,
  'session surface ui should surface the current child task hint for mainline rows',
);

assert.match(
  sessionSurfaceUiSource,
  /来自主线：/,
  'session surface ui should surface the parent mainline hint for branch rows',
);

assert.doesNotMatch(
  sessionListUiSource,
  /function getSessionFocusSectionData\(/,
  'session list ui should no longer compute a dedicated focus shortlist before grouped tasks',
);

assert.match(
  sidebarStylesheet,
  /\.session-action-btn\.session-item-leading-action\s*\{/,
  'sidebar stylesheet should style the leading archive checkbox shell',
);

assert.match(
  sidebarStylesheet,
  /\.session-action-checkbox-ring\s*\{/,
  'sidebar stylesheet should render the archive checkbox ring',
);

assert.match(
  sidebarStylesheet,
  /\.session-item-actions-toggle\s*\{/,
  'sidebar stylesheet should include the compact mobile actions toggle shell',
);

assert.match(
  sidebarStylesheet,
  /\.session-item-summary\s*\{/,
  'sidebar stylesheet should style the task checkpoint preview row',
);

assert.match(
  sidebarStylesheet,
  /\.session-item-hint\s*\{/,
  'sidebar stylesheet should style the task hint row',
);

assert.doesNotMatch(
  sidebarStylesheet,
  /\.session-focus-section\s*\{/,
  'sidebar stylesheet should not keep the retired top focus section shell',
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSelectorBlocks(stylesheet, selector) {
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'gs');
  return Array.from(stylesheet.matchAll(pattern), (match) => match[1]);
}

function getDeclarationValues(block, property) {
  const pattern = new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;]+);`, 'g');
  return Array.from(block.matchAll(pattern), (match) => match[1].trim());
}

assert.match(
  workbenchStylesheet,
  /\.quest-task-list\.is-flow-board \.quest-task-list-react-host\s*\{[^}]*height:\s*100%/s,
  'flow-board react host should inherit full height so the task map rail does not collapse',
);

assert.match(
  workbenchStylesheet,
  /\.quest-task-list\.is-flow-board \.quest-task-list-react-host\s*\{[^}]*min-height:\s*0/s,
  'flow-board react host should allow min-height 0 to preserve nested overflow layout',
);

assert.match(
  workbenchStylesheet,
  /\.quest-task-flow-node\.is-current,\s*\.quest-task-flow-node\.is-current-path:not\(\.is-current\),\s*\.quest-task-flow-node\.is-canvas-selected\s*\{[^}]*background:\s*var\(--quest-task-flow-node-bg\)\s*!important/s,
  'task-map selection states should preserve the runtime-driven node background color',
);

for (const selector of [
  '.quest-task-flow-node.is-current',
  '.quest-task-flow-node.is-current-path:not(.is-current)',
  '.quest-task-flow-node.is-canvas-selected',
]) {
  const blocks = getSelectorBlocks(workbenchStylesheet, selector);
  assert.ok(blocks.length > 0, `${selector} should exist in the stylesheet`);
  for (const block of blocks) {
    const backgrounds = getDeclarationValues(block, 'background');
    const borderColors = getDeclarationValues(block, 'border-color');
    for (const value of backgrounds) {
      assert.match(value, /var\(--quest-task-flow-node-bg\)/, `${selector} should not hardcode a selection background`);
    }
    for (const value of borderColors) {
      assert.match(value, /var\(--quest-task-flow-node-border\)/, `${selector} should not hardcode a selection border color`);
    }
  }
}

assert.match(
  workbenchStylesheet,
  /--quest-task-flow-running-accent:\s*var\(--notice\);/s,
  'task-map running state should derive from the same blue accent as the task list',
);

assert.match(
  workbenchStylesheet,
  /--quest-task-flow-completed-accent:\s*var\(--success\);/s,
  'task-map completed state should derive from the same green accent as the task list',
);

for (const [selector, accentVar] of [
  ['.quest-task-flow-node:is(.is-status-running, .is-running-session, .status-running, .status-pending)', '--quest-task-flow-running-accent'],
  ['.quest-task-flow-node:is(.is-status-completed, .is-status-done, .is-done-session, .is-resolved)', '--quest-task-flow-completed-accent'],
]) {
  const blocks = getSelectorBlocks(workbenchStylesheet, selector);
  assert.ok(blocks.length > 0, `${selector} should exist in the stylesheet`);
  for (const block of blocks) {
    const statusAccents = getDeclarationValues(block, '--quest-task-flow-node-status-accent');
    const badgeDots = getDeclarationValues(block, '--quest-task-flow-node-badge-dot');
    assert.ok(
      statusAccents.some((value) => value.includes(`var(${accentVar})`)),
      `${selector} should use ${accentVar} as its status accent`,
    );
    if (badgeDots.length > 0) {
      assert.ok(
        badgeDots.some((value) => value.includes(`var(${accentVar})`)),
        `${selector} should keep its badge dot on ${accentVar}`,
      );
    }
  }
}

const candidateEdgeBlocks = getSelectorBlocks(workbenchStylesheet, '.quest-task-flow-edge.is-candidate');
assert.ok(
  candidateEdgeBlocks.some((block) => {
    const opacities = getDeclarationValues(block, 'opacity');
    const strokes = getDeclarationValues(block, 'stroke');
    const strokeWidths = getDeclarationValues(block, 'stroke-width');
    const dashArrays = getDeclarationValues(block, 'stroke-dasharray');
    return opacities.includes('0.34')
      && strokes.includes('color-mix(in srgb, var(--border-strong) 72%, var(--border))')
      && strokeWidths.includes('1.5px')
      && dashArrays.includes('3 5');
  }),
  'candidate task-map edges should render as dashed guides without fading below the default branch line emphasis',
);

const candidateNodeBlocks = getSelectorBlocks(workbenchStylesheet, '.quest-task-flow-node.is-candidate');
assert.ok(
  candidateNodeBlocks.some((block) => {
    const borderStyles = getDeclarationValues(block, 'border-style');
    const borderColors = getDeclarationValues(block, 'border-color');
    const backgrounds = getDeclarationValues(block, 'background');
    const boxShadows = getDeclarationValues(block, 'box-shadow');
    return borderStyles.includes('dashed')
      && borderColors.includes('color-mix(in srgb, var(--border-strong) 68%, var(--border)) !important')
      && backgrounds.includes('color-mix(in srgb, var(--bg) 12%, transparent) !important')
      && boxShadows.includes('none !important');
  }),
  'candidate task-map nodes should keep a dashed border without fading the boundary itself',
);

const candidateTitleBlocks = getSelectorBlocks(workbenchStylesheet, '.quest-task-flow-node.is-candidate .quest-task-flow-node-title');
assert.ok(
  candidateTitleBlocks.some((block) => {
    const colors = getDeclarationValues(block, 'color');
    return colors.includes('color-mix(in srgb, var(--text-secondary) 82%, var(--text-muted)) !important');
  }),
  'candidate task-map titles should be weaker than committed branch titles',
);

assert.match(
  workbenchStylesheet,
  /\.quest-task-flow-node\.is-candidate \.quest-task-flow-node-summary,\s*\.quest-task-flow-node\.is-candidate \.quest-task-flow-node-badge\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--text-muted\) 88%, transparent\)\s*!important;/s,
  'candidate task-map summary and badge text should stay muted',
);

function createClassList() {
  const classes = new Set();
  return {
    add(...tokens) {
      tokens.forEach((token) => classes.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => classes.delete(token));
    },
    toggle(token, force) {
      if (force === true) {
        classes.add(token);
        return true;
      }
      if (force === false) {
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    },
    contains(token) {
      return classes.has(token);
    },
  };
}

function createStyle() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(name, value);
    },
    getPropertyValue(name) {
      return values.get(name) || '';
    },
  };
}

function createElement(tagName = 'div') {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    value: '',
    checked: false,
    disabled: false,
    readOnly: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    title: '',
    dataset: {},
    style: createStyle(),
    classList: createClassList(),
    children: [],
    files: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute(name) {
      return this[name] || null;
    },
    removeAttribute(name) {
      delete this[name];
    },
    focus() {},
    blur() {},
    click() {},
    select() {},
    remove() {},
    closest() { return null; },
    matches() { return false; },
    contains() { return false; },
    querySelector() { return createElement('div'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    scrollIntoView() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

const elements = new Map();
function getElementById(id) {
  if (!elements.has(id)) {
    elements.set(id, createElement('div'));
  }
  return elements.get(id);
}

const documentElement = createElement('html');
const body = createElement('body');

const context = {
  console: {
    info() {},
    log() {},
    warn() {},
    error(...args) {
      throw new Error(args.map((value) => String(value)).join(' '));
    },
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  URL,
  URLSearchParams,
  Date,
  Map,
  Set,
  WeakMap,
  Promise,
  JSON,
  Math,
  Intl,
  getComputedStyle() {
    return {
      lineHeight: '24px',
      paddingTop: '0px',
      paddingBottom: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
    };
  },
  fetch: async () => ({
    ok: true,
    status: 200,
    async json() { return {}; },
    async text() { return ''; },
  }),
  history: {
    replaceState() {},
    pushState() {},
  },
  localStorage: createStorage(),
  sessionStorage: createStorage(),
  navigator: {
    clipboard: {
      async writeText() {},
    },
    serviceWorker: null,
  },
  Notification: {
    permission: 'denied',
    requestPermission: async () => 'denied',
  },
  performance: {
    now: () => 0,
  },
  requestAnimationFrame(callback) {
    return setTimeout(() => callback(0), 0);
  },
  cancelAnimationFrame(handle) {
    clearTimeout(handle);
  },
  marked: {
    use() {},
  },
  copyText: async () => {},
  crypto: {
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
  },
  document: {
    documentElement,
    body,
    currentScript: { nonce: '' },
    getElementById,
    createElement,
    querySelector() { return createElement('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  },
  window: {
    location: {
      href: 'http://127.0.0.1:7690/',
      origin: 'http://127.0.0.1:7690',
      search: '',
      pathname: '/',
      reload() {},
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(0), 0);
    },
    cancelAnimationFrame(handle) {
      clearTimeout(handle);
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      };
    },
    visualViewport: {
      height: 800,
      addEventListener() {},
      removeEventListener() {},
    },
    MelodySyncSessionStateModel: {
      createEmptyStatus() {
        return {};
      },
      normalizeSessionActivity(session) {
        return session?.activity || null;
      },
      isSessionBusy() {
        return false;
      },
      getSessionStatusSummary() {
        return { primary: { label: 'Idle', tone: 'idle' } };
      },
    },
    __MELODYSYNC_BUILD__: { assetVersion: 'test-build', title: 'test build' },
    __MELODYSYNC_BOOTSTRAP__: { auth: { role: 'owner' } },
  },
};

context.globalThis = context;
context.self = context.window;
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.sessionStorage = context.sessionStorage;
context.window.history = context.history;
context.window.navigator = context.navigator;
context.window.Notification = context.Notification;
context.window.performance = context.performance;
context.window.URL = URL;
context.window.URLSearchParams = URLSearchParams;
context.window.fetch = context.fetch;
context.window.marked = context.marked;
context.window.crypto = context.crypto;
context.window.getComputedStyle = context.getComputedStyle;

const orderedFiles = [
  'core/bootstrap-data.js',
  'core/i18n.js',
  'core/bootstrap.js',
  'core/bootstrap-session-catalog.js',
  'core/layout-tooling.js',
  'session/tooling.js',
  'session-list/sidebar-ui.js',
  'session/compose.js',
];

for (const fileName of orderedFiles) {
  const source = readFileSync(join(repoRoot, 'frontend-src', fileName), 'utf8');
  vm.runInNewContext(source, context, { filename: `frontend/${fileName}` });
}

await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(typeof context.readNavigationStateFromLocation, 'function');
assert.equal(typeof context.createNewSessionShortcut, 'function');
assert.equal(typeof context.createSortSessionListShortcut, 'function');
assert.equal(typeof context.switchTab, 'function');

console.log('test-chat-split-frontend-smoke: ok');
process.exit(0);
