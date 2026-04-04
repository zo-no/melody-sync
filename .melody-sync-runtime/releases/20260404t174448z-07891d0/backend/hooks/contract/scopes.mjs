function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const HOOK_SCOPE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'instance',
    label: '实例',
    description: '实例启动、首次初始化和恢复相关的生命周期工作。',
  }),
  Object.freeze({
    id: 'session',
    label: '任务',
    description: '任务建立和首次进入真实对话相关的生命周期工作。',
  }),
  Object.freeze({
    id: 'run',
    label: '单次执行',
    description: '单次执行的启动、完成和失败相关的生命周期工作。',
  }),
  Object.freeze({
    id: 'branch',
    label: '支线',
    description: '支线建议、开启和合并回主线相关的生命周期工作。',
  }),
]);

export const HOOK_SCOPE_ORDER = Object.freeze(
  HOOK_SCOPE_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_SCOPE_INDEX = new Map(
  HOOK_SCOPE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function normalizeHookScope(value) {
  const normalized = normalizeText(value).toLowerCase();
  return HOOK_SCOPE_INDEX.has(normalized) ? normalized : '';
}

export function deriveHookScopeFromEventPattern(eventPattern) {
  const normalized = normalizeText(eventPattern).toLowerCase();
  if (!normalized) return '';
  const [namespace] = normalized.split('.');
  return normalizeHookScope(namespace);
}

export function listHookScopeDefinitions() {
  return HOOK_SCOPE_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getHookScopeDefinition(scopeId) {
  const definition = HOOK_SCOPE_INDEX.get(normalizeHookScope(scopeId));
  return definition ? { ...definition } : null;
}
