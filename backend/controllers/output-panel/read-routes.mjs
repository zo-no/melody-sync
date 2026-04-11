import { getOutputPanelPayload } from '../../services/output-panel/read-service.mjs';
import { getQueryValue } from '../../shared/http/query.mjs';

export async function handleOutputPanelReadRoutes(ctx) {
  const { req, res, pathname, parsedUrl, writeJson, writeJsonCached } = ctx;
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
