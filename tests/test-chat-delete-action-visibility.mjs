#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const surfaceUiSource = readFileSync(join(repoRoot, 'frontend/session/surface-ui.js'), 'utf8');
const sessionListUiSource = readFileSync(join(repoRoot, 'frontend/session-list/ui.js'), 'utf8');

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

const buildSessionActionConfigsSnippet = sliceBetween(
  surfaceUiSource,
  'function buildSessionActionConfigs',
  'function createActiveSessionItem',
);
const buildSidebarSessionActionsSnippet = sliceBetween(
  sessionListUiSource,
  'function buildSidebarSessionActions',
  'function createSidebarSessionItem',
);

const context = {
  console,
  Array,
  Object,
  Boolean,
  String,
  Number,
  markSessionReviewed() {},
  getSessionReviewStatusInfo() {
    return null;
  },
  getSessionActivity() {
    return {
      run: { state: 'idle' },
      compact: { state: 'idle' },
      queue: { count: 0 },
    };
  },
  canRunSidebarQuickAction() {
    return false;
  },
  dispatchAction() {},
  window: {},
  t(key) {
    return key;
  },
};
context.globalThis = context;

vm.runInNewContext(buildSessionActionConfigsSnippet, context, {
  filename: 'chat-surface-actions-runtime.js',
});

const activeActions = context.buildSessionActionConfigs({
  id: 'session-active',
  archived: false,
});
assert.equal(
  activeActions.some((entry) => entry?.action === 'delete'),
  false,
  'active sessions should not expose a delete action',
);
assert.equal(
  activeActions.some((entry) => entry?.action === 'archive'),
  true,
  'active sessions should still expose archive',
);

const archivedActions = context.buildSessionActionConfigs({
  id: 'session-archived',
  archived: true,
});
assert.equal(
  archivedActions.some((entry) => entry?.action === 'delete'),
  true,
  'archived sessions should still expose delete',
);

vm.runInNewContext(buildSidebarSessionActionsSnippet, context, {
  filename: 'chat-sidebar-actions-runtime.js',
});

context.buildSessionActionConfigs = () => [
  { action: 'delete', key: 'delete' },
  { action: 'archive', key: 'archive' },
];

const filteredActiveSidebarActions = context.buildSidebarSessionActions({
  id: 'session-active',
  archived: false,
}, { archived: false });
assert.equal(
  filteredActiveSidebarActions.some((entry) => entry?.action === 'delete'),
  false,
  'sidebar should defensively filter delete from non-archived sessions',
);

const archivedSidebarActions = context.buildSidebarSessionActions({
  id: 'session-archived',
  archived: true,
}, { archived: true });
assert.equal(
  archivedSidebarActions.some((entry) => entry?.action === 'delete'),
  true,
  'sidebar should preserve delete for archived sessions',
);

console.log('test-chat-delete-action-visibility: ok');
