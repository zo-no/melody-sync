import { randomBytes } from 'crypto';
import { appendEvent } from './history.mjs';
import { statusEvent } from './normalizer.mjs';
import {
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  submitHttpMessage,
} from './session-manager.mjs';
import { loadSessionsMeta, mutateSessionMeta } from './session-meta-store.mjs';
import {
  computeNextScheduledTriggerRunAt,
  getPrimaryScheduledTrigger,
  normalizeScheduledTriggers,
} from './scheduled-trigger-utils.mjs';

const SCHEDULED_TRIGGER_SWEEP_MS = 30 * 1000;

let scheduledTriggerSweepTimer = null;
let scheduledTriggerSweepPromise = null;
const activeDispatches = new Set();

function nowIso() {
  return new Date().toISOString();
}

function createScheduledRequestId(sessionId, reason = 'scheduled') {
  const suffix = randomBytes(6).toString('hex');
  return `scheduled_${reason}_${sessionId}_${suffix}`;
}

function createDueStatusMessage(trigger, scheduledFor) {
  const label = typeof trigger?.label === 'string' && trigger.label.trim()
    ? trigger.label.trim()
    : 'Scheduled trigger';
  const slot = trigger?.recurrenceType === 'interval'
    ? (trigger?.intervalMinutes ? `every ${trigger.intervalMinutes}m` : '')
    : (typeof trigger?.timeOfDay === 'string' ? trigger.timeOfDay : '');
  const scheduledStamp = typeof scheduledFor === 'string' && scheduledFor
    ? ` (scheduled for ${scheduledFor})`
    : '';
  return `${label}${slot ? ` fired at ${slot}` : ' fired'}${scheduledStamp}`;
}

function getStoredSessionTriggers(session) {
  return normalizeScheduledTriggers(session?.scheduledTriggers || session?.scheduledTrigger, {
    preserveRuntimeState: true,
  });
}

async function updateTriggerDispatchResult(sessionId, triggerId, {
  lastRunAt,
  lastRunStatus,
  lastError = '',
} = {}) {
  const result = await mutateSessionMeta(sessionId, (session) => {
    const triggers = getStoredSessionTriggers(session);
    const index = triggers.findIndex((entry) => entry.id === triggerId);
    if (index === -1) return false;
    const nextTrigger = {
      ...triggers[index],
      ...(lastRunAt ? { lastRunAt } : {}),
      ...(lastRunStatus ? { lastRunStatus } : {}),
      ...(lastError ? { lastError } : {}),
    };
    if (!lastError && nextTrigger.lastError) {
      delete nextTrigger.lastError;
    }
    const nextTriggers = triggers.slice();
    nextTriggers[index] = nextTrigger;
    session.scheduledTriggers = nextTriggers;
    delete session.scheduledTrigger;
    session.updatedAt = nowIso();
    return true;
  });
  if (result.changed) {
    broadcastSessionInvalidation(sessionId);
    broadcastSessionsInvalidation();
  }
}

async function dispatchScheduledTrigger(sessionId, trigger, {
  reason = 'scheduled',
  scheduledFor = '',
  advanceSchedule = false,
  nowMs = Date.now(),
} = {}) {
  const dispatchKey = `${sessionId}:${trigger.id || 'trigger'}:${reason}`;
  if (activeDispatches.has(dispatchKey)) {
    return { ok: false, skipped: true, reason: 'already_running' };
  }
  activeDispatches.add(dispatchKey);

  try {
    if (advanceSchedule) {
      await mutateSessionMeta(sessionId, (session) => {
        const currentTriggers = getStoredSessionTriggers(session);
        const index = currentTriggers.findIndex((entry) => entry.id === trigger.id);
        if (index === -1) return false;
        const currentTrigger = currentTriggers[index];
        if (currentTrigger.enabled === false) return false;
        const nextTriggers = currentTriggers.slice();
        const previousScheduledAtMs = Date.parse(currentTrigger.nextRunAt || '');
        nextTriggers[index] = {
          ...currentTrigger,
          nextRunAt: computeNextScheduledTriggerRunAt(currentTrigger, nowMs + 1000, previousScheduledAtMs),
          lastRunAt: nowIso(),
          lastRunStatus: 'dispatching',
          lastError: '',
        };
        session.scheduledTriggers = nextTriggers;
        delete session.scheduledTrigger;
        session.updatedAt = nowIso();
        return true;
      });
      broadcastSessionInvalidation(sessionId);
      broadcastSessionsInvalidation();
    }

    await appendEvent(sessionId, statusEvent(createDueStatusMessage(trigger, scheduledFor || '')));
    const response = await submitHttpMessage(sessionId, trigger.content, [], {
      requestId: createScheduledRequestId(sessionId, reason),
      internalOperation: 'scheduled_trigger',
      scheduledTriggerId: trigger.id || '',
      recordedUserText: trigger.content,
      ...(trigger.model ? { model: trigger.model } : {}),
    });
    await updateTriggerDispatchResult(sessionId, trigger.id, {
      lastRunAt: nowIso(),
      lastRunStatus: response?.queued ? 'queued' : 'started',
      lastError: '',
    });
    return { ok: true, queued: response?.queued === true };
  } catch (error) {
    await updateTriggerDispatchResult(sessionId, trigger.id, {
      lastRunAt: nowIso(),
      lastRunStatus: 'failed',
      lastError: error?.message || 'Scheduled trigger dispatch failed',
    });
    return { ok: false, error };
  } finally {
    activeDispatches.delete(dispatchKey);
  }
}

function getDueTriggers(nowMs = Date.now()) {
  return loadSessionsMeta().then((metas) => metas
    .filter((meta) => !meta.archived && !meta.visitorId)
    .flatMap((meta) => getStoredSessionTriggers(meta).map((trigger) => ({
      sessionId: meta.id,
      trigger,
    })))
    .filter((entry) => entry.trigger?.enabled !== false)
    .filter((entry) => {
      const nextRunAtMs = Date.parse(entry.trigger?.nextRunAt || '');
      return Number.isFinite(nextRunAtMs) && nextRunAtMs <= nowMs;
    }));
}

export async function runScheduledTriggerSweep({ nowMs = Date.now() } = {}) {
  const due = await getDueTriggers(nowMs);
  const results = [];
  for (const entry of due) {
    results.push(await dispatchScheduledTrigger(entry.sessionId, entry.trigger, {
      reason: 'scheduled',
      scheduledFor: entry.trigger.nextRunAt || '',
      advanceSchedule: true,
      nowMs,
    }));
  }
  return results;
}

export async function triggerScheduledSessionNow(sessionId, triggerId = '') {
  const metas = await loadSessionsMeta();
  const meta = metas.find((entry) => entry.id === sessionId) || null;
  const triggers = getStoredSessionTriggers(meta);
  const trigger = triggerId
    ? triggers.find((entry) => entry.id === triggerId)
    : getPrimaryScheduledTrigger(triggers);
  if (!trigger) {
    const error = new Error('Scheduled trigger not configured');
    error.code = 'SCHEDULED_TRIGGER_MISSING';
    throw error;
  }
  return dispatchScheduledTrigger(sessionId, trigger, {
    reason: 'manual',
    advanceSchedule: false,
  });
}

export async function startScheduledTriggerRunner() {
  if (scheduledTriggerSweepTimer) return;
  const runSweep = async () => {
    if (scheduledTriggerSweepPromise) return scheduledTriggerSweepPromise;
    scheduledTriggerSweepPromise = runScheduledTriggerSweep().catch((error) => {
      console.error('[scheduled-trigger] sweep failed:', error);
    }).finally(() => {
      scheduledTriggerSweepPromise = null;
    });
    return scheduledTriggerSweepPromise;
  };

  await runSweep();
  scheduledTriggerSweepTimer = setInterval(() => {
    void runSweep();
  }, SCHEDULED_TRIGGER_SWEEP_MS);
}

export function stopScheduledTriggerRunner() {
  if (!scheduledTriggerSweepTimer) return;
  clearInterval(scheduledTriggerSweepTimer);
  scheduledTriggerSweepTimer = null;
}
