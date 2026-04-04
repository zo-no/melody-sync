#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const settingsUiSource = readFileSync(join(repoRoot, 'static/frontend/settings/ui.js'), 'utf8');
const voiceUiSource = readFileSync(join(repoRoot, 'static/frontend/settings/voice/ui.js'), 'utf8');

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

const voicePanelBody = makePanelBody();
const hooksOverlay = makeEventTarget();
hooksOverlay.hidden = true;
const hooksSettingsBtn = makeEventTarget();
const hooksOverlayClose = makeEventTarget();
const settingsTabGeneral = makeEventTarget();
settingsTabGeneral.dataset.settingsTab = 'general';
const settingsTabEmail = makeEventTarget();
settingsTabEmail.dataset.settingsTab = 'email';
const settingsTabVoice = makeEventTarget();
settingsTabVoice.dataset.settingsTab = 'voice';
const settingsTabHooks = makeEventTarget();
settingsTabHooks.dataset.settingsTab = 'hooks';
const settingsPanelGeneral = makeEventTarget();
settingsPanelGeneral.dataset.settingsPanel = 'general';
const settingsPanelEmail = makeEventTarget();
settingsPanelEmail.dataset.settingsPanel = 'email';
const settingsPanelVoice = makeEventTarget();
settingsPanelVoice.dataset.settingsPanel = 'voice';
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
    case 'voiceSettingsPanelBody':
      return voicePanelBody;
    case 'settingsTabGeneral':
      return settingsTabGeneral;
    case 'settingsTabEmail':
      return settingsTabEmail;
    case 'settingsTabVoice':
      return settingsTabVoice;
    case 'settingsTabHooks':
      return settingsTabHooks;
    case 'settingsPanelGeneral':
      return settingsPanelGeneral;
    case 'settingsPanelEmail':
      return settingsPanelEmail;
    case 'settingsPanelVoice':
      return settingsPanelVoice;
    case 'settingsPanelHooks':
      return settingsPanelHooks;
    default:
      return null;
  }
};
documentTarget.querySelectorAll = function querySelectorAll(selector) {
  if (selector === '[data-settings-tab]') {
    return [settingsTabGeneral, settingsTabEmail, settingsTabVoice, settingsTabHooks];
  }
  if (selector === '[data-settings-panel]') {
    return [settingsPanelGeneral, settingsPanelEmail, settingsPanelVoice, settingsPanelHooks];
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
          voiceRoot: '/Users/test/vault/00-🤖agent/voice',
          paths: {
            voiceRoot: '/Users/test/vault/00-🤖agent/voice',
            configFile: '/Users/test/vault/00-🤖agent/voice/config.json',
            logsDir: '/Users/test/vault/00-🤖agent/voice/logs',
            eventsLogFile: '/Users/test/vault/00-🤖agent/voice/events.jsonl',
            pidFile: '/Users/test/vault/00-🤖agent/voice/connector.pid',
            runtimeLogFile: '/Users/test/vault/00-🤖agent/voice/logs/connector.log',
            launcherFile: '/Users/test/vault/00-🤖agent/voice/start-connector-terminal.sh',
          },
          config: {
            connectorId: 'voice-main',
            chatBaseUrl: 'http://127.0.0.1:7760',
            sessionMode: 'stable',
            wake: {
              mode: 'command',
              keyword: '小罗小罗',
              command: 'bash scripts/voice-managed-wake.sh',
            },
            capture: {
              command: 'bash scripts/voice-managed-capture.sh',
              timeoutMs: 90000,
            },
            stt: {
              command: '',
              timeoutMs: 120000,
            },
            tts: {
              enabled: true,
              mode: 'say',
              voice: '',
              rate: 185,
              command: '',
              timeoutMs: 120000,
            },
          },
          simpleConfig: {
            mode: 'wake',
            wakePhrase: '小罗小罗',
            ttsEnabled: true,
          },
          status: {
            running: false,
            pid: '',
            label: '未运行',
          },
          commands: {
            start: './scripts/voice-connector-instance.sh start',
            stop: './scripts/voice-connector-instance.sh stop',
            status: './scripts/voice-connector-instance.sh status',
            testText: 'npm run voice:connect -- --config "/Users/test/vault/00-🤖agent/voice/config.json" --text "你好" --no-speak',
          },
          options: {
            simpleModes: [
              { value: 'disabled', label: '关闭' },
              { value: 'passive', label: '持续聆听' },
              { value: 'wake', label: '唤醒词模式' },
            ],
          },
          hints: {
            passive: {
              title: '持续聆听',
              description: '一直监听，任何一句完整说话都会发进 MelodySync。',
              requirements: ['需要本机 ASR Python 环境：/Users/test/.tmp/asr-venv/bin/python'],
            },
            wake: {
              title: '唤醒词模式',
              description: '一直监听，但只有听到唤醒词后才会提交消息。',
              requirements: ['需要 macOS 麦克风和语音识别权限'],
            },
          },
        };
      },
    };
  },
};

context.window = context;
context.globalThis = context;

vm.runInNewContext(settingsUiSource, context, { filename: 'static/frontend/settings/ui.js' });
vm.runInNewContext(voiceUiSource, context, { filename: 'static/frontend/settings/voice/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
settingsTabVoice.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(fetchCalls.at(-1), '/api/settings/voice');
assert.equal(settingsTabVoice.classList.contains('is-active'), true, 'voice tab should become active');
assert.equal(settingsPanelVoice.hidden, false, 'voice panel should be visible when selected');
assert.match(voicePanelBody.innerHTML, /Voice 设置/, 'voice settings should render the tab title');
assert.match(voicePanelBody.innerHTML, /监听方式/, 'voice settings should render the simplified mode section');
assert.match(voicePanelBody.innerHTML, /唤醒词模式/, 'voice settings should render the mode description');
assert.match(voicePanelBody.innerHTML, /本地状态/, 'voice settings should render the local-state section');
assert.match(voicePanelBody.innerHTML, /name="mode"/, 'voice settings should expose the simplified mode selector');
assert.doesNotMatch(voicePanelBody.innerHTML, /启动：/, 'voice settings should not expose raw command lines');
assert.match(voicePanelBody.innerHTML, /name="wakePhrase"[^>]+value="小罗小罗"/, 'voice settings should expose the wake phrase field in wake mode');
assert.doesNotMatch(voicePanelBody.innerHTML, /Connector ID/, 'voice settings should hide connector implementation details');
assert.doesNotMatch(voicePanelBody.innerHTML, /会话工具/, 'voice settings should hide session tool fields');
assert.doesNotMatch(voicePanelBody.innerHTML, /唤醒命令/, 'voice settings should hide raw command fields');
assert.match(voicePanelBody.innerHTML, /语音目录：<\/strong><code>\/Users\/test\/vault\/00-🤖agent\/voice<\/code>/, 'voice settings should expose the app-root-backed voice directory');
assert.match(voicePanelBody.innerHTML, /当前状态：<\/strong>未运行/, 'voice settings should surface the current connector status');

console.log('test-chat-voice-settings-ui: ok');
