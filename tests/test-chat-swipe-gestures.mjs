#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const gesturesSource = readFileSync(join(repoRoot, 'static/chat/core/gestures.js'), 'utf8');

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

function makeStyle() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(name, value);
    },
    removeProperty(name) {
      values.delete(name);
    },
    getPropertyValue(name) {
      return values.get(name) || '';
    },
  };
}

class FakeElement {
  constructor({ blocked = false } = {}) {
    this.blocked = blocked;
  }

  closest() {
    return this.blocked ? this : null;
  }
}

function createHarness() {
  const listeners = new Map();
  const gesturePill = {
    textContent: '',
    classList: makeClassList(),
    style: makeStyle(),
  };
  const sidebarOverlay = {
    classList: makeClassList(),
  };
  const context = {
    console,
    Promise,
    Element: FakeElement,
    isDesktop: false,
    sidebarOverlay,
    addToolModal: { hidden: true },
    openSessionsSidebarCalls: 0,
    openTaskMapDrawerCalls: 0,
    openSessionsSidebar() {
      context.openSessionsSidebarCalls += 1;
      return true;
    },
    window: {
      innerWidth: 390,
      MelodySyncWorkbench: {
        isTaskMapDrawerOpen() {
          return false;
        },
        openTaskMapDrawer() {
          context.openTaskMapDrawerCalls += 1;
          return true;
        },
      },
    },
    document: {
      documentElement: {
        clientWidth: 390,
      },
      getElementById(id) {
        if (id === 'gesturePill') return gesturePill;
        return null;
      },
      addEventListener(type, listener) {
        const existing = listeners.get(type) || [];
        existing.push(listener);
        listeners.set(type, existing);
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(gesturesSource, context, { filename: 'static/chat/core/gestures.js' });
  return { context, listeners, gesturePill };
}

function emit(listeners, type, event) {
  for (const listener of listeners.get(type) || []) {
    listener(event);
  }
}

function touch(clientX, clientY) {
  return { clientX, clientY };
}

async function runSwipe(harness, {
  startX,
  startY = 420,
  moveX,
  moveY = startY,
  endX = moveX,
  endY = moveY,
  target = new FakeElement(),
} = {}) {
  let prevented = false;
  emit(harness.listeners, 'touchstart', {
    touches: [touch(startX, startY)],
    target,
  });
  emit(harness.listeners, 'touchmove', {
    touches: [touch(moveX, moveY)],
    preventDefault() {
      prevented = true;
    },
  });
  emit(harness.listeners, 'touchend', {
    changedTouches: [touch(endX, endY)],
  });
  await Promise.resolve();
  return { prevented };
}

const centerRightHarness = createHarness();
const centerRightResult = await runSwipe(centerRightHarness, {
  startX: 195,
  moveX: 258,
  endX: 286,
});
assert.equal(centerRightResult.prevented, false, 'center-right swipe should no longer steal scrolling');
assert.equal(centerRightHarness.context.openSessionsSidebarCalls, 0, 'swiping right from the middle should not open the session list');
assert.equal(centerRightHarness.context.openTaskMapDrawerCalls, 0, 'center-right swipe should not open the task map');

const edgeRightHarness = createHarness();
const edgeRightResult = await runSwipe(edgeRightHarness, {
  startX: 20,
  moveX: 92,
  endX: 118,
});
assert.equal(edgeRightResult.prevented, true, 'right-edge swipe should lock the gesture');
assert.equal(edgeRightHarness.context.openSessionsSidebarCalls, 1, 'swiping right from the left edge should open the session list');
assert.equal(edgeRightHarness.context.openTaskMapDrawerCalls, 0, 'right-edge swipe should not open the task map');

const centerLeftHarness = createHarness();
const centerLeftResult = await runSwipe(centerLeftHarness, {
  startX: 195,
  moveX: 132,
  endX: 104,
});
assert.equal(centerLeftResult.prevented, false, 'center-left swipe should no longer steal scrolling');
assert.equal(centerLeftHarness.context.openSessionsSidebarCalls, 0, 'left swipe from the middle should not open the session list');
assert.equal(centerLeftHarness.context.openTaskMapDrawerCalls, 0, 'left swipe from the middle should not open the task map');

const edgeLeftHarness = createHarness();
const edgeLeftResult = await runSwipe(edgeLeftHarness, {
  startX: 370,
  moveX: 304,
  endX: 280,
});
assert.equal(edgeLeftResult.prevented, true, 'left-edge swipe should lock the gesture');
assert.equal(edgeLeftHarness.context.openSessionsSidebarCalls, 0, 'left-edge swipe should not open the session list');
assert.equal(edgeLeftHarness.context.openTaskMapDrawerCalls, 1, 'swiping left from the right edge should open the task map drawer');

const verticalHarness = createHarness();
const verticalResult = await runSwipe(verticalHarness, {
  startX: 200,
  moveX: 216,
  moveY: 520,
  endX: 216,
  endY: 520,
});
assert.equal(verticalResult.prevented, false, 'vertical motion should not steal scrolling');
assert.equal(verticalHarness.context.openSessionsSidebarCalls, 0, 'vertical motion should not open the session list');
assert.equal(verticalHarness.context.openTaskMapDrawerCalls, 0, 'vertical motion should not open the task map');

const blockedHarness = createHarness();
await runSwipe(blockedHarness, {
  startX: 195,
  moveX: 300,
  endX: 320,
  target: new FakeElement({ blocked: true }),
});
assert.equal(blockedHarness.context.openSessionsSidebarCalls, 0, 'blocked interactive targets should ignore swipe shortcuts');
assert.equal(blockedHarness.context.openTaskMapDrawerCalls, 0, 'blocked interactive targets should not open the task map');

console.log('test-chat-swipe-gestures: ok');
