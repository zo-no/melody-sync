import {
  createCustomNodeKind,
  deleteCustomNodeKind,
  updateCustomNodeKind,
} from '../../workbench/node-settings-store.mjs';
import { createWorkbenchNodeDefinitionsPayload } from '../../workbench/node-definitions.mjs';

export function getWorkbenchNodeDefinitionsResponse() {
  return createWorkbenchNodeDefinitionsPayload();
}

export async function createWorkbenchNodeDefinitionResponse(payload) {
  await createCustomNodeKind(payload);
  return getWorkbenchNodeDefinitionsResponse();
}

export async function updateWorkbenchNodeDefinitionResponse(nodeKindId, payload) {
  await updateCustomNodeKind(nodeKindId, payload);
  return getWorkbenchNodeDefinitionsResponse();
}

export async function deleteWorkbenchNodeDefinitionResponse(nodeKindId) {
  await deleteCustomNodeKind(nodeKindId);
  return getWorkbenchNodeDefinitionsResponse();
}
