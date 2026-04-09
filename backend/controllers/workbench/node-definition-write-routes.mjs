import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import {
  createWorkbenchNodeDefinitionResponse,
  deleteWorkbenchNodeDefinitionResponse,
  updateWorkbenchNodeDefinitionResponse,
} from '../../services/workbench/node-definitions-http-service.mjs';

export async function handleWorkbenchNodeDefinitionWriteRoutes({
  req,
  res,
  pathname,
  writeJson,
} = {}) {
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      writeJson(res, 201, await createWorkbenchNodeDefinitionResponse(payload));
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
      writeJson(res, 200, await updateWorkbenchNodeDefinitionResponse(nodeKindId, payload));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    try {
      writeJson(res, 200, await deleteWorkbenchNodeDefinitionResponse(nodeKindId));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete custom node kind' });
    }
    return true;
  }

  return false;
}
