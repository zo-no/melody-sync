/**
 * Unified session lifecycle hook registry for MelodySync.
 *
 * This module is intentionally business-free: it only knows how to register,
 * list, enable/disable, and emit lifecycle hooks.
 */

export const HOOK_EVENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'session.created',
    label: 'Session 创建后',
    description: '新 session 完成初始化并写入 metadata 之后。',
  }),
  Object.freeze({
    id: 'run.started',
    label: 'Run 启动后',
    description: '新的 detached run 建立并进入执行流程之后。',
  }),
  Object.freeze({
    id: 'run.completed',
    label: 'Run 完成后',
    description: 'Run 成功完成并且结果已经回写之后。',
  }),
  Object.freeze({
    id: 'run.failed',
    label: 'Run 失败/取消后',
    description: 'Run 失败、终止或取消之后。',
  }),
]);

/**
 * All valid event names. Extend HOOK_EVENT_DEFINITIONS when adding new lifecycle points.
 * @type {readonly string[]}
 */
export const HOOK_EVENTS = Object.freeze(
  HOOK_EVENT_DEFINITIONS.map((definition) => definition.id),
);

export function listHookEventDefinitions() {
  return HOOK_EVENT_DEFINITIONS.map((definition) => ({ ...definition }));
}

/**
 * @typedef {Object} BaseContext
 * @property {string} event
 * @property {string} sessionId
 * @property {object|null} session
 * @property {object|null} manifest
 */

/**
 * Map from event pattern -> list of hook entries.
 * Patterns: exact event name, 'run.*', or '*'.
 * @type {Map<string, Array<{ fn: (ctx: BaseContext) => Promise<void>, meta: object }>>}
 */
const registry = new Map();

export function registerHook(eventPattern, hook, meta = {}) {
  if (typeof hook !== 'function') return;
  if (!registry.has(eventPattern)) registry.set(eventPattern, []);
  const entry = {
    fn: hook,
    meta: {
      ...meta,
      id: meta.id || hook.name || 'anonymous',
      label: meta.label || hook.name || 'Anonymous hook',
      description: meta.description || '',
      builtIn: meta.builtIn === true,
      eventPattern,
      enabled: meta.enabled !== false,
    },
  };
  registry.get(eventPattern).push(entry);
}

export function listHooks() {
  const result = [];
  for (const entries of registry.values()) {
    for (const entry of entries) {
      result.push({ ...entry.meta });
    }
  }
  return result;
}

export function setHookEnabled(hookId, enabled) {
  for (const entries of registry.values()) {
    for (const entry of entries) {
      if (entry.meta?.id === hookId) {
        entry.meta.enabled = Boolean(enabled);
        return true;
      }
    }
  }
  return false;
}

function collectHooks(event) {
  const matched = [];
  const [namespace] = event.split('.');
  const wildcardNs = `${namespace}.*`;

  for (const [pattern, entries] of registry.entries()) {
    if (pattern === event || pattern === wildcardNs || pattern === '*') {
      for (const entry of entries) {
        if (entry.meta?.enabled !== false) matched.push(entry.fn);
      }
    }
  }
  return matched;
}

export async function emit(event, ctx) {
  const hooks = collectHooks(event);
  if (hooks.length === 0) return;

  const fullCtx = { event, ...ctx };
  const results = await Promise.allSettled(hooks.map((hook) => hook(fullCtx)));

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        `[session-hooks] ${event} ${ctx.sessionId || ''}: ${result.reason?.message ?? result.reason}`,
      );
    }
  }
}
