import { listBuiltinHookDefinitions } from '../hooks/builtin-hook-catalog.mjs';
import {
  NODE_CAPABILITIES,
  NODE_SURFACE_SLOTS,
  NODE_TASK_CARD_BINDING_KEYS,
  NODE_VIEW_TYPES,
  listNodeKindDefinitions,
} from './node-definitions.mjs';
import {
  TASK_MAP_EDGE_TYPES,
  TASK_MAP_PLAN_MODES,
  TASK_MAP_PLAN_SOURCE_TYPES,
} from './task-map-plans.mjs';

export function listTaskMapPlanCapableHooks() {
  return listBuiltinHookDefinitions()
    .filter((definition) => definition?.producesTaskMapPlan === true)
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      eventPattern: definition.eventPattern,
      scope: definition.scope,
      phase: definition.phase,
      taskMapPlanPolicy: definition.taskMapPlanPolicy,
    }));
}

export function createTaskMapPlanContractPayload() {
  return {
    planModes: [...TASK_MAP_PLAN_MODES],
    edgeTypes: [...TASK_MAP_EDGE_TYPES],
    sourceTypes: [...TASK_MAP_PLAN_SOURCE_TYPES],
    viewTypes: [...NODE_VIEW_TYPES],
    surfaceSlots: [...NODE_SURFACE_SLOTS],
    capabilities: [...NODE_CAPABILITIES],
    taskCardBindingKeys: [...NODE_TASK_CARD_BINDING_KEYS],
    fallbackProjection: 'continuity',
    nodeKindDefinitions: listNodeKindDefinitions(),
    planCapableHooks: listTaskMapPlanCapableHooks(),
    settings: {
      supportsHookGeneratedPlans: true,
      supportsManualPlans: true,
      supportsSystemPlans: true,
      supportsSessionScopedPlanWriteApi: true,
      supportsSessionScopedGraphReadApi: true,
      supportsSessionScopedSurfaceReadApi: true,
      supportsRichCanvasViews: true,
      fallbackProjection: 'continuity',
    },
  };
}
