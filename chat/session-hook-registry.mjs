/**
 * Unified session lifecycle hook registry for MelodySync.
 *
 * This module is intentionally business-free: it only knows how to register,
 * list, enable/disable, and emit lifecycle hooks.
 */
import {
  HOOK_EVENT_DEFINITIONS,
  listHookEventDefinitions,
} from './hooks/hook-contract.mjs';

export { HOOK_EVENT_DEFINITIONS, listHookEventDefinitions };

/**
 * All valid event names. Extend HOOK_EVENT_DEFINITIONS when adding new lifecycle points.
 * @type {readonly string[]}
 */
export const HOOK_EVENTS = Object.freeze(
  HOOK_EVENT_DEFINITIONS.map((definition) => definition.id),
);

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
  const result = [];
  for (const entries of registry.values()) {
    for (const entry of entries) {
      result.push({ ...entry.meta });
    }
  }
  return result;
}

export function setHookEnabled(hookId, enabled) {
  const normalizedHookId = normalizeHookId(hookId);
  if (!normalizedHookId) return false;
  for (const entries of registry.values()) {
    for (const entry of entries) {
      if (entry.meta?.id === normalizedHookId) {
        entry.meta.enabled = Boolean(enabled);
        enabledOverrides.set(normalizedHookId, Boolean(enabled));
        return true;
      }
    }
  }
  return false;
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
