#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const timerSource = readFileSync(join(repoRoot, 'static/chat/timer.js'), 'utf8');

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
}

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
  };
}

function makeElement({ dataset = {}, value = '', hidden = false } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    dataset,
    value,
    hidden,
    disabled: false,
    textContent: '',
    title: '',
    className: '',
    classList: makeClassList(),
    children: [],
    parentNode: null,
    contains(target) {
      if (target === element) return true;
      return element.children.some((child) => child === target || child.contains(target));
    },
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
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
      const payload = {
        target: element,
        currentTarget: element,
        preventDefault() {},
        ...event,
      };
      handlers.forEach((handler) => handler(payload));
    },
    click(event = {}) {
      element.dispatch('click', event);
    },
  };
  return element;
}

function createHarness() {
  let now = 0;
  let intervalId = 0;
  const intervals = new Map();
  const storage = new StorageMock();
  const documentListeners = new Map();
  const notifications = [];

  class NotificationMock {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      notifications.push(this);
    }

    close() {}
  }

  NotificationMock.permission = 'granted';

  const elements = {
    headerTimer: makeElement(),
    timerToggleBtn: makeElement(),
    timerToggleLabel: makeElement(),
    timerPanel: makeElement({ hidden: true }),
    timerReadout: makeElement(),
    timerMinutesInput: makeElement({ value: '25' }),
    timerStartBtn: makeElement(),
    timerPauseBtn: makeElement(),
    timerResetBtn: makeElement(),
    timerHint: makeElement(),
  };
  const preset25 = makeElement({ dataset: { timerPreset: '25' } });
  const preset50 = makeElement({ dataset: { timerPreset: '50' } });
  const preset90 = makeElement({ dataset: { timerPreset: '90' } });

  elements.headerTimer.appendChild(elements.timerToggleBtn);
  elements.headerTimer.appendChild(elements.timerPanel);
  elements.timerPanel.appendChild(elements.timerReadout);
  elements.timerPanel.appendChild(elements.timerMinutesInput);
  elements.timerPanel.appendChild(elements.timerStartBtn);
  elements.timerPanel.appendChild(elements.timerPauseBtn);
  elements.timerPanel.appendChild(elements.timerResetBtn);
  elements.timerPanel.appendChild(elements.timerHint);
  elements.timerPanel.appendChild(preset25);
  elements.timerPanel.appendChild(preset50);
  elements.timerPanel.appendChild(preset90);

  const document = {
    title: 'RemoteLab Chat',
    hidden: false,
    visibilityState: 'visible',
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-timer-preset]') {
        return [preset25, preset50, preset90];
      }
      return [];
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      const handlers = documentListeners.get(type) || [];
      handlers.forEach((handler) => handler({ preventDefault() {}, ...event }));
    },
  };

  const windowTarget = {
    focusCalls: 0,
    focus() {
      windowTarget.focusCalls += 1;
    },
  };
  windowTarget.Notification = NotificationMock;

  const context = {
    console,
    document,
    window: windowTarget,
    localStorage: storage,
    Notification: NotificationMock,
    setInterval(callback) {
      intervalId += 1;
      intervals.set(intervalId, callback);
      return intervalId;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    Date: class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          super(now);
          return;
        }
        super(...args);
      }

      static now() {
        return now;
      }
    },
  };
  context.globalThis = context;

  return {
    context,
    elements,
    preset25,
    preset50,
    preset90,
    notifications,
    setNow(value) {
      now = value;
    },
    advance(ms) {
      now += ms;
      for (const callback of intervals.values()) callback();
    },
    dispatchDocument(type, event) {
      document.dispatch(type, event);
    },
  };
}

const harness = createHarness();
vm.runInNewContext(timerSource, harness.context, { filename: 'static/chat/timer.js' });

assert.equal(harness.elements.timerToggleLabel.textContent, '25m', 'timer chip should default to the 25 minute preset');
assert.equal(harness.elements.timerReadout.textContent, '25:00', 'timer readout should default to 25 minutes');
assert.equal(harness.elements.timerPanel.hidden, true, 'timer panel should stay collapsed until opened');

harness.elements.timerToggleBtn.click();
assert.equal(harness.elements.timerPanel.hidden, false, 'timer toggle should open the panel');

harness.preset50.click();
assert.equal(harness.elements.timerToggleLabel.textContent, '50m', 'preset clicks should change the timer duration');
assert.equal(harness.elements.timerMinutesInput.value, '50', 'custom minutes input should track the active preset');
assert.equal(harness.preset50.classList.contains('active'), true, 'selected preset should be highlighted');

harness.elements.timerStartBtn.click();
assert.equal(harness.elements.timerPauseBtn.disabled, false, 'pause should become available once the timer starts');
assert.equal(harness.context.document.title, '[50:00] RemoteLab Chat', 'running timers should project into the page title');

harness.advance(90 * 1000);
assert.equal(harness.elements.timerReadout.textContent, '48:30', 'running timers should tick down from the stored end time');
assert.equal(harness.elements.timerToggleLabel.textContent, '48:30', 'timer chip should mirror the live countdown');

harness.elements.timerPauseBtn.click();
assert.equal(harness.elements.timerPauseBtn.disabled, true, 'pause should disable once the timer is paused');
assert.equal(harness.elements.timerStartBtn.textContent, 'Resume', 'paused timers should offer resume');
assert.equal(harness.context.document.title, 'RemoteLab Chat', 'paused timers should restore the base title');

harness.elements.timerResetBtn.click();
assert.equal(harness.elements.timerReadout.textContent, '50:00', 'reset should restore the selected duration');
assert.equal(harness.elements.timerToggleLabel.textContent, '50m', 'reset should return the chip to duration mode');

harness.elements.timerStartBtn.click();
harness.advance(50 * 60 * 1000);
assert.equal(harness.elements.timerToggleLabel.textContent, 'Done', 'finishing should mark the timer as done');
assert.equal(harness.elements.timerReadout.textContent, '00:00', 'finishing should drain the readout to zero');
assert.equal(harness.context.document.title, 'Timer done · RemoteLab Chat', 'finished timers should claim the page title');
assert.equal(harness.notifications.length, 0, 'visible pages should not show completion notifications');

harness.context.document.hidden = true;
harness.context.document.visibilityState = 'hidden';
harness.elements.timerResetBtn.click();
harness.elements.timerStartBtn.click();
harness.advance(50 * 60 * 1000);
assert.equal(harness.notifications.length, 1, 'hidden pages should emit a completion notification');
assert.equal(harness.notifications[0].title, 'RemoteLab Timer', 'timer notifications should be clearly labeled');

harness.dispatchDocument('click', { target: {} });
assert.equal(harness.elements.timerPanel.hidden, true, 'outside clicks should close the timer panel');

console.log('test-chat-focus-timer: ok');
