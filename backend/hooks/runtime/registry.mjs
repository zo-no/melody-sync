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

/**
 * Map from event pattern -> list of hook entries.
 * Patterns: exact event name, 'run.*', or '*'.
 * @type {Map<string, Array<{ fn: (ctx: object) => Promise<void>, meta: object }>>}
 */
const registry = new Map();
const promptRegistry = new Map();
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

export function registerPromptContextHook(eventPattern, hook, meta = {}) {
  if (typeof hook !== 'function') return;
  if (!promptRegistry.has(eventPattern)) promptRegistry.set(eventPattern, []);
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
  promptRegistry.get(eventPattern).push(entry);
}

export function listHooks() {
  const hookMetaById = new Map();
  const collect = (sourceRegistry) => {
    for (const entries of sourceRegistry.values()) {
      for (const entry of entries) {
        const hookId = normalizeHookId(entry?.meta?.id);
        if (!hookId) continue;
        hookMetaById.set(hookId, {
          ...(hookMetaById.get(hookId) || {}),
          ...entry.meta,
        });
      }
    }
  };
  collect(registry);
  collect(promptRegistry);
  return [...hookMetaById.values()].map((meta) => ({ ...meta }));
}

export function setHookEnabled(hookId, enabled) {
  const normalizedHookId = normalizeHookId(hookId);
  if (!normalizedHookId) return false;
  let found = false;
  for (const sourceRegistry of [registry, promptRegistry]) {
    for (const entries of sourceRegistry.values()) {
      for (const entry of entries) {
        if (entry.meta?.id === normalizedHookId) {
          entry.meta.enabled = Boolean(enabled);
          found = true;
        }
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

  for (const sourceRegistry of [registry, promptRegistry]) {
    for (const entries of sourceRegistry.values()) {
      for (const entry of entries) {
        applyEnabledOverrideToEntry(entry);
      }
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

export async function emit(event, ctx) {
  const hooks = collectHooks(event);
  if (hooks.length === 0) {
    return {
      event,
      hookCount: 0,
      executed: [],
      failures: [],
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

  return {
    event,
    hookCount: hooks.length,
    executed,
    failures,
  };
}

export async function collectPromptContexts(event, ctx) {
  const fullCtx = { event, ...ctx };
  const matchedEntries = collectEntriesForEvent(promptRegistry, event)
    .filter((entry) => entry.meta?.enabled !== false);
  if (matchedEntries.length === 0) return [];

  const results = await Promise.allSettled(
    matchedEntries.map(async (entry) => {
      const result = await entry.fn(fullCtx);
      const content = typeof result === 'string'
        ? result.trim()
        : (typeof result?.content === 'string' ? result.content.trim() : '');
      if (!content) return null;
      return {
        id: entry.meta?.id || '',
        label: entry.meta?.label || entry.meta?.id || 'Prompt Hook',
        eventPattern: entry.meta?.eventPattern || event,
        content,
      };
    }),
  );

  const sections = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value) sections.push(result.value);
      continue;
    }
    console.error(
      `[session-hooks] prompt-context ${event} ${ctx?.sessionId || ''}: ${result.reason?.message ?? result.reason}`,
    );
  }
  return sections;
}
