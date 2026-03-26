#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const scheduleSource = readFileSync(join(repoRoot, 'static/chat/schedule.js'), 'utf8');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(token));
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
    setFromString(value) {
      values.clear();
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => values.add(token));
    },
    toString() {
      return [...values].join(' ');
    },
  };
}

function makeElement({ id = '', value = '', hidden = false, dataset = {}, className = '' } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  let classNameValue = className;
  const classList = makeClassList(className.split(/\s+/).filter(Boolean));
  const element = {
    id,
    dataset,
    value,
    hidden,
    disabled: false,
    open: false,
    textContent: '',
    title: '',
    parentNode: null,
    children: [],
    classList,
    contains(target) {
      if (target === element) return true;
      return element.children.some((child) => child === target || child.contains(target));
    },
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => {
        if (child && typeof child === 'object') {
          element.appendChild(child);
        }
      });
    },
    setAttribute(name, nextValue) {
      attributes.set(name, String(nextValue));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler({
        target: element,
        currentTarget: element,
        preventDefault() {},
        ...event,
      }));
    },
    click(event = {}) {
      element.dispatch('click', event);
    },
    focus() {},
    closest(selector) {
      let current = element;
      while (current) {
        if (selector === '.header-schedule-field' && current.classList.contains('header-schedule-field')) {
          return current;
        }
        current = current.parentNode;
      }
      return null;
    },
  };

  Object.defineProperty(element, 'className', {
    get() {
      return classNameValue;
    },
    set(nextValue) {
      classNameValue = String(nextValue || '');
      classList.setFromString(classNameValue);
    },
  });

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return '';
    },
    set(_value) {
      element.children = [];
      element.textContent = '';
    },
  });

  return element;
}

function findChildByClass(root, token) {
  if (!root || !Array.isArray(root.children)) return null;
  for (const child of root.children) {
    if (child.classList?.contains(token)) return child;
    const nested = findChildByClass(child, token);
    if (nested) return nested;
  }
  return null;
}

function createHarness(nowMs) {
  const ids = [
    'headerSchedule',
    'scheduleToggleBtn',
    'scheduleChipLabel',
    'scheduleChipMeta',
    'schedulePanel',
    'scheduleCurrentTabBtn',
    'scheduleAllTasksTabBtn',
    'scheduleCurrentView',
    'scheduleAllTasksView',
    'schedulePanelState',
    'scheduleStatusText',
    'scheduleListSummary',
    'scheduleList',
    'scheduleEmptyState',
    'scheduleResultCard',
    'scheduleResultBadge',
    'scheduleResultMeta',
    'scheduleResultDetail',
    'scheduleResultError',
    'addScheduleBtn',
    'schedulePresetSelect',
    'schedulePresetNote',
    'scheduleEnabledInput',
    'scheduleRecurrenceSelect',
    'scheduleTimeInput',
    'scheduleIntervalField',
    'scheduleIntervalInput',
    'scheduleAdvanced',
    'scheduleLabelInput',
    'scheduleModelSelect',
    'scheduleContentInput',
    'saveScheduleBtn',
    'runScheduleBtn',
    'clearScheduleBtn',
    'scheduleTimezoneNote',
    'allSchedulesSummary',
    'allSchedulesEmpty',
    'allSchedulesList',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement({ id })]));
  const documentListeners = new Map();

  const timeField = makeElement({ className: 'header-schedule-field' });
  timeField.appendChild(elements.scheduleTimeInput);

  const document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      return makeElement({ className: '', dataset: {}, value: '', hidden: false, id: tagName });
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    querySelectorAll() {
      return [];
    },
  };

  class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(nowMs);
        return;
      }
      super(...args);
    }

    static now() {
      return nowMs;
    }
  }

  const context = {
    console,
    document,
    window: {
      crypto: {
        randomUUID() {
          return '12345678-1234-1234-1234-123456789abc';
        },
      },
      RemoteLabSettingsWorkspace: {
        syncOverview() {},
      },
    },
    Intl,
    Date: MockDate,
    currentSessionId: null,
    sessions: [],
    fetchJsonOrRedirect: async () => ({ models: [] }),
    upsertSession(value) {
      context.sessions = [value];
      return value;
    },
    renderSessionList() {},
    attachSession(sessionId) {
      context.currentSessionId = sessionId;
    },
  };
  context.globalThis = context;

  return { context, elements };
}

const baseNow = Date.parse('2026-03-25T01:00:00.000Z');
const harness = createHarness(baseNow);
vm.runInNewContext(scheduleSource, harness.context, { filename: 'static/chat/schedule.js' });

const failedSession = {
  id: 'session-failed',
  name: 'Morning Ops',
  tool: 'fake-codex',
  model: 'sonnet',
  scheduledTriggers: [
    {
      id: 'morning_plan',
      label: 'Morning plan',
      enabled: true,
      recurrenceType: 'daily',
      timeOfDay: '09:00',
      timezone: 'Asia/Shanghai',
      prompt: 'Plan the day.',
      nextRunAt: '2026-03-25T02:00:00.000Z',
      lastRunAt: '2026-03-25T00:55:00.000Z',
      lastRunStatus: 'failed',
      lastError: 'Tool process exited unexpectedly.',
    },
  ],
};

harness.context.sessions = [failedSession];
harness.context.currentSessionId = failedSession.id;
harness.context.window.RemoteLabScheduleUi.sync(failedSession);

assert.equal(harness.elements.scheduleResultBadge.textContent, 'Failed');
assert.equal(harness.elements.scheduleResultError.hidden, false, 'failed triggers should surface the last error');
assert.match(harness.elements.scheduleResultMeta.textContent, /failed/i, 'failed triggers should explain the latest result');
assert.match(harness.elements.scheduleResultError.textContent, /exited unexpectedly/i);
assert.ok(harness.elements.scheduleList.children[0].classList.contains('issue'), 'failed trigger rows should stand out in the list');
assert.ok(
  !!findChildByClass(harness.elements.scheduleList.children[0], 'header-schedule-item-alert'),
  'failed trigger rows should show an inline error preview',
);

const completedSession = {
  ...failedSession,
  id: 'session-completed',
  name: 'Daily Review',
  scheduledTriggers: [
    {
      ...failedSession.scheduledTriggers[0],
      id: 'daily_report',
      label: 'Daily report',
      lastRunStatus: 'completed',
      lastError: '',
      lastRunAt: '2026-03-25T00:40:00.000Z',
    },
  ],
};

harness.context.sessions = [completedSession];
harness.context.currentSessionId = completedSession.id;
harness.context.window.RemoteLabScheduleUi.sync(completedSession);

assert.equal(harness.elements.scheduleResultBadge.textContent, 'Completed');
assert.equal(harness.elements.scheduleResultError.hidden, true, 'successful triggers should clear the error callout');
assert.match(harness.elements.scheduleResultMeta.textContent, /completed/i, 'successful triggers should surface a completion summary');
assert.equal(
  !!findChildByClass(harness.elements.scheduleList.children[0], 'header-schedule-item-alert'),
  false,
  'successful trigger rows should not keep a stale error preview',
);

console.log('test-chat-schedule-status: ok');
