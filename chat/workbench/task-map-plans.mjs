import { readFileSync } from 'fs';
import { WORKBENCH_TASK_MAP_PLANS_FILE } from '../../lib/config.mjs';
import { writeJsonAtomic } from '../fs-utils.mjs';
import {
  NODE_CAPABILITIES,
  NODE_SURFACE_SLOTS,
  NODE_VIEW_TYPES,
  isKnownNodeKind,
} from './node-definitions.mjs';
import {
  canBuiltinHookProduceTaskMapPlan,
  getBuiltinHookDefinition,
  getBuiltinHookTaskMapPlanPolicy,
} from '../hooks/builtin-hook-catalog.mjs';

const TASK_MAP_PLAN_MODES = Object.freeze(['replace-default', 'augment-default']);
const TASK_MAP_EDGE_TYPES = Object.freeze(['structural', 'suggestion', 'completion', 'merge']);
const TASK_MAP_PLAN_SOURCE_TYPES = Object.freeze(['manual', 'system', 'hook']);
const TASK_MAP_HTML_RENDER_MODES = Object.freeze(['inline', 'iframe']);

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlanMode(value) {
  const normalized = trimText(value).toLowerCase();
  return TASK_MAP_PLAN_MODES.includes(normalized) ? normalized : 'replace-default';
}

function normalizeEdgeType(value) {
  const normalized = trimText(value).toLowerCase();
  return TASK_MAP_EDGE_TYPES.includes(normalized) ? normalized : 'structural';
}

function normalizePlanSourceType(value) {
  const normalized = trimText(value).toLowerCase();
  return TASK_MAP_PLAN_SOURCE_TYPES.includes(normalized) ? normalized : 'manual';
}

function normalizeAllowedTokenList(values, allowlist) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const normalized = values
    .map((value) => trimText(value).toLowerCase())
    .filter((value) => allowlist.includes(value));
  return [...new Set(normalized)];
}

function normalizeDimension(value, { min = 120, max = 1280 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.round(numeric);
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function normalizeNodeViewType(value) {
  const normalized = trimText(value).toLowerCase();
  return NODE_VIEW_TYPES.includes(normalized) ? normalized : 'flow-node';
}

function normalizeHtmlRenderMode(value) {
  const normalized = trimText(value).toLowerCase();
  return TASK_MAP_HTML_RENDER_MODES.includes(normalized) ? normalized : 'iframe';
}

function normalizeTaskMapPlanNodeView(view = {}) {
  if (!view || typeof view !== 'object' || Array.isArray(view)) return null;
  const type = normalizeNodeViewType(view.type);
  return {
    type,
    renderMode: type === 'html' ? normalizeHtmlRenderMode(view.renderMode) : '',
    content: typeof view.content === 'string' ? view.content : '',
    src: trimText(view.src),
    width: normalizeDimension(view.width, { min: 180, max: 1440 }),
    height: normalizeDimension(view.height, { min: 120, max: 1200 }),
  };
}

function eventMatchesHookPattern(eventId, eventPattern) {
  const normalizedEventId = trimText(eventId);
  const normalizedPattern = trimText(eventPattern);
  if (!normalizedEventId || !normalizedPattern) return false;
  if (normalizedPattern === '*' || normalizedPattern === normalizedEventId) return true;
  if (normalizedPattern.endsWith('.*')) {
    return normalizedEventId.startsWith(`${normalizedPattern.slice(0, -2)}.`);
  }
  return false;
}

function normalizeTaskMapPlanSource(source = {}, { requestedMode = 'replace-default' } = {}) {
  const sourceType = normalizePlanSourceType(source?.type);
  if (sourceType === 'hook') {
    const hookId = trimText(source?.hookId);
    const event = trimText(source?.event);
    if (!hookId || !canBuiltinHookProduceTaskMapPlan(hookId)) return null;
    const hookDefinition = getBuiltinHookDefinition(hookId);
    if (!hookDefinition) return null;
    if (event && !eventMatchesHookPattern(event, hookDefinition.eventPattern)) return null;
    const taskMapPlanPolicy = getBuiltinHookTaskMapPlanPolicy(hookId);
    return {
      type: 'hook',
      hookId,
      event: event || hookDefinition.eventPattern,
      generatedAt: trimText(source?.generatedAt || source?.updatedAt || ''),
      taskMapPlanPolicy,
      resolvedMode: taskMapPlanPolicy === 'replace-default' ? 'replace-default' : 'augment-default',
    };
  }
  return {
    type: sourceType,
    generatedAt: trimText(source?.generatedAt || source?.updatedAt || ''),
    taskMapPlanPolicy: 'none',
    resolvedMode: requestedMode,
  };
}

function normalizeTaskMapPlanNode(node = {}, { existingNodeIds = new Set() } = {}) {
  const id = trimText(node.id);
  if (!id || existingNodeIds.has(id)) return null;
  const kind = trimText(node.kind).toLowerCase();
  if (!kind || !isKnownNodeKind(kind)) return null;
  return {
    id,
    kind,
    title: trimText(node.title || id),
    summary: trimText(node.summary),
    sessionId: trimText(node.sessionId),
    sourceSessionId: trimText(node.sourceSessionId || node.sessionId),
    parentNodeId: trimText(node.parentNodeId || node.parentId),
    status: trimText(node.status).toLowerCase(),
    lineRole: trimText(node.lineRole).toLowerCase(),
    capabilities: normalizeAllowedTokenList(node.capabilities, NODE_CAPABILITIES),
    surfaceBindings: normalizeAllowedTokenList(node.surfaceBindings, NODE_SURFACE_SLOTS),
    view: normalizeTaskMapPlanNodeView(node.view),
  };
}

function normalizeTaskMapPlanEdge(edge = {}, { existingEdgeIds = new Set(), nodeIds = new Set() } = {}) {
  const fromNodeId = trimText(edge.fromNodeId || edge.from);
  const toNodeId = trimText(edge.toNodeId || edge.to);
  if (!fromNodeId || !toNodeId || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;
  const id = trimText(edge.id) || `edge:${fromNodeId}:${toNodeId}`;
  if (existingEdgeIds.has(id)) return null;
  return {
    id,
    fromNodeId,
    toNodeId,
    type: normalizeEdgeType(edge.type),
  };
}

export function normalizeTaskMapPlan(plan = {}) {
  const rootSessionId = trimText(plan.rootSessionId);
  if (!rootSessionId) return null;
  const requestedMode = normalizePlanMode(plan.mode);
  const source = normalizeTaskMapPlanSource(plan?.source, { requestedMode });
  if (!source) return null;
  const nodeIds = new Set();
  const nodes = [];
  for (const node of Array.isArray(plan.nodes) ? plan.nodes : []) {
    const normalizedNode = normalizeTaskMapPlanNode(node, { existingNodeIds: nodeIds });
    if (!normalizedNode) continue;
    nodeIds.add(normalizedNode.id);
    nodes.push(normalizedNode);
  }
  if (!nodes.length) return null;

  const edgeIds = new Set();
  const edges = [];
  for (const edge of Array.isArray(plan.edges) ? plan.edges : []) {
    const normalizedEdge = normalizeTaskMapPlanEdge(edge, { existingEdgeIds: edgeIds, nodeIds });
    if (!normalizedEdge) continue;
    edgeIds.add(normalizedEdge.id);
    edges.push(normalizedEdge);
  }

  return {
    id: trimText(plan.id) || `plan:${rootSessionId}`,
    questId: trimText(plan.questId) || `quest:${rootSessionId}`,
    rootSessionId,
    mode: source.resolvedMode,
    title: trimText(plan.title),
    summary: trimText(plan.summary),
    activeNodeId: trimText(plan.activeNodeId),
    nodes,
    edges,
    source,
    updatedAt: trimText(plan.updatedAt || plan.generatedAt || ''),
  };
}

function normalizeTaskMapPlans(value) {
  const plans = Array.isArray(value) ? value : [];
  const seenPlanIds = new Set();
  const normalized = [];
  for (const plan of plans) {
    const nextPlan = normalizeTaskMapPlan(plan);
    if (!nextPlan || seenPlanIds.has(nextPlan.id)) continue;
    seenPlanIds.add(nextPlan.id);
    normalized.push(nextPlan);
  }
  return normalized;
}

export function readTaskMapPlansSync() {
  try {
    const payload = JSON.parse(readFileSync(WORKBENCH_TASK_MAP_PLANS_FILE, 'utf8'));
    return normalizeTaskMapPlans(payload);
  } catch {
    return [];
  }
}

export async function readTaskMapPlans() {
  return readTaskMapPlansSync();
}

export async function persistTaskMapPlans(plans = []) {
  const normalized = normalizeTaskMapPlans(plans);
  await writeJsonAtomic(WORKBENCH_TASK_MAP_PLANS_FILE, normalized);
  return normalized;
}

export {
  TASK_MAP_PLAN_MODES,
  TASK_MAP_EDGE_TYPES,
  TASK_MAP_PLAN_SOURCE_TYPES,
};
