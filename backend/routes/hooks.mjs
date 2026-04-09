import { handleHookReadRoutes } from '../controllers/hooks/read-routes.mjs';
import { handleHookWriteRoutes } from '../controllers/hooks/write-routes.mjs';

export async function handleHooksRoutes({ req, res, pathname, writeJson } = {}) {
  if (await handleHookReadRoutes({ req, res, pathname, writeJson })) return true;
  if (await handleHookWriteRoutes({ req, res, pathname, writeJson })) return true;

  return false;
}
