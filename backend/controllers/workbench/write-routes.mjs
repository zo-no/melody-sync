import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import { handleWorkbenchNodeDefinitionWriteRoutes } from './node-definition-write-routes.mjs';
import { handleWorkbenchProjectWriteRoutes } from './project-write-routes.mjs';
import {
  handleWorkbenchSessionDeleteRoutes,
  handleWorkbenchSessionWriteRoutes,
} from './session-write-routes.mjs';

export async function handleWorkbenchWriteRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (await handleWorkbenchNodeDefinitionWriteRoutes({
    req,
    res,
    pathname,
    writeJson,
  })) {
    return true;
  }

  if (pathname.startsWith('/api/workbench/') && req?.method === 'DELETE') {
    if (await handleWorkbenchSessionDeleteRoutes({
      pathname,
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

  const parts = pathname.split('/').filter(Boolean);
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
