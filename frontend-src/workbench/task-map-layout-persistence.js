const TASK_MAP_LAYOUT_STORAGE_PREFIX = 'melodysync.task-map-layout.v1';
const DEFAULT_MAX_LAYOUT_ENTRIES = 240;

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

export function createTaskMapLayoutStorageKey({
  rootSessionId = '',
  questId = '',
} = {}) {
  const normalizedRootSessionId = trimText(rootSessionId);
  const normalizedQuestId = trimText(questId);
  const scopeId = normalizedRootSessionId || normalizedQuestId;
  return scopeId ? `${TASK_MAP_LAYOUT_STORAGE_PREFIX}:${scopeId}` : '';
}

export function normalizeTaskMapLayoutPositions(
  positions = null,
  { maxEntries = DEFAULT_MAX_LAYOUT_ENTRIES } = {},
) {
  const normalized = {};
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    return normalized;
  }

  let count = 0;
  for (const [rawNodeId, rawPosition] of Object.entries(positions)) {
    if (count >= maxEntries) break;
    const nodeId = trimText(rawNodeId);
    if (!nodeId || !rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) {
      continue;
    }
    const x = normalizeCoordinate(rawPosition.x);
    const y = normalizeCoordinate(rawPosition.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    normalized[nodeId] = { x, y };
    count += 1;
  }

  return normalized;
}

export function filterTaskMapLayoutPositions(positions = null, nodeIds = []) {
  const normalized = normalizeTaskMapLayoutPositions(positions);
  const allowedNodeIds = new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((value) => trimText(value))
      .filter(Boolean),
  );
  if (allowedNodeIds.size === 0) return {};

  const filtered = {};
  for (const [nodeId, position] of Object.entries(normalized)) {
    if (!allowedNodeIds.has(nodeId)) continue;
    filtered[nodeId] = { x: position.x, y: position.y };
  }
  return filtered;
}

export function applyTaskMapLayoutOverrides(nodes = [], positions = null) {
  const normalized = normalizeTaskMapLayoutPositions(positions);
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const nodeId = trimText(node?.id);
    const override = nodeId ? normalized[nodeId] : null;
    if (!override) return node;
    return {
      ...node,
      position: {
        x: override.x,
        y: override.y,
      },
    };
  });
}

export function readTaskMapLayoutPositions(storage = null, storageKey = '') {
  const normalizedStorageKey = trimText(storageKey);
  if (!normalizedStorageKey || typeof storage?.getItem !== 'function') return {};

  try {
    const raw = storage.getItem(normalizedStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const storedPositions = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed.positions || parsed)
      : parsed;
    return normalizeTaskMapLayoutPositions(storedPositions);
  } catch {
    return {};
  }
}

export function writeTaskMapLayoutPositions(storage = null, storageKey = '', positions = null) {
  const normalizedStorageKey = trimText(storageKey);
  if (!normalizedStorageKey) return false;

  const normalized = normalizeTaskMapLayoutPositions(positions);
  try {
    if (Object.keys(normalized).length === 0) {
      if (typeof storage?.removeItem === 'function') {
        storage.removeItem(normalizedStorageKey);
        return true;
      }
      if (typeof storage?.setItem === 'function') {
        storage.setItem(normalizedStorageKey, JSON.stringify({ version: 1, positions: {} }));
        return true;
      }
      return false;
    }
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(
      normalizedStorageKey,
      JSON.stringify({
        version: 1,
        positions: normalized,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
