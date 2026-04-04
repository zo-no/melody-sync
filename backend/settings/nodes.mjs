import { createWorkbenchNodeDefinitionsPayload } from '../workbench/node-definitions.mjs';
import {
  createCustomNodeKind,
  deleteCustomNodeKind,
  updateCustomNodeKind,
} from '../workbench/node-settings-store.mjs';

export function createNodeSettingsPayload() {
  return createWorkbenchNodeDefinitionsPayload();
}

export async function createNodeSetting(payload) {
  await createCustomNodeKind(payload);
  return createNodeSettingsPayload();
}

export async function updateNodeSetting(nodeKindId, payload) {
  await updateCustomNodeKind(nodeKindId, payload);
  return createNodeSettingsPayload();
}

export async function deleteNodeSetting(nodeKindId) {
  await deleteCustomNodeKind(nodeKindId);
  return createNodeSettingsPayload();
}

