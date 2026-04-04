#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const settingsUiSource = readFileSync(join(repoRoot, 'static/chat/settings/ui.js'), 'utf8');
const generalUiSource = readFileSync(join(repoRoot, 'static/chat/settings/general/ui.js'), 'utf8');

function makeClassList() {
  const tokens = new Set();
  return {
    add(...values) {
      values.filter(Boolean).forEach((value) => tokens.add(value));
    },
    remove(...values) {
      values.filter(Boolean).forEach((value) => tokens.delete(value));
    },
    toggle(value, force) {
      if (force === true) {
        tokens.add(value);
        return true;
      }
      if (force === false) {
        tokens.delete(value);
        return false;
      }
      if (tokens.has(value)) {
        tokens.delete(value);
        return false;
      }
      tokens.add(value);
      return true;
    },
    contains(value) {
      return tokens.has(value);
    },
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    dataset: {},
    classList: makeClassList(),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler.call(this, event);
      }
    },
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
}

function makeGeneralPanelBody() {
  const target = makeEventTarget();
  target._innerHTML = '';
  Object.defineProperty(target, 'innerHTML', {
    get() {
      return target._innerHTML;
    },
    set(value) {
      target._innerHTML = String(value);
    },
  });
  target.querySelector = function querySelector() { return null; };
  return target;
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

const generalPanelBody = makeGeneralPanelBody();
const hooksOverlay = makeEventTarget();
hooksOverlay.hidden = true;
const hooksSettingsBtn = makeEventTarget();
const hooksOverlayClose = makeEventTarget();
const settingsTabGeneral = makeEventTarget();
settingsTabGeneral.dataset.settingsTab = 'general';
const settingsTabHooks = makeEventTarget();
settingsTabHooks.dataset.settingsTab = 'hooks';
const settingsPanelGeneral = makeEventTarget();
settingsPanelGeneral.dataset.settingsPanel = 'general';
const settingsPanelHooks = makeEventTarget();
settingsPanelHooks.dataset.settingsPanel = 'hooks';
const documentBody = { classList: makeClassList() };

const documentTarget = makeEventTarget();
documentTarget.body = documentBody;
documentTarget.getElementById = function getElementById(id) {
  switch (id) {
    case 'hooksOverlay':
      return hooksOverlay;
    case 'hooksSettingsBtn':
      return hooksSettingsBtn;
    case 'hooksOverlayClose':
      return hooksOverlayClose;
    case 'generalSettingsPanelBody':
      return generalPanelBody;
    case 'settingsTabGeneral':
      return settingsTabGeneral;
    case 'settingsTabHooks':
      return settingsTabHooks;
    case 'settingsPanelGeneral':
      return settingsPanelGeneral;
    case 'settingsPanelHooks':
      return settingsPanelHooks;
    default:
      return null;
  }
};
documentTarget.querySelectorAll = function querySelectorAll(selector) {
  if (selector === '[data-settings-tab]') {
    return [settingsTabGeneral, settingsTabHooks];
  }
  if (selector === '[data-settings-panel]') {
    return [settingsPanelGeneral, settingsPanelHooks];
  }
  return [];
};

const fetchCalls = [];
const context = {
  console,
  document: documentTarget,
  fetch: async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      async json() {
        return {
          obsidianPath: '/Users/test/vault',
          storageRootPath: '/Users/test/vault',
          appRoot: '/Users/test/vault/00-🤖agent/.melodysync',
          storagePath: '/Users/test/vault/00-🤖agent/.melodysync/config/general-settings.json',
          customHooksPath: '/Users/test/vault/00-🤖agent/.melodysync/hooks/custom-hooks.json',
          agentsPath: '/Users/test/vault/00-🤖agent/AGENTS.md',
          agentsContent: '# MelodySync AGENTS\n',
        };
      },
    };
  },
};

context.window = context;
context.globalThis = context;

vm.runInNewContext(settingsUiSource, context, { filename: 'static/chat/settings/ui.js' });
vm.runInNewContext(generalUiSource, context, { filename: 'static/chat/settings/general/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(hooksOverlay.hidden, false, 'settings button should open the shared overlay');
assert.deepEqual(fetchCalls, ['/api/settings'], 'opening settings should fetch general settings once');
assert.equal(settingsTabGeneral.classList.contains('is-active'), true, 'general tab should be active by default');
assert.equal(settingsPanelGeneral.hidden, false, 'general panel should be visible by default');
assert.match(generalPanelBody.innerHTML, /本地数据根路径/, 'general settings should describe the storage root, not a hard obsidian binding');
assert.match(generalPanelBody.innerHTML, /应用目录：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/\.melodysync<\/code>/, 'general settings should expose the MelodySync app root');
assert.match(generalPanelBody.innerHTML, /自定义 Hook 设计文件：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/\.melodysync\/hooks\/custom-hooks\.json<\/code>/, 'general settings should expose the custom hook design file');
assert.match(generalPanelBody.innerHTML, /Agent 说明文件：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/AGENTS\.md<\/code>/, 'general settings should expose the agents file path');
assert.match(generalPanelBody.innerHTML, /PATCH \/api\/settings/, 'general settings should show the API write entry');
assert.match(generalPanelBody.innerHTML, /网页仅做展示/, 'general settings should explain that frontend is read-only');
assert.match(generalPanelBody.innerHTML, /当前内容：<\/strong>这里只读展示当前后端已加载的 AGENTS\.md。/, 'general settings should present AGENTS content as read-only');
assert.doesNotMatch(generalPanelBody.innerHTML, /保存设置/, 'general settings should not expose save buttons in the frontend');
assert.doesNotMatch(generalPanelBody.innerHTML, /<input[^>]+name="obsidianPath"/, 'general settings should not expose editable path inputs');

console.log('test-chat-general-settings-ui: ok');
