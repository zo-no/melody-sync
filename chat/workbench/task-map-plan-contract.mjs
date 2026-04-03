import { listBuiltinHookDefinitions } from '../hooks/builtin-hook-catalog.mjs';
import { listNodeKindDefinitions } from './node-definitions.mjs';
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
    fallbackProjection: 'continuity',
    nodeKindDefinitions: listNodeKindDefinitions(),
    planCapableHooks: listTaskMapPlanCapableHooks(),
    settings: {
      supportsHookGeneratedPlans: true,
      supportsManualPlans: true,
      supportsSystemPlans: true,
      fallbackProjection: 'continuity',
    },
  };
}
