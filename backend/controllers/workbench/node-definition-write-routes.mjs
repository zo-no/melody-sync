import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import {
  createCustomNodeKind,
  deleteCustomNodeKind,
  updateCustomNodeKind,
} from '../../workbench/node-settings-store.mjs';
import { createWorkbenchNodeDefinitionsPayload } from '../../workbench/node-definitions.mjs';

export async function handleWorkbenchNodeDefinitionWriteRoutes(ctx) {
  const { req, res, pathname, writeJson } = ctx;
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      await createCustomNodeKind(payload);
      writeJson(res, 201, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to create custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'PATCH') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      await updateCustomNodeKind(nodeKindId, payload);
      writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    try {
      await deleteCustomNodeKind(nodeKindId);
      writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete custom node kind' });
    }
    return true;
  }

  return false;
}
