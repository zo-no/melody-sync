import { handleSessionDeleteRoutes } from '../controllers/session/delete-routes.mjs';
import { handleSessionPatchRoutes } from '../controllers/session/patch-routes.mjs';
import { handleSessionPostRoutes } from '../controllers/session/post-routes.mjs';

export async function handleSessionWriteRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (await handleSessionPostRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) return true;

  if (await handleSessionPatchRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) return true;

  if (await handleSessionDeleteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) return true;

  return false;
}
