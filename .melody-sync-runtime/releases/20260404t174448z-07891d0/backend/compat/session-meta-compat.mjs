import {
  DEFAULT_APP_ID,
  getBuiltinApp,
  normalizeAppId,
  resolveEffectiveAppId,
} from './apps.mjs';

export function normalizeSessionAppName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeSessionSourceName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeSessionUserName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function isTemplateAppScopeId(appId) {
  const normalized = normalizeAppId(appId);
  return /^app[_-]/i.test(normalized);
}

export function formatSessionSourceNameFromId(sourceId) {
  const normalized = typeof sourceId === 'string' ? sourceId.trim() : '';
  if (!normalized) return 'Chat';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveSessionSourceId(meta) {
  const explicitSourceId = normalizeAppId(meta?.sourceId);
  if (explicitSourceId) return explicitSourceId;

  const legacyAppId = normalizeAppId(meta?.appId);
  if (legacyAppId && !isTemplateAppScopeId(legacyAppId)) {
    return legacyAppId;
  }

  return DEFAULT_APP_ID;
}

export function resolveSessionSourceName(meta, sourceId = resolveSessionSourceId(meta)) {
  const explicitSourceName = normalizeSessionSourceName(meta?.sourceName);
  if (explicitSourceName) return explicitSourceName;

  const legacyAppId = normalizeAppId(meta?.appId);
  if (legacyAppId && !isTemplateAppScopeId(legacyAppId) && legacyAppId === sourceId) {
    const legacyAppName = normalizeSessionAppName(meta?.appName);
    if (legacyAppName) return legacyAppName;
  }

  const builtinSource = getBuiltinApp(sourceId);
  if (builtinSource?.name) return builtinSource.name;

  return formatSessionSourceNameFromId(sourceId);
}

export function normalizeSessionCompatInput(extra = {}) {
  return {
    requestedAppId: normalizeAppId(extra.appId),
    requestedAppName: normalizeSessionAppName(extra.appName),
    requestedSourceId: normalizeAppId(extra.sourceId),
    requestedSourceName: normalizeSessionSourceName(extra.sourceName),
    requestedUserId: typeof extra.userId === 'string' ? extra.userId.trim() : '',
    requestedUserName: normalizeSessionUserName(extra.userName),
  };
}

export function applySessionCompatFields(session, compat = {}) {
  if (!session || typeof session !== 'object') return session;
  const {
    requestedAppId = '',
    requestedAppName = '',
    requestedSourceId = '',
    requestedSourceName = '',
    requestedUserId = '',
    requestedUserName = '',
  } = compat;

  session.appId = resolveEffectiveAppId(requestedAppId || session.appId);
  if (requestedAppName) session.appName = requestedAppName;
  if (requestedSourceId) session.sourceId = requestedSourceId;
  if (requestedSourceName) session.sourceName = requestedSourceName;
  if (requestedUserId) session.userId = requestedUserId;
  if (requestedUserName) session.userName = requestedUserName;
  return session;
}

export {
  DEFAULT_APP_ID,
  normalizeAppId,
  resolveEffectiveAppId,
};
