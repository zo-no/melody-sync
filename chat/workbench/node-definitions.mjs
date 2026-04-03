import { WORKBENCH_NODE_SETTINGS_FILE } from '../../lib/config.mjs';
import { readWorkbenchNodeSettingsSync } from './node-settings-store.mjs';

const NODE_LANES = Object.freeze(['main', 'branch', 'side']);
const NODE_ROLES = Object.freeze(['state', 'action', 'summary']);
const NODE_MERGE_POLICIES = Object.freeze(['replace-latest', 'append']);

function normalizeToken(value, fallback, allowlist) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowlist.includes(normalized) ? normalized : fallback;
}

function defineNodeKind(definition = {}) {
  const id = String(definition.id || '').trim();
  if (!id) {
    throw new Error('Node kind definition requires id');
  }
  return Object.freeze({
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
