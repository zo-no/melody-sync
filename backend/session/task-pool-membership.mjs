function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePersistentKind(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'recurring_task') return 'recurring_task';
  return '';
}

function normalizeLongTermRole(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['project', 'root', 'pool_root', 'long_term_root'].includes(normalized)) return 'project';
  if (['member', 'branch', 'attached', 'maintenance', 'line'].includes(normalized)) return 'member';
  return '';
}

function normalizeLongTermBucket(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['inbox', 'collection', 'collect', 'capture', '收集箱'].includes(normalized)) return 'inbox';
  if (['short_term_iteration', 'short_term', 'short', 'iteration', '短期迭代', '短期任务'].includes(normalized)) {
    return 'short_term';
  }
  if (['long_term_iteration', 'long_term', 'long', '长期迭代', '长期任务'].includes(normalized)) {
    return 'long_term';
  }
  if (['waiting', 'waiting_for', 'waiting_user', '等待任务', '等待'].includes(normalized)) {
    return 'waiting';
  }
  return '';
}

function normalizeOptionalBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = trimText(String(value || '')).toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function getTaskPoolMembershipSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeLongTermMembership(value, { sessionId = '' } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const normalizedSessionId = trimText(sessionId);
  const requestedRole = normalizeLongTermRole(source.role || source.type || '');
  const projectSessionId = trimText(
    source.projectSessionId
    || source.projectId
    || source.rootSessionId
    || (requestedRole === 'project' ? normalizedSessionId : ''),
  );
  if (!projectSessionId) return null;
  const role = requestedRole || (projectSessionId === normalizedSessionId ? 'project' : 'member');
  return {
    role,
    projectSessionId,
    fixedNode: normalizeOptionalBoolean(source.fixedNode, role === 'project'),
    ...(normalizeLongTermBucket(source.bucket || source.bucketId || source.category || '') ? {
      bucket: normalizeLongTermBucket(source.bucket || source.bucketId || source.category || ''),
    } : {}),
  };
}

export function normalizeTaskPoolMembership(value, { sessionId = '' } = {}) {
  const source = getTaskPoolMembershipSource(value);
  const longTermSource = source.longTerm
    || source.long_term
    || source.longterm
    || null;
  const longTerm = normalizeLongTermMembership(longTermSource, { sessionId });
  if (!longTerm) return null;
  return { longTerm };
}

export function buildLongTermTaskPoolMembership(projectSessionId, { role = 'member', bucket = '' } = {}) {
  const normalizedProjectSessionId = trimText(projectSessionId);
  if (!normalizedProjectSessionId) return null;
  return normalizeTaskPoolMembership({
    longTerm: {
      role,
      projectSessionId: normalizedProjectSessionId,
      fixedNode: normalizeLongTermRole(role) === 'project',
      ...(normalizeLongTermBucket(bucket) ? { bucket: normalizeLongTermBucket(bucket) } : {}),
    },
  }, {
    sessionId: normalizeLongTermRole(role) === 'project' ? normalizedProjectSessionId : '',
  });
}

export function stripLongTermTaskPoolMembership(value, { sessionId = '' } = {}) {
  const normalized = normalizeTaskPoolMembership(value, { sessionId });
  if (!normalized?.longTerm) return null;
  return null;
}

export function getExplicitLongTermTaskPoolMembership(session = null) {
  return normalizeTaskPoolMembership(session?.taskPoolMembership, {
    sessionId: trimText(session?.id),
  })?.longTerm || null;
}

export function resolveLongTermProjectSessionId(session = null, {
  getSessionById = null,
  visited = new Set(),
} = {}) {
  const explicitMembership = getExplicitLongTermTaskPoolMembership(session);
  if (explicitMembership?.projectSessionId) {
    return explicitMembership.projectSessionId;
  }

  const sessionId = trimText(session?.id);
  if (!sessionId || visited.has(sessionId)) return '';
  if (normalizePersistentKind(session?.persistent?.kind) === 'recurring_task') {
    return sessionId;
  }
  if (typeof getSessionById !== 'function') {
    return '';
  }

  const nextVisited = new Set(visited);
  nextVisited.add(sessionId);
  const candidateIds = [];
  const rootSessionId = trimText(session?.rootSessionId || session?.sourceContext?.rootSessionId);
  const parentSessionId = trimText(
    session?._branchParentSessionId
    || session?.branchParentSessionId
    || session?.sourceContext?.parentSessionId,
  );
  for (const candidateId of [rootSessionId, parentSessionId]) {
    if (!candidateId || candidateId === sessionId || candidateIds.includes(candidateId)) continue;
    candidateIds.push(candidateId);
  }
  for (const candidateId of candidateIds) {
    const candidate = getSessionById(candidateId);
    if (!candidate) continue;
    const resolved = resolveLongTermProjectSessionId(candidate, {
      getSessionById,
      visited: nextVisited,
    });
    if (resolved) return resolved;
  }
  return '';
}

export function getLongTermTaskPoolMembership(session = null, options = {}) {
  const explicitMembership = getExplicitLongTermTaskPoolMembership(session);
  if (explicitMembership) {
    return explicitMembership;
  }
  const projectSessionId = resolveLongTermProjectSessionId(session, options);
  if (!projectSessionId) return null;
  const sessionId = trimText(session?.id);
  const isProject = sessionId && sessionId === projectSessionId;
  return {
    role: isProject ? 'project' : 'member',
    projectSessionId,
    fixedNode: isProject,
  };
}

export function isLongTermProjectSession(session = null, options = {}) {
  const membership = getLongTermTaskPoolMembership(session, options);
  return membership?.role === 'project' && membership?.fixedNode === true;
}
