import { handleWorkbenchReadRoutes } from '../controllers/workbench/read-routes.mjs';
import { handleWorkbenchWriteRoutes } from '../controllers/workbench/write-routes.mjs';

export async function handleWorkbenchRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (await handleWorkbenchReadRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) {
    return true;
  }

  if (await handleWorkbenchWriteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) {
    return true;
  }

  return false;
}
