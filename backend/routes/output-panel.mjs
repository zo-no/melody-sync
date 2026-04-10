import { handleOutputPanelReadRoutes } from '../controllers/output-panel/read-routes.mjs';

export async function handleOutputPanelRoutes({
  req,
  res,
  pathname,
  parsedUrl,
  writeJson,
  writeJsonCached,
} = {}) {
  return handleOutputPanelReadRoutes({
    req,
    res,
    pathname,
    parsedUrl,
    writeJson,
    writeJsonCached,
  });
}
