export function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
