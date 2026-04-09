import {
  NODE_CAPABILITIES,
  NODE_SURFACE_SLOTS,
  NODE_TASK_CARD_BINDING_KEYS,
  NODE_VIEW_TYPES,
  getNodeKindDefinition,
} from './node-definitions.mjs';
import { trimText } from './shared.mjs';

const NODE_ORIGIN_TYPES = Object.freeze([
  'projection',
  'plan',
  'hook',
  'system',
  'manual',
  'unknown',
]);
const HTML_RENDER_MODES = Object.freeze(['inline', 'iframe']);

function normalizeAllowedTokenList(values, allowlist, fallback = []) {
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

function normalizeDimension(value, { min = 120, max = 1280 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.round(numeric);
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function normalizeNodeStatus(value) {
  return trimText(value).toLowerCase() || 'active';
}

function normalizeNodeLineRole(value, node = {}) {
  const normalized = trimText(value).toLowerCase();
  if (normalized) return normalized;
  if (!trimText(node?.parentNodeId || node?.parentId)) return 'main';
  return trimText(node?.kind).toLowerCase() === 'candidate' ? 'candidate' : 'branch';
}

function normalizeNodeOrigin(origin = null, fallback = {}) {
  const rawOrigin = origin && typeof origin === 'object' ? origin : {};
  const fallbackOrigin = fallback && typeof fallback === 'object' ? fallback : {};
  const originType = trimText(rawOrigin.type || fallbackOrigin.type).toLowerCase();
  const sourceId = trimText(rawOrigin.sourceId || fallbackOrigin.sourceId);
  const sourceLabel = trimText(rawOrigin.sourceLabel || fallbackOrigin.sourceLabel);
  const hookId = trimText(rawOrigin.hookId || fallbackOrigin.hookId);
  const planId = trimText(rawOrigin.planId || fallbackOrigin.planId);
  if (!originType && !sourceId && !sourceLabel && !hookId && !planId) {
    return null;
  }
  return {
    type: NODE_ORIGIN_TYPES.includes(originType) ? originType : 'unknown',
    sourceId,
    sourceLabel,
    hookId,
    planId,
  };
}

function normalizeNodeViewType(value, fallback = 'flow-node') {
  const normalized = trimText(value).toLowerCase();
  return NODE_VIEW_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeHtmlRenderMode(value) {
  const normalized = trimText(value).toLowerCase();
  return HTML_RENDER_MODES.includes(normalized) ? normalized : 'iframe';
}

function normalizeNodeView(view = null, definition = null) {
  const sourceView = view && typeof view === 'object' && !Array.isArray(view) ? view : {};
  const fallbackType = normalizeNodeViewType(definition?.composition?.defaultViewType || 'flow-node');
  const type = normalizeNodeViewType(sourceView.type, fallbackType);
  return {
    type,
    renderMode: type === 'html' ? normalizeHtmlRenderMode(sourceView.renderMode) : '',
    content: typeof sourceView.content === 'string' ? sourceView.content : '',
    src: trimText(sourceView.src),
    width: normalizeDimension(sourceView.width, { min: 180, max: 1440 }),
    height: normalizeDimension(sourceView.height, { min: 120, max: 1200 }),
  };
}

function resolveNodeSourceSessionId(node = {}) {
  return trimText(node?.sourceSessionId || node?.sessionId);
}

function hasSurfaceBinding(node = {}, surfaceSlot = '') {
  const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
  if (!normalizedSurfaceSlot) return false;
  const surfaceBindings = normalizeAllowedTokenList(
    node?.surfaceBindings,
    NODE_SURFACE_SLOTS,
    [],
  );
  return surfaceBindings.includes(normalizedSurfaceSlot);
}

function buildComposerSuggestionEntry(node = {}) {
  const nodeInstance = createNodeInstance(node, { origin: node?.origin || null });
  if (!trimText(nodeInstance?.title)) return null;
  const actionPayload = nodeInstance?.actionPayload && typeof nodeInstance.actionPayload === 'object'
    ? { ...nodeInstance.actionPayload }
    : null;
  const entry = {
    id: trimText(nodeInstance.id),
    text: trimText(nodeInstance.title),
    summary: trimText(nodeInstance.summary),
    capabilities: Array.isArray(nodeInstance.capabilities) ? [...nodeInstance.capabilities] : [],
    sourceSessionId: resolveNodeSourceSessionId(nodeInstance),
    taskCardBindings: normalizeAllowedTokenList(
      nodeInstance.taskCardBindings,
      NODE_TASK_CARD_BINDING_KEYS,
      [],
    ),
    origin: nodeInstance.origin ? { ...nodeInstance.origin } : null,
  };
  if (actionPayload) {
    entry.actionPayload = actionPayload;
  }
  return entry;
}

function createNodeInstance(node = {}, { questId = '', origin = null } = {}) {
  const kind = trimText(node?.kind).toLowerCase();
  const definition = getNodeKindDefinition(kind);
  if (!trimText(node?.id) || !definition) return null;
  const composition = definition?.composition || {};
  return {
    id: trimText(node.id),
    questId: trimText(node.questId || questId),
    kind,
    title: trimText(node.title || node.id),
    summary: trimText(node.summary),
    sessionId: trimText(node.sessionId),
    sourceSessionId: resolveNodeSourceSessionId(node),
    parentNodeId: trimText(node.parentNodeId || node.parentId),
    status: normalizeNodeStatus(node.status),
    lineRole: normalizeNodeLineRole(node.lineRole, node),
    depth: Number.isFinite(node?.depth) ? node.depth : 0,
    childNodeIds: Array.isArray(node?.childNodeIds) ? [...node.childNodeIds] : [],
    candidateNodeIds: Array.isArray(node?.candidateNodeIds) ? [...node.candidateNodeIds] : [],
    isCurrent: node?.isCurrent === true,
    isCurrentPath: node?.isCurrentPath === true,
    conclusionText: trimText(node?.conclusionText),
    capabilities: normalizeAllowedTokenList(
      node.capabilities,
      NODE_CAPABILITIES,
      Array.isArray(composition.capabilities) ? composition.capabilities : [],
    ),
    surfaceBindings: normalizeAllowedTokenList(
      node.surfaceBindings,
      NODE_SURFACE_SLOTS,
      Array.isArray(composition.surfaceBindings) ? composition.surfaceBindings : ['task-map'],
    ),
    taskCardBindings: normalizeAllowedTokenList(
      node.taskCardBindings,
      NODE_TASK_CARD_BINDING_KEYS,
      Array.isArray(composition.taskCardBindings) ? composition.taskCardBindings : [],
    ),
    actionPayload: (() => {
      if (!node?.actionPayload || typeof node.actionPayload !== 'object' || Array.isArray(node.actionPayload)) {
        return null;
      }
      const normalized = {};
      for (const [key, value] of Object.entries(node.actionPayload)) {
        normalized[key] = value;
      }
      return Object.keys(normalized).length > 0 ? normalized : null;
    })(),
    view: normalizeNodeView(node.view, definition),
    origin: normalizeNodeOrigin(node.origin, origin),
  };
}

function mergeNodeInstances(existingNode = {}, patchNode = {}, { origin = null } = {}) {
  return createNodeInstance({
    ...existingNode,
    ...patchNode,
    kind: trimText(patchNode?.kind) || trimText(existingNode?.kind),
    title: trimText(patchNode?.title) || trimText(existingNode?.title),
    summary: trimText(patchNode?.summary) || trimText(existingNode?.summary),
    sessionId: trimText(patchNode?.sessionId) || trimText(existingNode?.sessionId),
    sourceSessionId: trimText(patchNode?.sourceSessionId) || trimText(existingNode?.sourceSessionId),
    parentNodeId: trimText(patchNode?.parentNodeId || patchNode?.parentId) || trimText(existingNode?.parentNodeId),
    status: trimText(patchNode?.status) || trimText(existingNode?.status),
    lineRole: trimText(patchNode?.lineRole) || trimText(existingNode?.lineRole),
    childNodeIds: Array.isArray(existingNode?.childNodeIds) ? [...existingNode.childNodeIds] : [],
    candidateNodeIds: Array.isArray(existingNode?.candidateNodeIds) ? [...existingNode.candidateNodeIds] : [],
    capabilities: Array.isArray(patchNode?.capabilities) && patchNode.capabilities.length > 0
      ? [...patchNode.capabilities]
      : (Array.isArray(existingNode?.capabilities) ? [...existingNode.capabilities] : []),
    surfaceBindings: Array.isArray(patchNode?.surfaceBindings) && patchNode.surfaceBindings.length > 0
      ? [...patchNode.surfaceBindings]
      : (Array.isArray(existingNode?.surfaceBindings) ? [...existingNode.surfaceBindings] : []),
    taskCardBindings: Array.isArray(patchNode?.taskCardBindings) && patchNode.taskCardBindings.length > 0
      ? [...patchNode.taskCardBindings]
      : (Array.isArray(existingNode?.taskCardBindings) ? [...existingNode.taskCardBindings] : []),
    actionPayload: (() => {
      if (patchNode?.actionPayload && typeof patchNode.actionPayload === 'object' && !Array.isArray(patchNode.actionPayload)) {
        const payload = {};
        for (const [key, value] of Object.entries(patchNode.actionPayload)) {
          payload[key] = value;
        }
        if (Object.keys(payload).length > 0) return payload;
      }
      if (existingNode?.actionPayload && typeof existingNode.actionPayload === 'object' && !Array.isArray(existingNode.actionPayload)) {
        const payload = {};
        for (const [key, value] of Object.entries(existingNode.actionPayload)) {
          payload[key] = value;
        }
        return Object.keys(payload).length > 0 ? payload : null;
      }
      return null;
    })(),
    view: patchNode?.view && typeof patchNode.view === 'object'
      ? { ...patchNode.view }
      : (existingNode?.view ? { ...existingNode.view } : null),
    origin: patchNode?.origin || existingNode?.origin || origin || null,
  }, {
    questId: trimText(patchNode?.questId || existingNode?.questId),
    origin: patchNode?.origin || existingNode?.origin || origin || null,
  });
}

export {
  NODE_ORIGIN_TYPES,
  normalizeNodeStatus,
  normalizeNodeLineRole,
  normalizeNodeOrigin,
  resolveNodeSourceSessionId,
  createNodeInstance,
  mergeNodeInstances,
  hasSurfaceBinding,
  buildComposerSuggestionEntry,
};
