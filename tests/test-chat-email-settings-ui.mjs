#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const settingsUiSource = readFileSync(join(repoRoot, 'static/frontend/settings/ui.js'), 'utf8');
const emailUiSource = readFileSync(join(repoRoot, 'static/frontend/settings/email/ui.js'), 'utf8');

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

function makePanelBody() {
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

const emailPanelBody = makePanelBody();
const hooksOverlay = makeEventTarget();
hooksOverlay.hidden = true;
const hooksSettingsBtn = makeEventTarget();
const hooksOverlayClose = makeEventTarget();
const settingsTabGeneral = makeEventTarget();
settingsTabGeneral.dataset.settingsTab = 'general';
const settingsTabEmail = makeEventTarget();
settingsTabEmail.dataset.settingsTab = 'email';
const settingsTabHooks = makeEventTarget();
settingsTabHooks.dataset.settingsTab = 'hooks';
const settingsPanelGeneral = makeEventTarget();
settingsPanelGeneral.dataset.settingsPanel = 'general';
const settingsPanelEmail = makeEventTarget();
settingsPanelEmail.dataset.settingsPanel = 'email';
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
    case 'emailSettingsPanelBody':
      return emailPanelBody;
    case 'settingsTabGeneral':
      return settingsTabGeneral;
    case 'settingsTabEmail':
      return settingsTabEmail;
    case 'settingsTabHooks':
      return settingsTabHooks;
    case 'settingsPanelGeneral':
      return settingsPanelGeneral;
    case 'settingsPanelEmail':
      return settingsPanelEmail;
    case 'settingsPanelHooks':
      return settingsPanelHooks;
    default:
      return null;
  }
};
documentTarget.querySelectorAll = function querySelectorAll(selector) {
  if (selector === '[data-settings-tab]') {
    return [settingsTabGeneral, settingsTabEmail, settingsTabHooks];
  }
  if (selector === '[data-settings-panel]') {
    return [settingsPanelGeneral, settingsPanelEmail, settingsPanelHooks];
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
          appRoot: '/Users/test/vault/00-🤖agent',
          emailRoot: '/Users/test/vault/00-🤖agent/email',
          paths: {
            emailRoot: '/Users/test/vault/00-🤖agent/email',
            identityFile: '/Users/test/vault/00-🤖agent/email/identity.json',
            allowlistFile: '/Users/test/vault/00-🤖agent/email/allowlist.json',
            outboundFile: '/Users/test/vault/00-🤖agent/email/outbound.json',
            automationFile: '/Users/test/vault/00-🤖agent/email/automation.json',
          },
          identity: {
            name: 'Rowan',
            localPart: 'rowan',
            domain: 'example.com',
            address: 'rowan@example.com',
            description: 'Agent-facing mailbox identity for MelodySync collaboration.',
            instanceAddressMode: 'local_part',
          },
          allowlist: {
            allowedEmails: ['owner@example.com'],
            allowedDomains: ['example.com'],
          },
          outbound: {
            provider: 'apple_mail',
            account: 'Google',
            from: 'rowan@example.com',
          },
          automation: {
            enabled: true,
            allowlistAutoApprove: true,
            autoApproveReviewer: 'mailbox-auto-approve',
            chatBaseUrl: 'http://127.0.0.1:7760',
            authFile: '/Users/test/vault/00-🤖agent/config/auth.json',
            deliveryMode: 'reply_email',
          },
          counts: {
            review: 1,
            quarantine: 0,
            approved: 2,
          },
          effectiveStatus: 'ready_for_external_mail',
          options: {
            providers: [
              { value: 'apple_mail', label: 'Apple Mail' },
            ],
            deliveryModes: [
              { value: 'reply_email', label: '直接回信' },
              { value: 'session_only', label: '仅生成会话' },
            ],
            instanceAddressModes: [
              { value: 'plus', label: 'plus 地址' },
              { value: 'local_part', label: '本地地址' },
            ],
          },
        };
      },
    };
  },
};

context.window = context;
context.globalThis = context;

vm.runInNewContext(settingsUiSource, context, { filename: 'static/frontend/settings/ui.js' });
vm.runInNewContext(emailUiSource, context, { filename: 'static/frontend/settings/email/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
settingsTabEmail.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(fetchCalls.at(-1), '/api/settings/email');
assert.equal(settingsTabEmail.classList.contains('is-active'), true, 'email tab should become active');
assert.equal(settingsPanelEmail.hidden, false, 'email panel should be visible when selected');
assert.match(emailPanelBody.innerHTML, /Email 设置/, 'email settings should render the tab title');
assert.match(emailPanelBody.innerHTML, /邮箱身份/, 'email settings should render the identity section');
assert.match(emailPanelBody.innerHTML, /发送方式/, 'email settings should render the outbound section');
assert.match(emailPanelBody.innerHTML, /自动化/, 'email settings should render the automation section');
assert.match(emailPanelBody.innerHTML, /name="identityLocalPart"[^>]+value="rowan"/, 'email settings should expose the editable local-part field');
assert.match(emailPanelBody.innerHTML, /name="outboundProvider"/, 'email settings should expose the outbound provider selector');
assert.match(emailPanelBody.innerHTML, /邮箱目录：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/email<\/code>/, 'email settings should expose the app-root-backed email directory');
assert.match(emailPanelBody.innerHTML, /发送配置：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/email\/outbound\.json<\/code>/, 'email settings should expose the outbound config path');
assert.match(emailPanelBody.innerHTML, /允许名单：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/email\/allowlist\.json<\/code>/, 'email settings should expose the allowlist path');
assert.doesNotMatch(emailPanelBody.innerHTML, /Cloudflare Worker/, 'email settings should not expose the removed Cloudflare Worker provider');
assert.match(emailPanelBody.innerHTML, /队列：<\/strong>待审 1 · 隔离 0 · 已批准 2/, 'email settings should surface mailbox queue counts');

console.log('test-chat-email-settings-ui: ok');
