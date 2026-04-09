import { handleSystemReadRoutes } from '../controllers/system/read-routes.mjs';
import { handleSystemWriteRoutes } from '../controllers/system/write-routes.mjs';

export async function handleSystemRoutes({
  req,
  res,
  pathname,
  parsedUrl,
  writeJson,
  writeJsonCached,
  writeFileCached,
  getAuthSession,
  refreshAuthSession,
  playHostCompletionSound,
}) {
  if (await handleSystemReadRoutes({
    req,
    res,
    pathname,
    parsedUrl,
    writeJson,
    writeJsonCached,
    writeFileCached,
    getAuthSession,
    refreshAuthSession,
  })) return true;

  if (await handleSystemWriteRoutes({
    req,
    res,
    pathname,
    writeJson,
    getAuthSession,
    playHostCompletionSound,
  })) return true;

  return false;
}
