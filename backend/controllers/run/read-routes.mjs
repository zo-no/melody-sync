import { getRunState } from '../../session/manager.mjs';

export async function handleRunReadRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJsonCached, writeJson } = ctx;
  if (!(pathname.startsWith('/api/runs/') && req?.method === 'GET')) {
    return false;
  }
  const runId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'runs' || !runId) {
    writeJson(res, 400, { error: 'Invalid run path' });
    return true;
  }
  const run = await getRunState(runId);
  if (!run) {
    writeJson(res, 404, { error: 'Run not found' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, run.sessionId)) return true;
  writeJsonCached(req, res, { run });
  return true;
}
