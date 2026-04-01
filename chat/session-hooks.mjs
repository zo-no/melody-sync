/**
 * session-hooks.mjs
 *
 * Unified session lifecycle hook system for MelodySync.
 *
 * Supported events:
 *   session.created  — after a new session is persisted
 *   run.started      — after the detached runner process is spawned
 *   run.completed    — after a run finishes successfully
 *   run.failed       — after a run is cancelled or errors out
 *
 * All hooks receive a typed context object and run in parallel via
 * Promise.allSettled — a failing hook never blocks others or the main path.
 *
 * Registering a hook:
 *   import { registerHook } from './session-hooks.mjs';
 *   registerHook('run.completed', myHook);
 *   registerHook('run.*', myHook);   // wildcard — all run events
 *   registerHook('*', myHook);       // all events
 *
 * Hook signature:
 *   (ctx: HookContext) => Promise<void>
 */

import { sendCompletionPush } from './push.mjs';
import { syncSessionContinuityFromSession } from './workbench-store.mjs';
import {
  dispatchSessionEmailCompletionTargets,
  sanitizeEmailCompletionTargets,
} from '../lib/agent-mail-completion-targets.mjs';

// ─── Event catalogue ─────────────────────────────────────────────────────────

/**
 * All valid event names. Extend here when adding new lifecycle points.
 * @type {readonly string[]}
 */
export const HOOK_EVENTS = Object.freeze([
  'session.created',
  'run.started',
  'run.completed',
  'run.failed',
]);

// ─── Context types (JSDoc only — no runtime overhead) ────────────────────────

/**
 * @typedef {Object} BaseContext
 * @property {string} event          - The lifecycle event name
 * @property {string} sessionId
 * @property {object|null} session   - Full session object (may be null for run.started)
 * @property {object|null} manifest  - Run manifest (null for session.created)
 */

/**
 * @typedef {BaseContext & { run: object, events: object[], taskCard: object|null }} RunContext
 * Context for run.completed and run.failed.
 */

/**
 * @typedef {BaseContext} SessionCreatedContext
 * Context for session.created.
 */

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Map from event pattern → list of hook functions.
 * Patterns: exact event name, 'run.*', or '*'.
 * @type {Map<string, Array<(ctx: BaseContext) => Promise<void>>>}
 */
const registry = new Map();

/**
 * Register a hook for one or more lifecycle events.
 *
 * @param {string} eventPattern  Exact event ('run.completed'), namespace wildcard ('run.*'), or '*'
 * @param {(ctx: BaseContext) => Promise<void>} hook
 * @param {object} [meta]        Optional metadata: { id, label, description, builtIn }
 */
export function registerHook(eventPattern, hook, meta = {}) {
  if (typeof hook !== 'function') return;
  if (!registry.has(eventPattern)) registry.set(eventPattern, []);
  // Attach metadata directly to the function for introspection
  hook._hookMeta = {
    id: meta.id || hook.name || 'anonymous',
    label: meta.label || hook.name || 'Anonymous hook',
    description: meta.description || '',
    builtIn: meta.builtIn === true,
    eventPattern,
    enabled: true,
  };
  registry.get(eventPattern).push(hook);
}

/**
 * Return all registered hooks as a flat list (for the settings UI).
 * @returns {Array<{ id, label, description, builtIn, eventPattern, enabled }>}
 */
export function listHooks() {
  const result = [];
  for (const hooks of registry.values()) {
    for (const hook of hooks) {
      if (hook._hookMeta) result.push({ ...hook._hookMeta });
    }
  }
  return result;
}

/**
 * Enable or disable a hook by id.
 * @param {string} hookId
 * @param {boolean} enabled
 * @returns {boolean} whether the hook was found
 */
export function setHookEnabled(hookId, enabled) {
  for (const hooks of registry.values()) {
    for (const hook of hooks) {
      if (hook._hookMeta?.id === hookId) {
        hook._hookMeta.enabled = Boolean(enabled);
        return true;
      }
    }
  }
  return false;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Collect all hooks that should run for a given event.
 * Matches: exact pattern, namespace wildcard ('run.*'), and '*'.
 * @param {string} event
 * @returns {Array<(ctx: BaseContext) => Promise<void>>}
 */
function collectHooks(event) {
  const matched = [];
  const [namespace] = event.split('.');
  const wildcardNs = `${namespace}.*`;

  for (const [pattern, hooks] of registry.entries()) {
    if (pattern === event || pattern === wildcardNs || pattern === '*') {
      for (const hook of hooks) {
        if (hook._hookMeta?.enabled !== false) matched.push(hook);
      }
    }
  }
  return matched;
}

/**
 * Emit a lifecycle event and run all matching hooks in parallel.
 * Never throws — errors are logged per-hook.
 *
 * @param {string} event
 * @param {Partial<BaseContext>} ctx
 */
export async function emit(event, ctx) {
  const hooks = collectHooks(event);
  if (hooks.length === 0) return;

  const fullCtx = { event, ...ctx };
  const results = await Promise.allSettled(hooks.map((hook) => hook(fullCtx)));

  for (const result of results) {
    if (result.status === 'rejected') {
      const hookId = result.reason?._hookId || '?';
      console.error(
        `[session-hooks] ${event} ${ctx.sessionId || ''}: ${result.reason?.message ?? result.reason}`,
      );
    }
  }
}

// ─── Built-in hooks ──────────────────────────────────────────────────────────

async function pushNotificationHook({ sessionId, session }) {
  await sendCompletionPush({ ...session, id: sessionId }).catch(() => {});
}

async function emailCompletionHook({ sessionId, run, session, manifest }) {
  if (!session?.id || !run?.id || manifest?.internalOperation) return;
  const targets = sanitizeEmailCompletionTargets(session.completionTargets || []);
  if (targets.length === 0) return;
  await dispatchSessionEmailCompletionTargets(
    { ...session, completionTargets: targets },
    run,
  ).catch((err) => {
    console.error(`[session-hooks] email ${sessionId}/${run.id}: ${err.message}`);
  });
}

async function workbenchSyncHook({ sessionId, session }) {
  if (!session) return;
  await syncSessionContinuityFromSession(session).catch((err) => {
    console.error(`[session-hooks] workbench-sync ${sessionId}: ${err.message}`);
  });
}

// Register built-ins
registerHook('run.completed', pushNotificationHook, {
  id: 'builtin.push-notification',
  label: '推送通知',
  description: 'Run 完成后发送推送通知',
  builtIn: true,
});

registerHook('run.completed', emailCompletionHook, {
  id: 'builtin.email-completion',
  label: 'Email 通知',
  description: 'Run 完成后发送 email（需配置 completionTargets）',
  builtIn: true,
});

registerHook('run.completed', workbenchSyncHook, {
  id: 'builtin.workbench-sync',
  label: '地图同步',
  description: 'Run 完成后将 taskCard 同步到任务地图',
  builtIn: true,
});

registerHook('run.failed', workbenchSyncHook, {
  id: 'builtin.workbench-sync-on-fail',
  label: '地图同步（失败时）',
  description: 'Run 失败/取消时也同步地图状态',
  builtIn: true,
});
