import {
  DEFAULT_APP_ID,
  getBuiltinApp,
  normalizeAppId,
} from './ids.mjs';

export function normalizeSessionSourceName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeSessionUserName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function resolveSessionSourceId(meta) {
  const explicitSourceId = normalizeAppId(meta?.sourceId);
  if (explicitSourceId) return explicitSourceId;
  return DEFAULT_APP_ID;
}

export function resolveSessionSourceName(meta, _sourceId = resolveSessionSourceId(meta)) {
  const explicit = normalizeSessionSourceName(meta?.sourceName);
  if (explicit) return explicit;
  return getBuiltinApp(_sourceId)?.name || '';
}

export function normalizeSessionCompatInput(extra = {}) {
  const requestedSourceId = normalizeAppId(extra.sourceId);
  const requestedSourceName = normalizeSessionSourceName(extra.sourceName);
  const requestedAppId = normalizeAppId(extra.appId);
  const requestedAppName = normalizeSessionSourceName(extra.appName);
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
  if (requestedAppName) session.appName = requestedAppName;
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
