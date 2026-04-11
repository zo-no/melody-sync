import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import { handleWorkbenchNodeDefinitionWriteRoutes } from './node-definition-write-routes.mjs';
import { handleWorkbenchProjectWriteRoutes } from './project-write-routes.mjs';
import {
  handleWorkbenchSessionDeleteRoutes,
  handleWorkbenchSessionWriteRoutes,
} from './session-write-routes.mjs';

export async function handleWorkbenchWriteRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJson } = ctx;
  if (await handleWorkbenchNodeDefinitionWriteRoutes(ctx)) {
    return true;
  }

  if (pathname.startsWith('/api/workbench/') && req?.method === 'DELETE') {
    if (await handleWorkbenchSessionDeleteRoutes({
      parts,
      authSession,
      requireSessionAccess,
      res,
      writeJson,
    })) {
      return true;
    }
    return false;
  }

  if (!(pathname.startsWith('/api/workbench/') && req?.method === 'POST')) {
    return false;
  }

  let payload = {};
  try {
    payload = await readJsonRequestBody(req, 65536);
  } catch {
    writeJson(res, 400, { error: 'Invalid request body' });
    return true;
  }

  try {
    if (await handleWorkbenchProjectWriteRoutes({
      parts,
      payload,
      res,
      writeJson,
    })) {
      return true;
    }

    if (await handleWorkbenchSessionWriteRoutes({
      parts,
      payload,
      authSession,
      requireSessionAccess,
      res,
      writeJson,
    })) {
      return true;
    }
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Workbench request failed' });
    return true;
  }

  writeJson(res, 404, { error: 'Workbench route not found' });
  return true;
}
