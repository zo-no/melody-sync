#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readComposeSource() {
  const candidates = [
    join(repoRoot, 'frontend-src', 'session', 'compose.js'),
    join(repoRoot, 'frontend', 'session', 'compose.js'),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error('compose.js source not found');
  }
  return readFileSync(targetPath, 'utf8');
}

class StorageMock {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(token));
    },
    toggle(token, force) {
      if (typeof force === 'boolean') {
        if (force) values.add(token);
        else values.delete(token);
        return force;
      }
      if (values.has(token)) {
        values.delete(token);
        return false;
      }
      values.add(token);
      return true;
    },
    contains(token) {
      return values.has(token);
    },
  };
}

function createDomElement(tagName = 'div') {
  const listeners = new Map();
  let innerHtml = '';
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    hidden: false,
    disabled: false,
    title: '',
    textContent: '',
    className: '',
    type: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatchEvent(event) {
      const listener = listeners.get(event?.type);
      if (typeof listener === 'function') {
        listener.call(this, event);
      }
      return true;
    },
    click() {
      return this.dispatchEvent({ type: 'click', target: this });
    },
    focus() {},
    remove() {},
    setAttribute(name, value) {
      this[name] = value;
    },
    classList: makeClassList(),
  };
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHtml;
    },
    set(value) {
      innerHtml = String(value);
      this.children = [];
    },
  });
  return element;
}

function createContext() {
  const localStorage = new StorageMock();
  const documentElements = {
    longTermWorkspace: createDomElement('section'),
    longTermWorkspaceList: createDomElement('div'),
    longTermWorkspaceDetail: createDomElement('div'),
    longTermWorkspaceCount: createDomElement('span'),
    longTermWorkspaceNewBtn: createDomElement('button'),
  };
  const document = {
    body: {
      classList: makeClassList(),
    },
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(documentElements, id)
        ? documentElements[id]
        : null;
    },
    createElement(tagName) {
      return createDomElement(tagName);
    },
  };
  const attachCalls = [];
  const dispatchCalls = [];
  const renderSessionListCalls = [];
  const syncBrowserStateCalls = [];
  const requestLayoutPassCalls = [];
  const createLongTermCalls = [];
  const subscribeCalls = { appState: 0, workbench: 0 };
  const currentRuntimeSelection = { tool: 'codex', model: 'gpt-5' };
  const sessions = [
    {
      id: 'short-term-main',
      name: '收件箱任务',
      updatedAt: '2026-04-10T10:30:00.000+08:00',
      lastEventAt: '2026-04-10T10:35:00.000+08:00',
      taskCard: {
        checkpoint: '继续处理普通任务线',
      },
    },
    {
      id: 'long-term-main',
      name: 'MelodySync',
      updatedAt: '2026-04-10T10:00:00.000+08:00',
      lastEventAt: '2026-04-10T10:05:00.000+08:00',
      persistent: {
        kind: 'recurring_task',
        digest: {
          title: 'MelodySync',
          summary: '长期维护任务系统、工作台、记忆与自动化执行能力。',
        },
        recurring: {
          cadence: 'daily',
          timeOfDay: '09:00',
        },
      },
      taskCard: {
        checkpoint: '继续收紧长期任务与普通任务的边界',
        knownConclusions: ['长期任务应保持顶层入口独立'],
      },
    },
    {
      id: 'long-term-branch',
      name: '长期任务隔离',
      updatedAt: '2026-04-10T10:20:00.000+08:00',
      lastEventAt: '2026-04-10T10:25:00.000+08:00',
      taskCard: {
        lineRole: 'branch',
        checkpoint: '把默认恢复和完成跳转继续按长期线分流',
      },
    },
  ];
  const context = {
    console,
    localStorage,
    document,
    window: {
      addEventListener() {},
      removeEventListener() {},
      melodySyncT(key) {
        if (key === 'sidebar.newLongTerm') return '新长期任务';
        if (key === 'sidebar.newSession') return '新任务';
        return key;
      },
      visualViewport: {
        addEventListener() {},
        removeEventListener() {},
      },
      MelodySyncAppState: {
        subscribe(listener) {
          subscribeCalls.appState += 1;
          context.appStateSubscriber = listener;
          return () => {};
        },
      },
      MelodySyncWorkbench: {
        subscribe(listener) {
          subscribeCalls.workbench += 1;
          context.workbenchSubscriber = listener;
          return () => {};
        },
        openPersistentEditor(options = {}) {
          context.openPersistentEditorCall = options;
        },
      },
      MelodySyncSessionTooling: {
        getCurrentRuntimeSelectionSnapshot() {
          return currentRuntimeSelection;
        },
      },
    },
    Intl,
    Date,
    URL,
    URLSearchParams,
    requestAnimationFrame(callback) {
      callback();
    },
    getComputedStyle() {
      return { lineHeight: '24' };
    },
    localStorageState: localStorage,
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
      }
    },
    sessions,
    currentSessionId: 'short-term-main',
    pendingNavigationState: {},
    ACTIVE_SIDEBAR_TAB_STORAGE_KEY: 'activeSidebarTab',
    msgInput: createDomElement('textarea'),
    inputArea: createDomElement('div'),
    inputResizeHandle: createDomElement('div'),
    cancelBtn: createDomElement('button'),
    sendBtn: createDomElement('button'),
    composerPendingState: createDomElement('div'),
    sessionTemplateSelect: createDomElement('select'),
    saveTemplateBtn: createDomElement('button'),
    tabSessions: createDomElement('button'),
    tabLongTerm: createDomElement('button'),
    sessionListFooter: createDomElement('div'),
    newSessionBtn: createDomElement('button'),
    sessionList: createDomElement('div'),
    sidebarOverlay: createDomElement('div'),
    sidebarGroupingToolbar: createDomElement('div'),
    sidebarFilters: createDomElement('div'),
    pendingImages: [],
    emptyState: { parentNode: null, remove() {} },
    messagesInner: { appendChild() {}, innerHTML: '', children: [] },
    createRequestId() {
      return 'req_test';
    },
    isDesktop: true,
    selectedTool: null,
    selectedModel: null,
    selectedEffort: null,
    thinkingEnabled: true,
    currentToolReasoningKind: 'toggle',
    renderImagePreviews() {},
    getCurrentSession() {
      return { archived: false };
    },
    focusComposer() {
      return true;
    },
    syncBrowserState() {
      syncBrowserStateCalls.push(true);
    },
    renderSessionList() {
      renderSessionListCalls.push(true);
    },
    requestLayoutPass(reason) {
      requestLayoutPassCalls.push(reason);
    },
    attachSession(sessionId, session) {
      attachCalls.push({ sessionId, session });
      context.currentSessionId = sessionId;
      renderSessionListCalls.push('attach');
      syncBrowserStateCalls.push('attach');
    },
    dispatchAction(payload) {
      dispatchCalls.push(payload);
    },
    createNewLongTermProjectShortcut(options = {}) {
      createLongTermCalls.push(options);
      return Promise.resolve(true);
    },
    getSidebarPersistentKind(session) {
      return session?.persistent?.kind === 'recurring_task' ? 'recurring_task' : '';
    },
    getTaskClusterForSession(session) {
      if (session?.id !== 'long-term-main') return null;
      return {
        mainSessionId: 'long-term-main',
        branchSessions: [sessions[1]],
      };
    },
    getTaskBranchStatusLabel() {
      return '进行中';
    },
    getSessionTaskPreview(session) {
      if (session?.id === 'short-term-main') {
        return {
          summaryLine: '继续推进普通任务',
          hintLine: '',
        };
      }
      if (session?.id === 'long-term-main') {
        return {
          summaryLine: '继续完善长期任务主线',
          hintLine: '保持长期任务仍是普通会话交互',
        };
      }
      return {
        summaryLine: '把默认恢复和完成跳转继续按长期线分流',
        hintLine: '',
      };
    },
    getPreferredSessionDisplayName(session) {
      return session?.persistent?.digest?.title || '';
    },
    getSessionDisplayName(session) {
      return session?.name || '';
    },
    getSessionVisualStatus() {
      return { key: 'idle', label: 'Idle' };
    },
    compareSessionListSessions(left, right) {
      return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
    },
    normalizeSidebarTab(value) {
      return value === 'long-term' ? 'long-term' : 'sessions';
    },
    t(key) {
      if (key === 'sidebar.newLongTerm') return '新长期任务';
      if (key === 'sidebar.newSession') return '新任务';
      return key;
    },
    esc(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.localStorage = localStorage;
  context.globalThis = context;
  return {
    context,
    documentElements,
    attachCalls,
    createLongTermCalls,
    dispatchCalls,
    renderSessionListCalls,
    requestLayoutPassCalls,
    subscribeCalls,
    syncBrowserStateCalls,
  };
}

const composeSource = readComposeSource();
const harness = createContext();
vm.runInNewContext(composeSource, harness.context, { filename: 'frontend-src/session/compose.js' });

assert.equal(harness.subscribeCalls.appState, 1, 'long-term lane should subscribe to app-state updates');
assert.equal(harness.subscribeCalls.workbench, 1, 'long-term lane should subscribe to workbench updates');
assert.equal(
  harness.documentElements.longTermWorkspace.hidden,
  true,
  'legacy long-term workspace host should stay hidden on boot',
);

harness.context.switchTab('long-term');

assert.equal(
  harness.documentElements.longTermWorkspace.hidden,
  true,
  'switching to the long-term tab should keep the legacy workspace hidden',
);
assert.equal(
  harness.context.document.body.classList.contains('long-term-workspace-active'),
  false,
  'switching to the long-term tab should not apply a dedicated workspace body mode',
);
assert.equal(
  harness.attachCalls[0]?.sessionId,
  'long-term-main',
  'switching to the long-term tab should reopen the owning long-term root session',
);
assert.equal(harness.context.currentSessionId, 'long-term-main');
assert.equal(harness.context.newSessionBtn.textContent, '新长期任务');

harness.context.currentSessionId = 'long-term-branch';
harness.context.switchTab('long-term');
assert.equal(
  harness.attachCalls[1]?.sessionId,
  'long-term-main',
  'switching inside the long-term lane should pull maintenance branches back to the root session',
);

harness.context.switchTab('sessions');
assert.equal(
  harness.attachCalls[2]?.sessionId,
  'short-term-main',
  'switching back to sessions should restore an ordinary task session',
);
assert.equal(harness.context.currentSessionId, 'short-term-main');
assert.equal(harness.context.newSessionBtn.textContent, '新任务');

assert.ok(
  harness.renderSessionListCalls.length >= 2,
  'tab switching should continue refreshing the sidebar list',
);
assert.ok(
  harness.requestLayoutPassCalls.includes('sidebar-tab-switch'),
  'tab switching should still trigger a layout pass',
);
assert.ok(
  harness.syncBrowserStateCalls.length >= 2,
  'tab switching should continue syncing browser state',
);

console.log('test-chat-long-term-workbench: ok');
