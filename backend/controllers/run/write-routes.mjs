import { cancelActiveRun, getRunState } from '../../session/manager.mjs';

export async function handleRunWriteRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJson } = ctx;
  if (!(pathname.startsWith('/api/runs/') && req?.method === 'POST')) {
    return false;
  }
  const runId = parts[2];
  const action = parts[3];
  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'runs' && action === 'cancel' && runId) {
    const run = await getRunState(runId);
    if (!run) {
      writeJson(res, 404, { error: 'Run not found' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, run.sessionId)) return true;
    const updated = await cancelActiveRun(run.sessionId);
    if (!updated) {
      const refreshed = await getRunState(runId);
      if (refreshed && refreshed.state !== 'running' && refreshed.state !== 'accepted') {
        writeJson(res, 200, { run: refreshed });
        return true;
      }
      writeJson(res, 409, { error: 'No active run' });
      return true;
    }
    writeJson(res, 200, { run: updated });
    return true;
  }

  return false;
}
