#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const realtimeSource = readFileSync(join(repoRoot, 'frontend-src', 'core', 'realtime.js'), 'utf8');

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing start token: ${startToken}`);
  }
  const end = source.indexOf(endToken, start);
  if (end === -1) {
    throw new Error(`Missing end token: ${endToken}`);
  }
  return source.slice(start, end);
}

function createBaseContext() {
  const context = {
    console: { ...console, error() {} },
    Date,
    JSON,
    Set,
    Map,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Promise,
    encodeURIComponent,
    currentSessionId: null,
    hasAttachedSession: false,
    sessions: [],
    window: {
      MelodySyncWorkbench: {
        refreshOperationRecord: async () => null,
      },
    },
  };
  context.globalThis = context;
  return context;
}

const dispatchActionSnippet = sliceBetween(
  realtimeSource,
  'async function dispatchAction',
  'function getCurrentSession',
);

const attachPromotedContext = createBaseContext();
let attachPromotedRenderCalls = 0;
let attachPromotedAttachCall = null;
let attachPromotedApplyCall = null;
let attachPromotedRefreshCurrentCalls = 0;
let attachPromotedRefreshSidebarCalls = 0;
let attachPromotedOperationRefreshCalls = 0;

attachPromotedContext.currentSessionId = 'session-source';
attachPromotedContext.fetchJsonOrRedirect = async () => ({
  session: {
    id: 'session-source',
    persistent: { kind: 'recurring_task' },
  },
});
attachPromotedContext.upsertSession = (session) => session;
attachPromotedContext.renderSessionList = () => {
  attachPromotedRenderCalls += 1;
};
attachPromotedContext.attachSession = (id, session) => {
  attachPromotedAttachCall = { id, session };
  attachPromotedContext.currentSessionId = id;
};
attachPromotedContext.applyAttachedSessionState = (id, session) => {
  attachPromotedApplyCall = { id, session };
};
attachPromotedContext.refreshCurrentSession = async () => {
  attachPromotedRefreshCurrentCalls += 1;
  return null;
};
attachPromotedContext.refreshSidebarSession = async () => {
  attachPromotedRefreshSidebarCalls += 1;
  return null;
};
attachPromotedContext.window.MelodySyncWorkbench.refreshOperationRecord = async () => {
  attachPromotedOperationRefreshCalls += 1;
};

vm.runInNewContext(dispatchActionSnippet, attachPromotedContext, {
  filename: 'chat-persistent-promote-runtime.js',
});

const attachPromotedAccepted = await attachPromotedContext.dispatchAction({
  action: 'persistent_promote',
  sessionId: 'session-source',
  kind: 'recurring_task',
});
assert.equal(attachPromotedAccepted, true, 'persistent promotion should resolve successfully');
assert.equal(attachPromotedRenderCalls, 1, 'persistent promotion should re-render the session list');
assert.equal(attachPromotedAttachCall, null, 'promoting the attached session should stay on the same session instead of jumping to a clone');
assert.deepEqual(
  attachPromotedApplyCall,
  {
    id: 'session-source',
    session: {
      id: 'session-source',
      persistent: { kind: 'recurring_task' },
    },
  },
  'promoting the attached session should refresh the current session in place',
);
assert.equal(attachPromotedRefreshCurrentCalls, 0, 'in-place persistent promotion should not need an extra session refresh');
assert.equal(attachPromotedRefreshSidebarCalls, 0, 'in-place persistent promotion should not fall back to sidebar-only refreshes');
assert.equal(attachPromotedOperationRefreshCalls, 1, 'persistent promotion should refresh the operation record once');
assert.equal(
  attachPromotedContext.currentSessionId,
  'session-source',
  'promoting the attached session should preserve the current session attachment',
);

const detachedPromoteContext = createBaseContext();
let detachedAttachCall = null;
let detachedApplyCall = null;
let detachedOperationRefreshCalls = 0;

detachedPromoteContext.currentSessionId = 'session-other';
detachedPromoteContext.fetchJsonOrRedirect = async () => ({
  session: {
    id: 'session-source',
    persistent: { kind: 'skill' },
  },
});
detachedPromoteContext.upsertSession = (session) => session;
detachedPromoteContext.renderSessionList = () => {};
detachedPromoteContext.attachSession = (id, session) => {
  detachedAttachCall = { id, session };
};
detachedPromoteContext.applyAttachedSessionState = (id, session) => {
  detachedApplyCall = { id, session };
};
detachedPromoteContext.refreshCurrentSession = async () => null;
detachedPromoteContext.refreshSidebarSession = async () => null;
detachedPromoteContext.window.MelodySyncWorkbench.refreshOperationRecord = async () => {
  detachedOperationRefreshCalls += 1;
};

vm.runInNewContext(dispatchActionSnippet, detachedPromoteContext, {
  filename: 'chat-persistent-promote-detached-runtime.js',
});

const detachedPromoteAccepted = await detachedPromoteContext.dispatchAction({
  action: 'persistent_promote',
  sessionId: 'session-source',
  kind: 'skill',
});
assert.equal(detachedPromoteAccepted, true, 'detached persistent promotion should still succeed');
assert.equal(detachedAttachCall, null, 'promoting some other session should not steal focus from the currently attached session');
assert.equal(detachedApplyCall, null, 'detached promotion should not rewrite the currently attached session state');
assert.equal(detachedOperationRefreshCalls, 1, 'detached persistent promotion should still refresh the operation record once');
assert.equal(
  detachedPromoteContext.currentSessionId,
  'session-other',
  'detached promotion should preserve the current session attachment',
);

console.log('test-chat-persistent-promote-flow: ok');
