#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const settingsUiSource = readFileSync(join(repoRoot, 'frontend/settings/ui.js'), 'utf8');
const generalModelSource = readFileSync(join(repoRoot, 'frontend/settings/general/model.js'), 'utf8');
const generalUiSource = readFileSync(join(repoRoot, 'frontend/settings/general/ui.js'), 'utf8');

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
          brainRoot: '/Users/test/vault/00-🤖agent',
          runtimeRoot: '/Users/test/.melodysync/runtime',
          appRoot: '/Users/test/vault/00-🤖agent',
          storagePath: '/Users/test/.melodysync/runtime/config/general-settings.json',
          bootstrapStoragePath: '/Users/test/.config/melody-sync/general-settings.json',
          machineOverlayRoot: '/Users/test/.config/melody-sync',
          runtimeConfigRoot: '/Users/test/.melodysync/runtime/config',
          customHooksPath: '/Users/test/.melodysync/runtime/hooks/custom-hooks.json',
          memoryPath: '/Users/test/vault/00-🤖agent/memory',
          sessionsPath: '/Users/test/.melodysync/runtime/sessions',
          logsPath: '/Users/test/.melodysync/runtime/logs',
          providerRuntimeHomesPath: '/Users/test/.melodysync/runtime/config/provider-runtime-homes',
          agentsPath: '/Users/test/vault/00-🤖agent/AGENTS.md',
        };
      },
    };
  },
};

context.window = context;
context.globalThis = context;

vm.runInNewContext(settingsUiSource, context, { filename: 'frontend/settings/ui.js' });
vm.runInNewContext(generalModelSource, context, { filename: 'frontend/settings/general/model.js' });
vm.runInNewContext(generalUiSource, context, { filename: 'frontend/settings/general/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(hooksOverlay.hidden, false, 'settings button should open the shared overlay');
assert.deepEqual(fetchCalls, ['/api/settings/catalog', '/api/settings'], 'opening settings should fetch the catalog and general settings once');
assert.equal(settingsTabGeneral.classList.contains('is-active'), true, 'general tab should be active by default');
assert.equal(settingsPanelGeneral.hidden, false, 'general panel should be visible by default');
assert.match(generalPanelBody.innerHTML, /当前存储拓扑/, 'general settings should present the storage topology hero');
assert.match(generalPanelBody.innerHTML, /大脑目录/, 'general settings should expose the editable brain root field');
assert.match(generalPanelBody.innerHTML, /运行目录/, 'general settings should expose the editable runtime root field');
assert.match(generalPanelBody.innerHTML, /设备配置层/, 'general settings should explain the machine-local settings layer');
assert.match(generalPanelBody.innerHTML, /<input[^>]+name="brainRoot"[^>]+value="\/Users\/test\/vault\/00-🤖agent"/, 'general settings should render the brain root as an editable input');
assert.match(generalPanelBody.innerHTML, /<input[^>]+name="runtimeRoot"[^>]+value="\/Users\/test\/\.melodysync\/runtime"/, 'general settings should render the runtime root as an editable input');
assert.match(generalPanelBody.innerHTML, /说明文件[\s\S]*\/Users\/test\/vault\/00-🤖agent\/AGENTS\.md/, 'general settings should show the AGENTS file path');
assert.match(generalPanelBody.innerHTML, /当前设备配置文件[\s\S]*\/Users\/test\/\.config\/melody-sync\/general-settings\.json/, 'general settings should show the device config file path');
assert.match(generalPanelBody.innerHTML, /Provider 运行目录[\s\S]*\/Users\/test\/\.melodysync\/runtime\/config\/provider-runtime-homes/, 'general settings should show the provider runtime home path');
assert.doesNotMatch(generalPanelBody.innerHTML, /name="agentsPath"/, 'general settings should not render the agents path as an editable input');
assert.doesNotMatch(generalPanelBody.innerHTML, /name="agentsContent"/, 'general settings should not expose an editable AGENTS textarea');
assert.match(generalPanelBody.innerHTML, /保存/, 'general settings should expose a save button');
assert.match(generalPanelBody.innerHTML, /浏览器通知/, 'general settings should expose browser notification status');
assert.match(generalPanelBody.innerHTML, /重新加载/, 'general settings should expose a reload button');

console.log('test-chat-general-settings-ui: ok');
