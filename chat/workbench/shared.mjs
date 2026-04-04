import { randomUUID } from 'crypto';

export function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function nowIso() {
  return new Date().toISOString();
}

export function createWorkbenchId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function deriveCaptureTitle(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Untitled capture';
  return compact.slice(0, 72);
}

export function normalizeNullableText(value) {
  const trimmed = trimText(value);
  return trimmed || '';
}

export function normalizeBranchContextStatus(value) {
  const status = trimText(value).toLowerCase();
  if (['active', 'resolved', 'parked', 'merged', 'suppressed'].includes(status)) return status;
  return 'active';
}

export function normalizeNodeType(value) {
  const type = trimText(value).toLowerCase();
  if ([
    'question',
    'insight',
    'solution',
    'task',
    'risk',
    'conclusion',
    'knowledge',
  ].includes(type)) {
    return type;
  }
  return 'insight';
}

export function normalizeNodeState(value) {
  const state = trimText(value).toLowerCase();
  if (['open', 'active', 'done', 'parked'].includes(state)) return state;
  return 'open';
}

export function normalizeLineRole(value) {
  const role = trimText(value).toLowerCase();
  if (role === 'branch') return 'branch';
  return 'main';
}

export function dedupeTexts(items) {
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeNullableText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }
  return results;
}

export function sortByCreatedAsc(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a?.createdAt || a?.created || '') || 0;
    const right = Date.parse(b?.createdAt || b?.created || '') || 0;
    return left - right;
  });
}

export function sortByUpdatedDesc(items) {
  return [...items].sort((a, b) => {
    const left = Date.parse(a?.updatedAt || a?.createdAt || a?.created || '') || 0;
    const right = Date.parse(b?.updatedAt || b?.createdAt || b?.created || '') || 0;
    return right - left;
  });
}
