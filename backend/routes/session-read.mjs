import { handleSessionCatalogReadRoutes } from '../controllers/session/read-catalog-routes.mjs';
import { handleSessionEventReadRoutes } from '../controllers/session/read-event-routes.mjs';

export async function handleSessionReadRoutes({
  req,
  res,
  parsedUrl,
  sessionGetRoute,
  authSession,
  requireSessionAccess,
  writeJsonCached,
  writeJson,
} = {}) {
  if (await handleSessionCatalogReadRoutes({
    req,
    res,
    parsedUrl,
    sessionGetRoute,
    authSession,
    requireSessionAccess,
    writeJsonCached,
    writeJson,
  })) return true;

  if (await handleSessionEventReadRoutes({
    req,
    res,
    parsedUrl,
    sessionGetRoute,
    authSession,
    requireSessionAccess,
    writeJsonCached,
    writeJson,
  })) return true;

  return false;
}
