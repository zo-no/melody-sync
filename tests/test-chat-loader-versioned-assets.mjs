#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const loaderSource = readFileSync(join(repoRoot, 'frontend.js'), 'utf8');

function createScriptElement() {
  return {
    src: '',
    async: true,
    nonce: '',
    onload: null,
    onerror: null,
  };
}

function createLinkElement() {
  return {
    rel: '',
    as: '',
    href: '',
    nonce: '',
  };
}

function createContext({ inlineAssetVersion = '' } = {}) {
  const fetchCalls = [];
  const scriptLoads = [];
  const preloadLoads = [];
  const loggedErrors = [];

  const context = {
    URL,
    encodeURIComponent,
    Promise,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    fetchCalls,
    scriptLoads,
    preloadLoads,
    loggedErrors,
    console: {
      error(...args) {
        loggedErrors.push(args.join(' '));
      },
      info() {},
      log() {},
      warn() {},
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      return {
        ok: true,
        async json() {
          return { assetVersion: 'build-123' };
        },
      };
    },
    window: {
      __MELODYSYNC_BUILD__: inlineAssetVersion ? { assetVersion: inlineAssetVersion } : undefined,
      location: {
        href: 'http://127.0.0.1/',
        origin: 'http://127.0.0.1',
      },
    },
    document: {
      currentScript: {
        nonce: 'test-nonce',
        src: 'http://127.0.0.1/chat.js',
      },
      head: {
        appendChild(element) {
          if (element.src) {
            scriptLoads.push(element.src);
            queueMicrotask(() => element.onload?.());
            return element;
          }
          if (element.href) {
            preloadLoads.push(element.href);
            return element;
          }
          throw new Error('unexpected appended element');
        },
      },
      createElement(tagName) {
        if (tagName === 'script') return createScriptElement();
        if (tagName === 'link') return createLinkElement();
        throw new Error(`unexpected element: ${tagName}`);
      },
    },
  };

  context.globalThis = context;
  context.self = context;
  return context;
}

async function waitForLoaderWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const expectedBuild123Assets = [
  '/marked.min.js?v=build-123',
  '/chat/core/i18n.js?v=build-123',
  '/chat/session-list/order-contract.js?v=build-123',
  '/chat/session/state-model.js?v=build-123',
  '/chat/core/icons.js?v=build-123',
  '/chat/core/app-state.js?v=build-123',
  '/chat/core/bootstrap.js?v=build-123',
  '/chat/core/bootstrap-session-catalog.js?v=build-123',
  '/chat/session-list/contract.js?v=build-123',
  '/chat/session/http-helpers.js?v=build-123',
  '/chat/session/http-list-state.js?v=build-123',
  '/chat/session/http.js?v=build-123',
  '/chat/core/layout-tooling.js?v=build-123',
  '/chat/session/tooling.js?v=build-123',
  '/chat/core/realtime.js?v=build-123',
  '/chat/core/realtime-render.js?v=build-123',
  '/chat/session/transcript-ui.js?v=build-123',
  '/chat/session/surface-ui.js?v=build-123',
  '/chat/session-list/model.js?v=build-123',
  '/chat/workbench/task-map-react.bundle.js?v=build-123',
  '/chat/session-list/react-ui.js?v=build-123',
  '/chat/session-list/ui.js?v=build-123',
  '/chat/session-list/sidebar-ui.js?v=build-123',
  '/chat/workbench/node-contract.js?v=build-123',
  '/chat/workbench/task-run-status.js?v=build-123',
  '/chat/workbench/node-effects.js?v=build-123',
  '/chat/workbench/node-instance.js?v=build-123',
  '/chat/workbench/graph-model.js?v=build-123',
  '/chat/workbench/node-capabilities.js?v=build-123',
  '/chat/workbench/node-task-card.js?v=build-123',
  '/chat/workbench/graph-client.js?v=build-123',
  '/chat/settings/nodes/model.js?v=build-123',
  '/chat/workbench/task-map-plan.js?v=build-123',
  '/chat/workbench/surface-projection.js?v=build-123',
  '/chat/workbench/task-map-clusters.js?v=build-123',
  '/chat/workbench/task-map-mock-presets.js?v=build-123',
  '/chat/workbench/task-map-model.js?v=build-123',
  '/chat/workbench/quest-state.js?v=build-123',
  '/chat/workbench/task-tracker-ui.js?v=build-123',
  '/chat/workbench/node-rich-view-ui.js?v=build-123',
  '/chat/workbench/node-canvas-ui.js?v=build-123',
  '/chat/workbench/task-map-ui.js?v=build-123',
  '/chat/workbench/task-list-ui.js?v=build-123',
  '/chat/workbench/status-card-ui.js?v=build-123',
  '/chat/workbench/persistent-editor-ui.js?v=build-123',
  '/chat/workbench/operation-record-summary-ui.js?v=build-123',
  '/chat/workbench/operation-record-list-ui.js?v=build-123',
  '/chat/workbench/branch-actions.js?v=build-123',
  '/chat/workbench/operation-record-ui.js?v=build-123',
  '/chat/panzoom.min.js?v=build-123',
  '/chat/workbench/controller.js?v=build-123',
  '/chat/session/compose.js?v=build-123',
  '/chat/core/gestures.js?v=build-123',
  '/chat/settings/ui.js?v=build-123',
  '/chat/settings/hooks/model.js?v=build-123',
  '/chat/settings/general/model.js?v=build-123',
  '/chat/settings/email/model.js?v=build-123',
  '/chat/settings/voice/model.js?v=build-123',
  '/chat/settings/general/ui.js?v=build-123',
  '/chat/settings/email/ui.js?v=build-123',
  '/chat/settings/voice/ui.js?v=build-123',
  '/chat/settings/nodes/ui.js?v=build-123',
  '/chat/settings/hooks/ui.js?v=build-123',
  '/chat/core/init.js?v=build-123',
];

const expectedInlineAssets = expectedBuild123Assets.map((path) => path.replace('build-123', 'inline-build-456'));

const fallbackContext = createContext();
vm.runInNewContext(loaderSource, fallbackContext, { filename: 'frontend.js' });
await waitForLoaderWork();

assert.equal(
  fallbackContext.fetchCalls.length,
  1,
  'compatibility loader should resolve the current asset version before loading split assets',
);
assert.equal(fallbackContext.fetchCalls[0]?.url, '/api/build-info');
assert.equal(fallbackContext.fetchCalls[0]?.options?.credentials, 'same-origin');
assert.equal(fallbackContext.fetchCalls[0]?.options?.cache, 'no-store');
assert.deepEqual(
  fallbackContext.preloadLoads,
  expectedBuild123Assets,
  'compatibility loader should preload the full split frontend asset chain before executing it',
);
assert.deepEqual(
  fallbackContext.scriptLoads,
  expectedBuild123Assets,
  'compatibility loader should version-pin the full split frontend asset chain',
);
assert.deepEqual(fallbackContext.loggedErrors, [], 'compatibility loader should not log load errors during the happy path');

const inlineContext = createContext({ inlineAssetVersion: 'inline-build-456' });
vm.runInNewContext(loaderSource, inlineContext, { filename: 'frontend.js' });
await waitForLoaderWork();

assert.deepEqual(
  inlineContext.fetchCalls,
  [],
  'inline build info should let the compatibility loader skip the build-info roundtrip',
);
assert.deepEqual(
  inlineContext.preloadLoads,
  expectedInlineAssets,
  'inline build info should also keep preload hints on the matching version',
);
assert.deepEqual(
  inlineContext.scriptLoads,
  expectedInlineAssets,
  'compatibility loader should reuse inline build info to keep split assets on the same version',
);

console.log('test-chat-loader-versioned-assets: ok');
