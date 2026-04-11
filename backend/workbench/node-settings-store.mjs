import { readFileSync } from 'fs';
import { WORKBENCH_NODE_SETTINGS_FILE } from '../../lib/config.mjs';
import { writeJsonAtomic } from '../fs-utils.mjs';
import { trimText } from './shared.mjs';

const NODE_LANES = Object.freeze(['main', 'branch', 'side']);
const NODE_ROLES = Object.freeze(['state', 'action', 'summary']);
const NODE_MERGE_POLICIES = Object.freeze(['replace-latest', 'append']);
const NODE_INTERACTIONS = Object.freeze(['open-session', 'create-branch', 'none']);
const NODE_EDGE_TYPES = Object.freeze([
  'structural',
  'related',
  'depends_on',
  'blocks',
  'maintains',
  'spawned_from',
  'suggestion',
  'completion',
  'merge',
]);
const NODE_LAYOUT_VARIANTS = Object.freeze(['root', 'default', 'compact', 'panel']);
const NODE_CAPABILITIES = Object.freeze(['open-session', 'create-branch', 'dismiss']);
const NODE_SURFACE_SLOTS = Object.freeze(['task-map', 'composer-suggestions']);
const NODE_VIEW_TYPES = Object.freeze(['flow-node', 'markdown', 'html', 'iframe']);
const NODE_TASK_CARD_BINDING_KEYS = Object.freeze([
  'mainGoal',
  'goal',
  'candidateBranches',
  'summary',
  'checkpoint',
  'nextSteps',
]);
const RESERVED_NODE_KIND_IDS = new Set(['main', 'branch', 'candidate', 'note', 'done']);

function normalizeToken(value, fallback, allowlist) {
  const normalized = trimText(value).toLowerCase();
  return allowlist.includes(normalized) ? normalized : fallback;
}

function normalizeNodeKindIdList(values, fallback) {
  const source = Array.isArray(values) ? values : fallback;
  const normalized = source
    .map((value) => trimText(value).toLowerCase())
    .filter((value) => /^[a-z][a-z0-9-]{0,47}$/.test(value));
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function normalizeAllowedTokenList(values, fallback, allowlist) {
  const allowlistMap = new Map(
    (Array.isArray(allowlist) ? allowlist : []).map((value) => [trimText(value).toLowerCase(), value]),
  );
  if (!Array.isArray(values) || values.length === 0) {
    return [...fallback];
  }
  const normalized = values
    .map((value) => trimText(value).toLowerCase())
    .filter((value) => allowlistMap.has(value))
    .map((value) => allowlistMap.get(value));
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function normalizeNodeKindId(value) {
  const normalized = trimText(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return '';
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(normalized)) {
    return '';
  }
  return normalized;
}

function normalizeCustomNodeComposition(definition = {}, { lane = 'side', role = 'summary' } = {}) {
  const composition = definition?.composition && typeof definition.composition === 'object'
    ? definition.composition
    : {};
  const inferredInteraction = role === 'action' ? 'create-branch' : 'none';
  const inferredEdgeType = role === 'action' ? 'suggestion' : (role === 'summary' ? 'completion' : 'structural');
  const inferredLayout = role === 'state' ? (lane === 'main' ? 'root' : 'default') : 'compact';
  const inferredCapabilities = inferredInteraction === 'create-branch'
    ? ['create-branch']
    : [];
  return {
    canBeRoot: composition.canBeRoot === true,
    connectsToAnyNode: composition.connectsToAnyNode !== false,
    allowedParentKinds: normalizeNodeKindIdList(
      composition.allowedParentKinds,
      ['main', 'branch', 'note'],
    ),
    allowedChildKinds: normalizeNodeKindIdList(
      composition.allowedChildKinds,
      role === 'state' ? ['branch', 'candidate', 'done', 'note'] : [],
    ),
    requiresSourceSession: composition.requiresSourceSession !== false,
    defaultInteraction: normalizeToken(
      composition.defaultInteraction,
      inferredInteraction,
      NODE_INTERACTIONS,
    ),
    defaultEdgeType: normalizeToken(
      composition.defaultEdgeType,
      inferredEdgeType,
      NODE_EDGE_TYPES,
    ),
    layoutVariant: normalizeToken(
      composition.layoutVariant,
      inferredLayout,
      NODE_LAYOUT_VARIANTS,
    ),
    defaultViewType: normalizeToken(
      composition.defaultViewType,
      'flow-node',
      NODE_VIEW_TYPES,
    ),
    capabilities: normalizeAllowedTokenList(
      composition.capabilities,
      inferredCapabilities,
      NODE_CAPABILITIES,
    ),
    surfaceBindings: normalizeAllowedTokenList(
      composition.surfaceBindings,
      ['task-map'],
      NODE_SURFACE_SLOTS,
    ),
    taskCardBindings: normalizeAllowedTokenList(
      composition.taskCardBindings,
      [],
      NODE_TASK_CARD_BINDING_KEYS,
    ),
    countsAs: {
      sessionNode: composition?.countsAs?.sessionNode === true,
      branch: composition?.countsAs?.branch === true,
      candidate: composition?.countsAs?.candidate === true,
      completedSummary: composition?.countsAs?.completedSummary === true,
    },
  };
}

function normalizeCustomNodeKind(definition = {}, { existingIds = new Set() } = {}) {
  const id = normalizeNodeKindId(definition.id);
  if (!id) {
    throw new Error('node kind id is required and must start with a letter');
  }
  if (RESERVED_NODE_KIND_IDS.has(id)) {
    throw new Error(`node kind id "${id}" is reserved`);
  }
  if (existingIds.has(id)) {
    throw new Error(`node kind id "${id}" already exists`);
  }
  const label = trimText(definition.label);
  if (!label) {
    throw new Error('node kind label is required');
  }
  const lane = normalizeToken(definition.lane, 'side', NODE_LANES);
  const role = normalizeToken(definition.role, 'summary', NODE_ROLES);
  return {
    id,
    label,
    description: trimText(definition.description),
    lane,
    role,
    sessionBacked: false,
    derived: true,
    mergePolicy: normalizeToken(definition.mergePolicy, 'replace-latest', NODE_MERGE_POLICIES),
    builtIn: false,
    editable: true,
    source: 'custom',
    composition: normalizeCustomNodeComposition(definition, { lane, role }),
  };
}

function normalizeNodeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { customNodeKinds: [] };
  }
  const customNodeKinds = [];
  const seenIds = new Set();
  for (const entry of Array.isArray(value.customNodeKinds) ? value.customNodeKinds : []) {
    try {
      const normalized = normalizeCustomNodeKind(entry, { existingIds: seenIds });
      seenIds.add(normalized.id);
      customNodeKinds.push(normalized);
    } catch {}
  }
  return { customNodeKinds };
}

export function readWorkbenchNodeSettingsSync() {
  try {
    const payload = JSON.parse(readFileSync(WORKBENCH_NODE_SETTINGS_FILE, 'utf8'));
    return normalizeNodeSettings(payload);
  } catch {
    return { customNodeKinds: [] };
  }
}

export async function readWorkbenchNodeSettings() {
  return readWorkbenchNodeSettingsSync();
}

export async function persistWorkbenchNodeSettings(settings = {}) {
  const normalized = normalizeNodeSettings(settings);
  await writeJsonAtomic(WORKBENCH_NODE_SETTINGS_FILE, normalized);
  return normalized;
}

export async function createCustomNodeKind(definition = {}) {
  const settings = readWorkbenchNodeSettingsSync();
  const existingIds = new Set(settings.customNodeKinds.map((entry) => entry.id));
  const nextDefinition = normalizeCustomNodeKind(definition, { existingIds });
  return persistWorkbenchNodeSettings({
    customNodeKinds: [...settings.customNodeKinds, nextDefinition],
  });
}

export async function updateCustomNodeKind(nodeKindId, updates = {}) {
  const normalizedId = normalizeNodeKindId(nodeKindId);
  if (!normalizedId) {
    throw new Error('node kind id is required');
  }
  const settings = readWorkbenchNodeSettingsSync();
  const index = settings.customNodeKinds.findIndex((definition) => definition.id === normalizedId);
  if (index < 0) {
    throw new Error('Custom node kind not found');
  }
  const preserved = settings.customNodeKinds[index];
  const nextDefinition = normalizeCustomNodeKind(
    {
      ...preserved,
      ...updates,
      id: normalizedId,
    },
    {
      existingIds: new Set(
        settings.customNodeKinds
          .filter((definition) => definition.id !== normalizedId)
          .map((definition) => definition.id),
      ),
    },
  );
  const customNodeKinds = [...settings.customNodeKinds];
  customNodeKinds[index] = nextDefinition;
  return persistWorkbenchNodeSettings({ customNodeKinds });
}

export async function deleteCustomNodeKind(nodeKindId) {
  const normalizedId = normalizeNodeKindId(nodeKindId);
  if (!normalizedId) {
    throw new Error('node kind id is required');
  }
  const settings = readWorkbenchNodeSettingsSync();
  const customNodeKinds = settings.customNodeKinds.filter((definition) => definition.id !== normalizedId);
  if (customNodeKinds.length === settings.customNodeKinds.length) {
    throw new Error('Custom node kind not found');
  }
  return persistWorkbenchNodeSettings({ customNodeKinds });
}

export function exportCurrentWorkbenchNodeSettings() {
  return readWorkbenchNodeSettingsSync();
}
