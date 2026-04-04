const BUILTIN_APP_LABELS = new Map([
  ['chat', 'Chat'],
  ['email', 'Email'],
  ['app_welcome', 'Welcome'],
  ['app_basic_chat', 'Basic Chat'],
  ['app_create_app', 'Create App'],
]);

export const DEFAULT_APP_ID = 'chat';
export const EMAIL_APP_ID = 'email';
export const WELCOME_APP_ID = 'app_welcome';
export const BASIC_CHAT_APP_ID = 'app_basic_chat';
export const CREATE_APP_APP_ID = 'app_create_app';

function cloneBuiltinApp(id) {
  const name = BUILTIN_APP_LABELS.get(id);
  if (!name) return null;
  return {
    id,
    name,
    builtin: true,
  };
}

export function normalizeAppId(appId, { fallbackDefault = false } = {}) {
  const trimmed = typeof appId === 'string' ? appId.trim() : '';
  if (!trimmed) {
    return fallbackDefault ? DEFAULT_APP_ID : '';
  }

  const builtinId = trimmed.toLowerCase();
  if (BUILTIN_APP_LABELS.has(builtinId)) {
    return builtinId;
  }

  return trimmed;
}

export function resolveEffectiveAppId(appId) {
  return normalizeAppId(appId, { fallbackDefault: true });
}

export function isBuiltinAppId(appId) {
  const normalized = normalizeAppId(appId);
  return normalized ? BUILTIN_APP_LABELS.has(normalized) : false;
}

export function getBuiltinApp(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return null;
  return cloneBuiltinApp(normalized);
}
