import { getRunForClient } from '../../services/run/http-service.mjs';
import { createRunPayload } from '../../views/run/http.mjs';

export async function handleRunReadRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJsonCached,
  writeJson,
} = {}) {
  if (!(pathname.startsWith('/api/runs/') && req?.method === 'GET')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);
  const runId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'runs' || !runId) {
    writeJson(res, 400, { error: 'Invalid run path' });
    return true;
  }
  const run = await getRunForClient(runId);
  if (!run) {
    writeJson(res, 404, { error: 'Run not found' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, run.sessionId)) return true;
  writeJsonCached(req, res, createRunPayload(run));
  return true;
}
