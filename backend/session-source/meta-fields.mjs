import {
  DEFAULT_APP_ID,
  normalizeAppId,
} from './ids.mjs';

export function normalizeSessionSourceName(value) {
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
  return '';
}

export function normalizeSessionCompatInput(extra = {}) {
  const requestedSourceId = normalizeAppId(extra.sourceId || extra.appId);
  const requestedSourceName = normalizeSessionSourceName(extra.sourceName || extra.appName);
  return {
    requestedSourceId,
    requestedSourceName,
  };
}

export function applySessionCompatFields(session, compat = {}) {
  if (!session || typeof session !== 'object') return session;
  const {
    requestedSourceId = '',
    requestedSourceName = '',
  } = compat;

  if (requestedSourceId) session.sourceId = requestedSourceId;
  else if (!normalizeAppId(session.sourceId)) delete session.sourceId;
  if (requestedSourceName) session.sourceName = requestedSourceName;
  else if (!normalizeSessionSourceName(session.sourceName)) delete session.sourceName;
  return session;
}

export {
  DEFAULT_APP_ID,
  normalizeAppId,
};
