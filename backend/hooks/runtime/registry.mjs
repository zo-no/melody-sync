/**
 * Unified session lifecycle hook registry for MelodySync.
 *
 * This module is intentionally business-free: it only knows how to register,
 * list, enable/disable, and emit lifecycle hooks.
 */
import {
  HOOK_EVENT_DEFINITIONS,
  HOOK_EVENTS,
  listHookEventDefinitions,
} from '../contract/events.mjs';

export { HOOK_EVENT_DEFINITIONS, HOOK_EVENTS, listHookEventDefinitions };

export function registerLifecycleHook(eventPattern, hook, meta = {}) {
  registerHook(eventPattern, hook, meta);
}

export async function emitLifecycleHooks(event, ctx) {
  return emit(event, ctx);
}

/**
 * Map from event pattern -> list of hook entries.
 * Patterns: exact event name, 'run.*', or '*'.
 * @type {Map<string, Array<{ fn: (ctx: object) => Promise<void>, meta: object }>>}
 */
const registry = new Map();
const enabledOverrides = new Map();

function normalizeHookId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function applyEnabledOverrideToEntry(entry) {
  const hookId = normalizeHookId(entry?.meta?.id);
  if (!hookId || !enabledOverrides.has(hookId)) return;
  entry.meta.enabled = enabledOverrides.get(hookId) !== false;
}

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
  applyEnabledOverrideToEntry(entry);
  registry.get(eventPattern).push(entry);
}

export function listHooks() {
  const hookMetaById = new Map();
  for (const entries of registry.values()) {
    for (const entry of entries) {
      const hookId = normalizeHookId(entry?.meta?.id);
      if (!hookId) continue;
      hookMetaById.set(hookId, {
        ...(hookMetaById.get(hookId) || {}),
        ...entry.meta,
      });
    }
  }
  return [...hookMetaById.values()].map((meta) => ({ ...meta }));
}

export function setHookEnabled(hookId, enabled) {
  const normalizedHookId = normalizeHookId(hookId);
  if (!normalizedHookId) return false;
  let found = false;
  for (const entries of registry.values()) {
    for (const entry of entries) {
      if (entry.meta?.id === normalizedHookId) {
        entry.meta.enabled = Boolean(enabled);
        found = true;
      }
    }
  }
  if (found) {
    enabledOverrides.set(normalizedHookId, Boolean(enabled));
  }
  return found;
}

export function applyHookEnabledOverrides(overrides = {}) {
  const nextOverrides = new Map();
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [hookId, enabled] of Object.entries(overrides)) {
      const normalizedHookId = normalizeHookId(hookId);
      if (!normalizedHookId) continue;
      nextOverrides.set(normalizedHookId, enabled !== false);
    }
  }

  enabledOverrides.clear();
  for (const [hookId, enabled] of nextOverrides.entries()) {
    enabledOverrides.set(hookId, enabled);
  }

  for (const entries of registry.values()) {
    for (const entry of entries) {
      applyEnabledOverrideToEntry(entry);
    }
  }
}

export function getHookEnabledOverrides() {
  return Object.fromEntries(enabledOverrides.entries());
}

function collectHooks(event) {
  return collectEntriesForEvent(registry, event)
    .filter((entry) => entry.meta?.enabled !== false);
}

function collectEntriesForEvent(sourceRegistry, event) {
  const matched = [];
  const [namespace] = event.split('.');
  const wildcardNs = `${namespace}.*`;

  for (const [pattern, entries] of sourceRegistry.entries()) {
    if (pattern === event || pattern === wildcardNs || pattern === '*') {
      for (const entry of entries) {
        matched.push(entry);
      }
    }
  }
  return matched;
}

async function appendHookTraceEvents(event, ctx, executed = [], failures = []) {
  const appendEvent = typeof ctx?.appendEvent === 'function' ? ctx.appendEvent : null;
  const statusEvent = typeof ctx?.statusEvent === 'function' ? ctx.statusEvent : null;
  const sessionId = normalizeHookId(ctx?.sessionId);
  if (!appendEvent || !statusEvent || !sessionId || !Array.isArray(executed) || executed.length === 0) {
    return 0;
  }

  const failuresById = new Map(
    (Array.isArray(failures) ? failures : []).map((failure) => [
      normalizeHookId(failure?.id) || normalizeHookId(failure?.label),
      failure,
    ]),
  );

  let appendedCount = 0;
  for (const hook of executed) {
    const hookId = normalizeHookId(hook?.id) || normalizeHookId(hook?.label);
    const hookLabel = String(hook?.label || hookId || '').trim() || hookId || 'anonymous';
    const failure = failuresById.get(hookId);
    const content = failure
      ? `hook: ${event} · ${hookLabel} [failed] ${failure.reason}`
      : `hook: ${event} · ${hookLabel}`;
    await appendEvent(sessionId, statusEvent(content, {
      statusKind: 'hook_trace',
      hookEvent: event,
      hookId,
      hookLabel,
      hookOutcome: failure ? 'failed' : 'completed',
      ...(failure ? { hookFailureReason: failure.reason } : {}),
    }));
    appendedCount += 1;
  }
  return appendedCount;
}

export async function emit(event, ctx) {
  const hooks = collectHooks(event);
  if (hooks.length === 0) {
    return {
      event,
      hookCount: 0,
      executed: [],
      failures: [],
      traceAppendedCount: 0,
    };
  }

  const fullCtx = { event, ...ctx };
  const results = await Promise.allSettled(hooks.map((entry) => entry.fn(fullCtx)));
  const executed = [];
  const failures = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const entry = hooks[index];
    const hookId = normalizeHookId(entry?.meta?.id) || `hook_${index + 1}`;
    const hookLabel = String(entry?.meta?.label || hookId || '').trim() || hookId;
    executed.push({
      id: hookId,
      label: hookLabel,
      eventPattern: entry?.meta?.eventPattern || event,
    });
    if (result.status === 'rejected') {
      const reason = result.reason?.message ?? result.reason;
      failures.push({
        id: hookId,
        label: hookLabel,
        reason: typeof reason === 'string' ? reason : String(reason),
      });
      console.error(`[session-hooks] ${event} ${ctx.sessionId || ''}: ${reason}`);
    }
  }

  const traceAppendedCount = await appendHookTraceEvents(event, ctx, executed, failures);

  return {
    event,
    hookCount: hooks.length,
    executed,
    failures,
    traceAppendedCount,
  };
}
