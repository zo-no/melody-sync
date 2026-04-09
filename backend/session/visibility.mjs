export function getInternalSessionRole(meta) {
  return typeof meta?.internalRole === 'string' ? meta.internalRole.trim() : '';
}

export function isInternalSession(meta) {
  return !!getInternalSessionRole(meta);
}

export function isContextCompactorSession(meta, contextCompactorRole = 'context_compactor') {
  return getInternalSessionRole(meta) === contextCompactorRole;
}

export function shouldExposeSession(meta) {
  return !isInternalSession(meta);
}
