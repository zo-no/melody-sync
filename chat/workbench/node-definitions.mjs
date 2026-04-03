import { WORKBENCH_NODE_SETTINGS_FILE } from '../../lib/config.mjs';
import { readWorkbenchNodeSettingsSync } from './node-settings-store.mjs';

const NODE_LANES = Object.freeze(['main', 'branch', 'side']);
const NODE_ROLES = Object.freeze(['state', 'action', 'summary']);
const NODE_MERGE_POLICIES = Object.freeze(['replace-latest', 'append']);
const NODE_INTERACTIONS = Object.freeze(['open-session', 'create-branch', 'none']);
const NODE_EDGE_TYPES = Object.freeze(['structural', 'suggestion', 'completion', 'merge']);
const NODE_LAYOUT_VARIANTS = Object.freeze(['root', 'default', 'compact']);

function normalizeToken(value, fallback, allowlist) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowlist.includes(normalized) ? normalized : fallback;
}

function normalizeTokenList(values, fallback, allowlist) {
  if (!Array.isArray(values) || values.length === 0) {
    return [...fallback];
  }
  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => allowlist.includes(value));
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function normalizeNodeKindIdList(values, fallback) {
  const source = Array.isArray(values) ? values : fallback;
  const normalized = source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[a-z][a-z0-9-]{0,47}$/.test(value));
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function defineNodeComposition(definition = {}, normalizedDefinition = {}) {
  const composition = definition?.composition && typeof definition.composition === 'object'
    ? definition.composition
    : {};
  const layoutVariant = normalizeToken(
    composition.layoutVariant,
    normalizedDefinition.sessionBacked ? 'default' : (normalizedDefinition.derived ? 'compact' : 'default'),
    NODE_LAYOUT_VARIANTS,
  );
  const defaultInteraction = normalizeToken(
    composition.defaultInteraction,
    normalizedDefinition.sessionBacked ? 'open-session' : 'none',
    NODE_INTERACTIONS,
  );
  const defaultEdgeType = normalizeToken(
    composition.defaultEdgeType,
    'structural',
    NODE_EDGE_TYPES,
  );
  return Object.freeze({
    canBeRoot: composition.canBeRoot === true,
    allowedParentKinds: normalizeNodeKindIdList(
      composition.allowedParentKinds,
      normalizedDefinition.sessionBacked ? ['main', 'branch'] : ['main', 'branch'],
    ),
    allowedChildKinds: normalizeNodeKindIdList(
      composition.allowedChildKinds,
      normalizedDefinition.sessionBacked ? ['branch', 'candidate', 'done'] : [],
    ),
    requiresSourceSession: composition.requiresSourceSession !== false,
    defaultInteraction,
    defaultEdgeType,
    layoutVariant,
    countsAs: Object.freeze({
      sessionNode: composition?.countsAs?.sessionNode === true || normalizedDefinition.sessionBacked === true,
      branch: composition?.countsAs?.branch === true,
      candidate: composition?.countsAs?.candidate === true,
      completedSummary: composition?.countsAs?.completedSummary === true,
    }),
  });
}

function defineNodeKind(definition = {}) {
  const id = String(definition.id || '').trim();
  if (!id) {
    throw new Error('Node kind definition requires id');
  }
  const normalizedDefinition = {
    id,
    label: String(definition.label || id).trim(),
    description: String(definition.description || '').trim(),
    lane: normalizeToken(definition.lane, 'main', NODE_LANES),
    role: normalizeToken(definition.role, 'state', NODE_ROLES),
    sessionBacked: definition.sessionBacked === true,
    derived: definition.derived === true,
    mergePolicy: normalizeToken(
      definition.mergePolicy,
      'replace-latest',
      NODE_MERGE_POLICIES,
    ),
    builtIn: definition.builtIn === true,
    editable: definition.editable === true,
    source: String(definition.source || (definition.builtIn ? 'builtin' : 'custom')).trim() || 'custom',
  };
  return Object.freeze({
    ...normalizedDefinition,
    composition: defineNodeComposition(definition, normalizedDefinition),
  });
}

const BUILTIN_NODE_KIND_DEFINITIONS = Object.freeze([
  defineNodeKind({
    id: 'main',
    label: '主任务',
    description: '主任务根节点，对应主 session。',
    lane: 'main',
    role: 'state',
    sessionBacked: true,
    derived: false,
    mergePolicy: 'replace-latest',
    builtIn: true,
    editable: false,
    source: 'builtin',
    composition: {
      canBeRoot: true,
      allowedParentKinds: [],
      allowedChildKinds: ['branch', 'candidate', 'done'],
      requiresSourceSession: true,
      defaultInteraction: 'open-session',
      defaultEdgeType: 'structural',
      layoutVariant: 'root',
      countsAs: {
        sessionNode: true,
        branch: false,
        candidate: false,
        completedSummary: false,
      },
    },
  }),
  defineNodeKind({
    id: 'branch',
    label: '子任务',
    description: '已经拆出的真实支线 session。',
    lane: 'branch',
    role: 'state',
    sessionBacked: true,
    derived: false,
    mergePolicy: 'append',
    builtIn: true,
    editable: false,
    source: 'builtin',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main', 'branch'],
      allowedChildKinds: ['branch', 'candidate', 'done'],
      requiresSourceSession: true,
      defaultInteraction: 'open-session',
      defaultEdgeType: 'structural',
      layoutVariant: 'default',
      countsAs: {
        sessionNode: true,
        branch: true,
        candidate: false,
        completedSummary: false,
      },
    },
  }),
  defineNodeKind({
    id: 'candidate',
    label: '建议子任务',
    description: '系统建议但尚未真正展开的下一条执行线。',
    lane: 'branch',
    role: 'action',
    sessionBacked: false,
    derived: true,
    mergePolicy: 'replace-latest',
    builtIn: true,
    editable: false,
    source: 'builtin',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main', 'branch'],
      allowedChildKinds: [],
      requiresSourceSession: true,
      defaultInteraction: 'create-branch',
      defaultEdgeType: 'suggestion',
      layoutVariant: 'compact',
      countsAs: {
        sessionNode: false,
        branch: false,
        candidate: true,
        completedSummary: false,
      },
    },
  }),
  defineNodeKind({
    id: 'done',
    label: '收束',
    description: '当前主任务下的现有支线已经全部收束。',
    lane: 'main',
    role: 'summary',
    sessionBacked: false,
    derived: true,
    mergePolicy: 'replace-latest',
    builtIn: true,
    editable: false,
    source: 'builtin',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main', 'branch'],
      allowedChildKinds: [],
      requiresSourceSession: true,
      defaultInteraction: 'none',
      defaultEdgeType: 'completion',
      layoutVariant: 'compact',
      countsAs: {
        sessionNode: true,
        branch: false,
        candidate: false,
        completedSummary: true,
      },
    },
  }),
]);

const NODE_KIND_DEFINITIONS = BUILTIN_NODE_KIND_DEFINITIONS;

function getMergedNodeKindDefinitions() {
  const settings = readWorkbenchNodeSettingsSync();
  const customDefinitions = (settings.customNodeKinds || []).map((definition) => defineNodeKind({
    ...definition,
    builtIn: false,
    editable: true,
    source: 'custom',
  }));
  return [...BUILTIN_NODE_KIND_DEFINITIONS, ...customDefinitions];
}

export {
  NODE_LANES,
  NODE_ROLES,
  NODE_MERGE_POLICIES,
  NODE_INTERACTIONS,
  NODE_EDGE_TYPES,
  NODE_LAYOUT_VARIANTS,
  NODE_KIND_DEFINITIONS,
  BUILTIN_NODE_KIND_DEFINITIONS,
};

export function listBuiltinNodeKindDefinitions() {
  return BUILTIN_NODE_KIND_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function listNodeKindDefinitions() {
  return getMergedNodeKindDefinitions().map((definition) => ({ ...definition }));
}

export function getNodeKindDefinition(kind) {
  const definition = getMergedNodeKindDefinitions().find(
    (entry) => entry.id === String(kind || '').trim(),
  );
  return definition ? { ...definition } : null;
}

export function isKnownNodeKind(kind) {
  return !!getNodeKindDefinition(kind);
}

export function createWorkbenchNodeDefinitionsPayload() {
  const nodeKindDefinitions = listNodeKindDefinitions();
  const settings = readWorkbenchNodeSettingsSync();
  return {
    nodeKinds: nodeKindDefinitions.map((definition) => definition.id),
    nodeLanes: [...NODE_LANES],
    nodeRoles: [...NODE_ROLES],
    nodeMergePolicies: [...NODE_MERGE_POLICIES],
    nodeInteractions: [...NODE_INTERACTIONS],
    nodeEdgeTypes: [...NODE_EDGE_TYPES],
    nodeLayoutVariants: [...NODE_LAYOUT_VARIANTS],
    builtInNodeKinds: BUILTIN_NODE_KIND_DEFINITIONS.map((definition) => definition.id),
    customNodeKinds: (settings.customNodeKinds || []).map((definition) => ({ ...definition })),
    nodeKindDefinitions,
    settings: {
      persistence: 'file',
      storagePath: WORKBENCH_NODE_SETTINGS_FILE,
      supportsCustomNodeKinds: true,
      supportsBuiltinMutation: false,
    },
  };
}
