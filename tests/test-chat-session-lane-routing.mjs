#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const bootstrapCatalogPath = existsSync(join(repoRoot, 'frontend-src', 'core', 'bootstrap-session-catalog.js'))
  ? join(repoRoot, 'frontend-src', 'core', 'bootstrap-session-catalog.js')
  : join(repoRoot, 'static', 'frontend', 'core', 'bootstrap-session-catalog.js');
const sessionHttpPath = existsSync(join(repoRoot, 'frontend-src', 'session', 'http.js'))
  ? join(repoRoot, 'frontend-src', 'session', 'http.js')
  : join(repoRoot, 'static', 'frontend', 'session', 'http.js');
const bootstrapCatalogSource = readFileSync(bootstrapCatalogPath, 'utf8');
const sessionHttpSource = readFileSync(sessionHttpPath, 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start + marker.length - 1);
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

const sessions = [
  {
    id: 'regular-session',
    name: '普通任务',
    updatedAt: '2026-04-10T09:00:00.000Z',
  },
  {
    id: 'long-term-root',
    name: 'MelodySync',
    updatedAt: '2026-04-10T10:00:00.000Z',
    persistent: {
      kind: 'recurring_task',
    },
  },
  {
    id: 'long-term-branch',
    name: '长期维护支线',
    updatedAt: '2026-04-10T10:20:00.000Z',
    rootSessionId: 'long-term-root',
    sourceContext: {
      parentSessionId: 'long-term-root',
    },
  },
  {
    id: 'explicit-long-term-root',
    name: '显式长期项目',
    updatedAt: '2026-04-10T10:40:00.000Z',
    taskPoolMembership: {
      longTerm: {
        role: 'project',
        projectSessionId: 'explicit-long-term-root',
        fixedNode: true,
      },
    },
  },
  {
    id: 'explicit-long-term-member',
    name: '显式长期成员',
    updatedAt: '2026-04-10T10:50:00.000Z',
    taskPoolMembership: {
      longTerm: {
        role: 'member',
        projectSessionId: 'explicit-long-term-root',
      },
    },
  },
];

const context = {
  console,
  sessions,
  activeTab: 'long-term',
  currentSessionId: 'regular-session',
  pendingNavigationState: null,
  normalizeSidebarTab(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    return ['long-term', 'longterm', 'persistent', 'recurring'].includes(normalized)
      ? 'long-term'
      : 'sessions';
  },
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(`
  ${extractFunctionSource(bootstrapCatalogSource, 'getSessionCatalogRecordById')}
  ${extractFunctionSource(bootstrapCatalogSource, 'normalizeCatalogPersistentKind')}
  ${extractFunctionSource(bootstrapCatalogSource, 'getCatalogLongTermTaskPoolMembership')}
  ${extractFunctionSource(bootstrapCatalogSource, 'isLongTermProjectRootSession')}
  ${extractFunctionSource(bootstrapCatalogSource, 'resolveLongTermProjectRootSessionId')}
  ${extractFunctionSource(bootstrapCatalogSource, 'getSidebarTabForSession')}
  ${extractFunctionSource(bootstrapCatalogSource, 'sessionMatchesSidebarTab')}
  ${extractFunctionSource(bootstrapCatalogSource, 'getLatestSessionForSidebarTab')}
  ${extractFunctionSource(bootstrapCatalogSource, 'getLatestActiveSessionForSidebarTab')}
  ${extractFunctionSource(bootstrapCatalogSource, 'resolveRestoreTargetSession')}
  globalThis.resolveRestoreTargetSession = resolveRestoreTargetSession;
  globalThis.resolveLongTermProjectRootSessionId = resolveLongTermProjectRootSessionId;
`, context, {
  filename: 'frontend-src/core/bootstrap-session-catalog.js',
});

assert.equal(
  context.resolveRestoreTargetSession()?.id,
  'long-term-root',
  'long-term tab restore should not jump back into the last ordinary session',
);

context.currentSessionId = 'long-term-branch';
assert.equal(
  context.resolveRestoreTargetSession()?.id,
  'long-term-root',
  'long-term tab restore should reopen the owning long-term project instead of its maintenance branch',
);

context.activeTab = 'sessions';
context.currentSessionId = 'regular-session';
assert.equal(
  context.resolveRestoreTargetSession()?.id,
  'regular-session',
  'sessions tab restore should still keep the last ordinary task when it matches the active lane',
);
assert.equal(
  context.resolveLongTermProjectRootSessionId(sessions.find((entry) => entry.id === 'explicit-long-term-member')),
  'explicit-long-term-root',
  'bootstrap long-term routing should prefer explicit task-pool membership over legacy lineage inference',
);

vm.runInNewContext(`
  ${extractFunctionSource(sessionHttpSource, 'getSessionRecordForHttp')}
  ${extractFunctionSource(sessionHttpSource, 'normalizePersistentKindForHttp')}
  ${extractFunctionSource(sessionHttpSource, 'getLongTermTaskPoolMembershipForHttp')}
  ${extractFunctionSource(sessionHttpSource, 'resolveLongTermProjectRootSessionIdForHttp')}
  ${extractFunctionSource(sessionHttpSource, 'getSidebarTabForSessionHttp')}
  ${extractFunctionSource(sessionHttpSource, 'getSidebarTabForSessionId')}
  ${extractFunctionSource(sessionHttpSource, 'getCompletionNavigationTarget')}
  globalThis.getSidebarTabForSessionId = getSidebarTabForSessionId;
  globalThis.getCompletionNavigationTarget = getCompletionNavigationTarget;
`, context, {
  filename: 'frontend-src/session/http.js',
});

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getCompletionNavigationTarget('long-term-branch'))),
  {
    sessionId: 'long-term-root',
    tab: 'long-term',
  },
  'completion routing should take long-term maintenance branches back to the owning long-term project',
);
assert.equal(
  context.getSidebarTabForSessionId('long-term-branch'),
  'long-term',
  'completion lane inference should classify long-term maintenance branches into the long-term tab',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getCompletionNavigationTarget('regular-session'))),
  {
    sessionId: 'regular-session',
    tab: 'sessions',
  },
  'ordinary task completions should keep routing back into the sessions tab',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.getCompletionNavigationTarget('explicit-long-term-member'))),
  {
    sessionId: 'explicit-long-term-root',
    tab: 'long-term',
  },
  'completion routing should also honor explicit task-pool membership for long-term members',
);

console.log('test-chat-session-lane-routing: ok');
