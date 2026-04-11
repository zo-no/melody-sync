import { loadSessionsMeta } from '../session/meta-store.mjs';
import { resolvePersistentDueTriggerKind } from './core.mjs';
import { getSession, runSessionPersistent } from '../session/manager.mjs';
import { scanDailySessionMaintenance } from './daily-maintenance.mjs';

const DEFAULT_SCAN_INTERVAL_MS = 30 * 1000;

let schedulerTimer = null;
let scanInFlight = false;
const dispatchingSessionIds = new Set();

function isSessionBusy(session) {
  return session?.activity?.run?.state === 'running'
    || (Number.isInteger(session?.activity?.queue?.count) && session.activity.queue.count > 0)
    || session?.activity?.compact?.state === 'pending';
}

export async function scanDuePersistentSessions(nowValue = new Date()) {
  if (scanInFlight) return;
  scanInFlight = true;
  try {
    const sessions = await loadSessionsMeta();
    for (const meta of Array.isArray(sessions) ? sessions : []) {
      const sessionId = typeof meta?.id === 'string' ? meta.id.trim() : '';
      if (!sessionId || meta?.archived === true || dispatchingSessionIds.has(sessionId)) continue;
      const triggerKind = resolvePersistentDueTriggerKind(meta?.persistent, nowValue);
      if (!triggerKind) continue;

      dispatchingSessionIds.add(sessionId);
      try {
        const session = await getSession(sessionId, { includeQueuedMessages: true });
        if (!session || session.archived === true || isSessionBusy(session)) continue;
        await runSessionPersistent(sessionId, { triggerKind });
      } catch (error) {
        console.error(`[persistent-scheduler] Failed to run ${sessionId}: ${error.message}`);
      } finally {
        dispatchingSessionIds.delete(sessionId);
      }
    }
  } finally {
    scanInFlight = false;
  }
}

export function startPersistentSessionScheduler({ intervalMs = DEFAULT_SCAN_INTERVAL_MS } = {}) {
  if (schedulerTimer) return;
  const tick = () => {
    Promise.all([
      scanDuePersistentSessions(),
      scanDailySessionMaintenance(),
    ]).catch((error) => {
      console.error('[persistent-scheduler] Scan failed:', error.message);
    });
  };
  schedulerTimer = setInterval(tick, intervalMs);
  schedulerTimer.unref?.();
  tick();
}

export function stopPersistentSessionScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}
