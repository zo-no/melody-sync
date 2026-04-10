import { getOutputPanelPayload } from '../../services/output-panel/read-service.mjs';

function getQueryValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

export async function handleOutputPanelReadRoutes({
  req,
  res,
  pathname,
  parsedUrl,
  writeJson,
  writeJsonCached,
} = {}) {
  if (pathname !== '/api/output-panel' || req?.method !== 'GET') {
    return false;
  }

  const sessionId = getQueryValue(parsedUrl?.query?.sessionId);
  const scope = getQueryValue(parsedUrl?.query?.scope);
  const payload = await getOutputPanelPayload({ sessionId, scope });
  if (typeof writeJsonCached === 'function') {
    writeJsonCached(req, res, payload, {
      cacheControl: 'private, no-cache',
    });
    return true;
  }
  writeJson(res, 200, payload);
  return true;
}
