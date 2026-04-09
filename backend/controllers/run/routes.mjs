import { cancelRunForClient, getRunForClient } from '../../services/run/http-service.mjs';
import { createRunPayload } from '../../views/run/http.mjs';

export async function handleRunRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJsonCached,
  writeJson,
} = {}) {
  if (pathname.startsWith('/api/runs/') && req?.method === 'GET') {
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

  if (pathname.startsWith('/api/runs/') && req?.method === 'POST') {
    const parts = pathname.split('/').filter(Boolean);
    const runId = parts[2];
    const action = parts[3];
    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'runs' && action === 'cancel' && runId) {
      const run = await getRunForClient(runId);
      if (!run) {
        writeJson(res, 404, { error: 'Run not found' });
        return true;
      }
      if (!requireSessionAccess(res, authSession, run.sessionId)) return true;
      const updated = await cancelRunForClient(run);
      if (!updated) {
        const refreshed = await getRunForClient(runId);
        if (refreshed && refreshed.state !== 'running' && refreshed.state !== 'accepted') {
          writeJson(res, 200, createRunPayload(refreshed));
          return true;
        }
        writeJson(res, 409, { error: 'No active run' });
        return true;
      }
      writeJson(res, 200, createRunPayload(updated));
      return true;
    }
  }

  return false;
}
