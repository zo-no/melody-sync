import { getOutputPanelPayload } from '../../services/output-panel/read-service.mjs';
import { getQueryValue } from '../../shared/http/query.mjs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { MEMORY_DIR } from '../../../lib/config.mjs';

async function getDailySummary() {
  // Read yesterday's worklog
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const year = String(yesterday.getFullYear());
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;
  const worklogPath = join(MEMORY_DIR, 'worklog', year, month, `${dateKey}.md`);

  let worklogContent = '';
  try {
    worklogContent = await readFile(worklogPath, 'utf8');
  } catch {
    // No worklog for yesterday
  }

  // Also read today's maintenance state (lives alongside sessions/, not in memory/)
  let maintenanceState = {};
  try {
    const raw = await readFile(
      join(MEMORY_DIR, '..', 'sessions', 'session-daily-maintenance.json'),
      'utf8'
    );
    maintenanceState = JSON.parse(raw);
  } catch {}

  return {
    date: dateKey,
    worklog: worklogContent,
    lastSweep: maintenanceState?.lastDailySweepDate || '',
    archivedCount: maintenanceState?.archivedCount || 0,
  };
}

export async function handleOutputPanelReadRoutes(ctx) {
  const { req, res, pathname, parsedUrl, writeJson, writeJsonCached } = ctx;

  if (pathname === '/api/daily-summary' && req?.method === 'GET') {
    const summary = await getDailySummary();
    writeJson(res, 200, summary);
    return true;
  }

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
