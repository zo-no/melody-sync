#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpPath = existsSync(join(repoRoot, 'frontend-src', 'session', 'http.js'))
  ? join(repoRoot, 'frontend-src', 'session', 'http.js')
  : join(repoRoot, 'frontend', 'session', 'http.js');
const sessionHttpSource = readFileSync(sessionHttpPath, 'utf8');

function extractFunctionSource(source, functionName) {
  const markers = [`async function ${functionName}(`, `function ${functionName}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const setupSnippet = `
${extractFunctionSource(sessionHttpSource, 'normalizePushApplicationServerKey')}
${extractFunctionSource(sessionHttpSource, 'pushApplicationServerKeysMatch')}
${extractFunctionSource(sessionHttpSource, 'setupPushNotifications')}
globalThis.setupPushNotifications = setupPushNotifications;
`;

function createHarness({ existingSubscription }) {
  const fetchCalls = [];
  const subscriptionPayload = { endpoint: existingSubscription ? 'https://push.example/existing' : 'https://push.example/new' };
  const subscribeCalls = [];
  const applicationServerKey = new Uint8Array([1, 2, 3, 4]);
  const registration = {
    update() {
      return Promise.resolve();
    },
    installing: { postMessage() {} },
    waiting: { postMessage() {} },
    active: { postMessage() {} },
    pushManager: {
      getSubscription() {
        return Promise.resolve(existingSubscription
          ? {
              options: {
                applicationServerKey,
              },
              unsubscribe() {
                return Promise.resolve();
              },
              toJSON() {
                return subscriptionPayload;
              },
            }
          : null);
      },
      subscribe(options) {
        subscribeCalls.push(options);
        return Promise.resolve({
          toJSON() {
            return subscriptionPayload;
          },
        });
      },
    },
  };
  const context = {
    console,
    JSON,
    Promise,
    encodeURIComponent,
    buildAssetVersion: 'build-test',
    navigator: {
      serviceWorker: {
        register() {
          return Promise.resolve(registration);
        },
        ready: Promise.resolve(registration),
      },
    },
    window: {
      PushManager: function PushManager() {},
    },
    fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      if (url === '/api/push/vapid-public-key') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ publicKey: 'BEl6Y3Rlc3RLZXk' }),
        });
      }
      if (url === '/api/push/subscribe') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    urlBase64ToUint8Array(value) {
      return value === 'BEl6Y3Rlc3RLZXk' ? applicationServerKey : new Uint8Array();
    },
  };
  vm.runInNewContext(setupSnippet, context, { filename: 'setupPushNotifications.vm' });
  return {
    fetchCalls,
    subscribeCalls,
    setupPushNotifications: context.setupPushNotifications,
  };
}

const existingHarness = createHarness({ existingSubscription: true });
await existingHarness.setupPushNotifications();
assert.equal(existingHarness.subscribeCalls.length, 0, 'existing subscriptions should not request a new browser subscription');
assert.deepEqual(existingHarness.fetchCalls.map((entry) => entry.url), [
  '/api/push/vapid-public-key',
  '/api/push/subscribe',
], 'existing subscriptions should validate the current VAPID key before syncing back to the backend');
assert.deepEqual(JSON.parse(existingHarness.fetchCalls[1].options.body), {
  endpoint: 'https://push.example/existing',
}, 'existing subscription sync should post the current subscription payload');

const freshHarness = createHarness({ existingSubscription: false });
await freshHarness.setupPushNotifications();
assert.equal(freshHarness.subscribeCalls.length, 1, 'missing subscriptions should request a new browser subscription');
assert.deepEqual(freshHarness.fetchCalls.map((entry) => entry.url), [
  '/api/push/vapid-public-key',
  '/api/push/subscribe',
], 'fresh subscriptions should fetch the VAPID key and persist the new subscription');
assert.deepEqual(JSON.parse(freshHarness.fetchCalls[1].options.body), {
  endpoint: 'https://push.example/new',
}, 'new subscription sync should post the subscribed payload');

console.log('test-session-http-push-registration: ok');
