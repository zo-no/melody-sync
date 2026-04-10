function normalizeText(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';
}

function normalizeMemoryCandidateType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  if (['profile', 'user-profile', 'agent-profile'].includes(normalized)) return 'profile';
  if (['project', 'workspace'].includes(normalized)) return 'project';
  if (['corpus', 'knowledge', 'source'].includes(normalized)) return 'corpus';
  if (['skill', 'playbook', 'rule', 'workflow'].includes(normalized)) return 'skill';
  if (['episode', 'event', 'reflection'].includes(normalized)) return 'episode';
  if (['system'].includes(normalized)) return 'system';
  return normalized;
}

function normalizeMemoryCandidateStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  if (['candidate', 'suggested', 'pending', 'review'].includes(normalized)) return 'candidate';
  if (['approved', 'approve', 'promoted'].includes(normalized)) return 'approved';
  if (['active', 'applied', 'writeback'].includes(normalized)) return 'active';
  if (['rejected', 'reject', 'dismissed'].includes(normalized)) return 'rejected';
  if (['invalidated', 'invalid', 'superseded'].includes(normalized)) return 'invalidated';
  if (['expired', 'stale'].includes(normalized)) return 'expired';
  return normalized;
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return Math.round(numeric * 1000) / 1000;
}

function normalizeLineRole(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'branch' ? 'branch' : 'main';
}

function normalizeNeedsUser(value) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value).toLowerCase();
  return ['true', '1', 'yes', 'waiting_user', 'needs_user', 'needs-user'].includes(normalized);
}

function normalizeStatePatch(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      goal: '',
      checkpoint: '',
      needsUser: false,
      lineRole: 'main',
      branchFrom: '',
    };
  }
  const lineRole = normalizeLineRole(value.lineRole);
  return {
    goal: normalizeText(value.goal),
    checkpoint: normalizeText(value.checkpoint),
    needsUser: normalizeNeedsUser(value.needsUser),
    lineRole,
    branchFrom: lineRole === 'branch' ? normalizeText(value.branchFrom) : '',
  };
}

function normalizeActionRequest(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = normalizeText(value.type || value.action);
  if (!type) return null;
  const args = value.args && typeof value.args === 'object' && !Array.isArray(value.args)
    ? JSON.parse(JSON.stringify(value.args))
    : {};
  return {
    type,
    args,
  };
}

function normalizeMemoryCandidate(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const scope = normalizeText(value.scope).toLowerCase() === 'user' ? 'user' : 'project';
  const text = normalizeText(value.text);
  if (!text) return null;
  const source = normalizeText(value.source) || 'agent';
  const target = normalizeText(value.target || value.file || value.memoryFile || value.kind);
  const type = normalizeMemoryCandidateType(value.type || value.memoryType || value.category);
  const status = normalizeMemoryCandidateStatus(value.status || value.state);
  const confidence = normalizeConfidence(value.confidence);
  const reason = normalizeText(value.reason || value.rationale);
  const expiresAt = normalizeText(value.expiresAt || value.expires_at);
  return {
    scope,
    text,
    source,
    ...(target ? { target } : {}),
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(confidence !== null ? { confidence } : {}),
    ...(reason ? { reason } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function normalizeTraceEntry(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = normalizeText(value.type) || 'note';
  const message = normalizeText(value.message || value.text);
  if (!message) return null;
  return {
    type,
    message,
  };
}

function normalizeList(rawItems, normalizer) {
  const source = Array.isArray(rawItems) ? rawItems : [];
  const items = [];
  for (const item of source) {
    const normalized = normalizer(item);
    if (normalized) items.push(normalized);
  }
  return items;
}

export function normalizeAgentResultEnvelope(value = {}) {
  return {
    assistantMessage: normalizeText(value.assistantMessage || value.message || value.reply),
    statePatch: normalizeStatePatch(value.statePatch || value.sessionStatePatch || {}),
    actionRequests: normalizeList(value.actionRequests, normalizeActionRequest),
    memoryCandidates: normalizeList(value.memoryCandidates, normalizeMemoryCandidate),
    trace: normalizeList(value.trace, normalizeTraceEntry),
  };
}
