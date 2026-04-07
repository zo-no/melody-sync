import {
  DEFAULT_APP_ID,
  getBuiltinApp,
  normalizeAppId,
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
  return DEFAULT_APP_ID;
}

export function resolveSessionSourceName(meta, sourceId = resolveSessionSourceId(meta)) {
  const explicitSourceName = normalizeSessionSourceName(meta?.sourceName);
  if (explicitSourceName) return explicitSourceName;
  const builtinSource = getBuiltinApp(sourceId);
  if (builtinSource?.name) return builtinSource.name;

  return formatSessionSourceNameFromId(sourceId);
}

export function normalizeSessionCompatInput(extra = {}) {
  const requestedAppId = normalizeAppId(extra.appId);
  const requestedAppName = normalizeSessionAppName(extra.appName);
  const requestedSourceId = normalizeAppId(extra.sourceId);
  const requestedSourceName = normalizeSessionSourceName(extra.sourceName);
  return {
    requestedAppId,
    requestedAppName,
    requestedSourceId,
    requestedSourceName,
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

  if (requestedAppId) session.appId = requestedAppId;
  else if (!normalizeAppId(session.appId)) delete session.appId;
  if (requestedAppName) session.appName = requestedAppName;
  else if (!normalizeSessionAppName(session.appName)) delete session.appName;
  if (requestedSourceId) session.sourceId = requestedSourceId;
  else if (!normalizeAppId(session.sourceId)) delete session.sourceId;
  if (requestedSourceName) session.sourceName = requestedSourceName;
  else if (!normalizeSessionSourceName(session.sourceName)) delete session.sourceName;
  if (requestedUserId) session.userId = requestedUserId;
  if (requestedUserName) session.userName = requestedUserName;
  return session;
}

export {
  DEFAULT_APP_ID,
  normalizeAppId,
};
