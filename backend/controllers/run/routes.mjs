import { handleRunReadRoutes } from './read-routes.mjs';
import { handleRunWriteRoutes } from './write-routes.mjs';

export async function handleRunRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJsonCached,
  writeJson,
} = {}) {
  if (await handleRunReadRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJsonCached,
    writeJson,
  })) return true;

  if (await handleRunWriteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    writeJson,
  })) return true;

  return false;
}
