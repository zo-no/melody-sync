import { loadHistory } from '../../history.mjs';
import {
  buildPersistentDigest,
  buildPersistentRunMessage,
  computeNextRecurringRunAt,
  normalizeSessionPersistent,
  resolvePersistentRunRuntime,
} from '../../session-persistent/core.mjs';

function mergeObjectShape(current, patch) {
  const currentValue = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patchValue = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return { ...currentValue, ...patchValue };
}

function getPersistentSessionGroup(kind = '') {
  const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (normalizedKind === 'skill') return '快捷按钮';
  if (normalizedKind === 'recurring_task') return '长期任务';
  return '';
}

function resolveLocalTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
}

async function buildSessionPersistentDigest(sessionId, session) {
  const history = await loadHistory(sessionId, { includeBodies: false }).catch(() => []);
  return buildPersistentDigest(session, history);
}

function buildSessionPersistentPatch(currentPersistent, patch = {}) {
  const currentRuntimePolicy = currentPersistent?.runtimePolicy && typeof currentPersistent.runtimePolicy === 'object'
    ? currentPersistent.runtimePolicy
    : {};
  const patchRuntimePolicy = patch?.runtimePolicy && typeof patch.runtimePolicy === 'object'
    ? patch.runtimePolicy
    : {};
  return {
    ...(currentPersistent && typeof currentPersistent === 'object' ? currentPersistent : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
    digest: mergeObjectShape(currentPersistent?.digest, patch?.digest),
    execution: mergeObjectShape(currentPersistent?.execution, patch?.execution),
    recurring: mergeObjectShape(currentPersistent?.recurring, patch?.recurring || patch?.schedule),
    skill: mergeObjectShape(currentPersistent?.skill, patch?.skill),
    runtimePolicy: {
      ...currentRuntimePolicy,
      ...patchRuntimePolicy,
      manual: mergeObjectShape(currentRuntimePolicy?.manual, patchRuntimePolicy?.manual),
      schedule: mergeObjectShape(currentRuntimePolicy?.schedule, patchRuntimePolicy?.schedule),
    },
  };
}

export function createSessionPersistentService({
  broadcastSessionInvalidation,
  createInternalRequestId,
  createSession,
  enrichSessionMeta,
  getSession,
  getSessionQueueCount,
  isSessionRunning,
  mutateSessionMeta,
  nowIso,
  submitHttpMessage,
}) {
  async function updateSessionPersistent(id, persistent, options = {}) {
    const currentSession = await getSession(id, { includeQueuedMessages: true });
    if (!currentSession) return null;

    const timezone = resolveLocalTimezone();
    const defaultDigest = options.rebuildDigest === true
      ? await buildSessionPersistentDigest(id, currentSession)
      : (currentSession?.persistent?.digest || await buildSessionPersistentDigest(id, currentSession));
    const recomputeNextRunAt = options.recomputeNextRunAt === true
      || Boolean(persistent?.recurring)
      || Boolean(persistent?.schedule);
    const nextPersistent = persistent === null
      ? null
      : normalizeSessionPersistent(
        buildSessionPersistentPatch(currentSession?.persistent, persistent),
        {
          defaultDigest,
          defaultRuntime: currentSession,
          recomputeNextRunAt,
          referenceTime: options.referenceTime || new Date(),
          defaultTimezone: timezone,
          now: nowIso(),
        },
      );

    const result = await mutateSessionMeta(id, (session) => {
      const currentNormalized = normalizeSessionPersistent(session.persistent || null, {
        defaultDigest,
        defaultRuntime: session,
        defaultTimezone: timezone,
      });
      const nextGroup = nextPersistent ? getPersistentSessionGroup(nextPersistent.kind) : '';
      const shouldClearPersistentGroup = !nextPersistent && (session.group === '长期任务' || session.group === '快捷按钮');
      if (
        JSON.stringify(currentNormalized) === JSON.stringify(nextPersistent)
        && (!nextGroup || session.group === nextGroup)
        && !shouldClearPersistentGroup
      ) {
        return false;
      }
      if (nextPersistent) {
        session.persistent = nextPersistent;
        if (nextGroup && session.group !== nextGroup) {
          session.group = nextGroup;
        }
      } else if (session.persistent) {
        delete session.persistent;
        if (session.group === '长期任务' || session.group === '快捷按钮') {
          delete session.group;
        }
      }
      session.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  async function promoteSessionToPersistent(id, payload = {}) {
    const session = await getSession(id, { includeQueuedMessages: true });
    if (!session) return null;
    if (session.archived === true) {
      throw new Error('Archived sessions cannot become persistent items');
    }
    if (isSessionRunning(session) || getSessionQueueCount(session) > 0) {
      throw new Error('Session is busy');
    }

    const timezone = resolveLocalTimezone();
    const defaultDigest = await buildSessionPersistentDigest(id, session);
    const nextPersistent = normalizeSessionPersistent({
      ...(session?.persistent && typeof session.persistent === 'object' ? session.persistent : {}),
      ...(payload && typeof payload === 'object' ? payload : {}),
      kind: payload?.kind || payload?.type,
      digest: mergeObjectShape(defaultDigest, payload?.digest),
      execution: mergeObjectShape(session?.persistent?.execution, payload?.execution),
      recurring: mergeObjectShape(session?.persistent?.recurring, payload?.recurring || payload?.schedule),
      skill: mergeObjectShape(session?.persistent?.skill, payload?.skill),
      runtimePolicy: {
        ...(session?.persistent?.runtimePolicy && typeof session.persistent.runtimePolicy === 'object'
          ? session.persistent.runtimePolicy
          : {}),
        ...(payload?.runtimePolicy && typeof payload.runtimePolicy === 'object'
          ? payload.runtimePolicy
          : {}),
      },
      promotedAt: session?.persistent?.promotedAt || nowIso(),
      updatedAt: nowIso(),
      state: payload?.state || session?.persistent?.state || 'active',
    }, {
      defaultDigest,
      defaultRuntime: session,
      recomputeNextRunAt: true,
      referenceTime: new Date(),
      defaultTimezone: timezone,
      now: nowIso(),
    });

    if (!nextPersistent) {
      throw new Error('Invalid persistent configuration');
    }

    const nextName = String(nextPersistent?.digest?.title || session?.name || '').trim() || '未命名长期项';
    const nextGroup = getPersistentSessionGroup(nextPersistent.kind);
    const persistentSession = await createSession(
      session.folder,
      session.tool || '',
      nextName,
      {
        group: nextGroup,
        description: String(nextPersistent?.digest?.summary || '').trim(),
        sourceId: session.sourceId || '',
        sourceName: session.sourceName || '',
        userId: session.userId || '',
        userName: session.userName || '',
        systemPrompt: session.systemPrompt || '',
        model: session.model || '',
        effort: session.effort || '',
        thinking: session.thinking === true,
        activeAgreements: session.activeAgreements || [],
        sourceContext: session.sourceContext || null,
        workflowState: session.workflowState || '',
        workflowPriority: session.workflowPriority || '',
        forkedFromSessionId: session.id,
        forkedFromSeq: session.latestSeq || 0,
        rootSessionId: session.rootSessionId || session.id,
        persistent: nextPersistent,
        taskListOrigin: 'user',
        taskListVisibility: 'primary',
      },
    );

    if (!persistentSession) return null;
    return persistentSession;
  }

  async function runSessionPersistent(id, options = {}) {
    const session = await getSession(id, { includeQueuedMessages: true });
    if (!session) return null;

    const timezone = resolveLocalTimezone();
    const persistent = normalizeSessionPersistent(session?.persistent || null, {
      defaultDigest: await buildSessionPersistentDigest(id, session),
      defaultRuntime: session,
      defaultTimezone: timezone,
    });
    if (!persistent) {
      throw new Error('Session is not a persistent item');
    }
    if (session.archived === true) {
      throw new Error('Archived sessions cannot be executed');
    }
    if (persistent.kind === 'recurring_task' && persistent.state !== 'active' && options.triggerKind === 'schedule') {
      throw new Error('Recurring task is paused');
    }
    if (isSessionRunning(session) || getSessionQueueCount(session) > 0) {
      throw new Error('Session is busy');
    }

    const triggerKind = String(options.triggerKind || '').trim().toLowerCase() === 'schedule' ? 'schedule' : 'manual';
    const runtime = resolvePersistentRunRuntime(session, persistent, {
      triggerKind,
      runtime: options.runtime,
    });
    const text = buildPersistentRunMessage(session, persistent, {
      triggerKind,
      runPrompt: options.runPrompt || '',
    });
    const outcome = await submitHttpMessage(id, text, [], {
      requestId: createInternalRequestId(triggerKind === 'schedule' ? 'persistent_schedule' : 'persistent_run'),
      queueIfBusy: false,
      scheduledTriggerId: triggerKind === 'schedule' ? `persistent:${id}` : '',
      ...(runtime?.tool ? { tool: runtime.tool } : {}),
      ...(runtime?.model ? { model: runtime.model } : {}),
      ...(runtime?.effort ? { effort: runtime.effort } : {}),
      thinking: runtime?.thinking === true,
    });

    const referenceTime = new Date();
    await updateSessionPersistent(id, {
      execution: {
        ...(persistent.execution || {}),
        lastTriggerAt: referenceTime.toISOString(),
        lastTriggerKind: triggerKind,
      },
      ...(persistent.kind === 'recurring_task'
        ? {
            recurring: {
              ...(persistent.recurring || {}),
              lastRunAt: referenceTime.toISOString(),
              nextRunAt: computeNextRecurringRunAt(persistent.recurring || {}, referenceTime),
            },
          }
        : {
            skill: {
              ...(persistent.skill || {}),
              lastUsedAt: referenceTime.toISOString(),
            },
          }),
    }, {
      referenceTime,
    }).catch(() => {});

    return outcome;
  }

  return {
    promoteSessionToPersistent,
    runSessionPersistent,
    updateSessionPersistent,
  };
}
