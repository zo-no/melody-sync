const BUILTIN_SOURCE_LABELS = new Map([
  ['chat', 'Chat'],
  ['email', 'Email'],
  ['voice', 'Voice'],
  ['observer', 'Observer'],
  ['github', 'GitHub'],
  ['github-ci', 'GitHub CI'],
]);

export const DEFAULT_APP_ID = 'chat';

export function normalizeAppId(appId, { fallbackDefault = false } = {}) {
  const trimmed = typeof appId === 'string' ? appId.trim() : '';
  if (!trimmed) {
    return fallbackDefault ? DEFAULT_APP_ID : '';
  }
  return trimmed;
}

export function resolveEffectiveAppId(appId) {
  return normalizeAppId(appId, { fallbackDefault: true });
}

export function getBuiltinSourceLabel(sourceId) {
  const normalized = normalizeAppId(sourceId);
  return normalized ? (BUILTIN_SOURCE_LABELS.get(normalized) || null) : null;
}
