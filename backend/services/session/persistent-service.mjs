import { loadHistory } from '../../history.mjs';
import {
  buildPersistentDigest,
  buildPersistentRunMessage,
  computeNextRecurringRunAt,
  normalizeSessionPersistent,
  resolvePersistentRunRuntime,
} from '../../session-persistent/core.mjs';
import {
  buildLongTermTaskPoolMembership,
  normalizeTaskPoolMembership,
  stripLongTermTaskPoolMembership,
} from '../../session/task-pool-membership.mjs';

function mergeObjectShape(current, patch) {
  const currentValue = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patchValue = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return { ...currentValue, ...patchValue };
}

function mergePersistentLoopShape(current, patch) {
  const currentLoop = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patchLoop = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return {
    ...currentLoop,
    ...patchLoop,
    collect: mergeObjectShape(currentLoop.collect, patchLoop.collect),
    organize: mergeObjectShape(currentLoop.organize, patchLoop.organize),
    use: mergeObjectShape(currentLoop.use, patchLoop.use),
    prune: mergeObjectShape(currentLoop.prune, patchLoop.prune),
  };
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

function stripPersistentBranchLineage(sourceContext) {
  const current = sourceContext && typeof sourceContext === 'object' && !Array.isArray(sourceContext)
    ? sourceContext
    : null;
  if (!current) return null;
  const next = { ...current };
  delete next.parentSessionId;
  delete next.rootSessionId;
  return Object.keys(next).length > 0 ? next : null;
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
    loop: mergePersistentLoopShape(currentPersistent?.loop, patch?.loop),
    skill: mergeObjectShape(currentPersistent?.skill, patch?.skill),
    runtimePolicy: {
      ...currentRuntimePolicy,
      ...patchRuntimePolicy,
      manual: mergeObjectShape(currentRuntimePolicy?.manual, patchRuntimePolicy?.manual),
      schedule: mergeObjectShape(currentRuntimePolicy?.schedule, patchRuntimePolicy?.schedule),
    },
  };
}

function buildPersistentTaskPoolMembership(sessionId, persistent, currentTaskPoolMembership = null) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (persistent?.kind === 'recurring_task') {
    return buildLongTermTaskPoolMembership(normalizedSessionId, { role: 'project' });
  }
  return stripLongTermTaskPoolMembership(currentTaskPoolMembership, {
    sessionId: normalizedSessionId,
  });
}

export function createSessionPersistentService({
  broadcastSessionInvalidation,
  createInternalRequestId,
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
      const currentTaskPoolMembership = normalizeTaskPoolMembership(session.taskPoolMembership, {
        sessionId: session?.id || id,
      });
      const nextTaskPoolMembership = buildPersistentTaskPoolMembership(
        session?.id || id,
        nextPersistent,
        currentTaskPoolMembership,
      );
      const nextGroup = nextPersistent ? getPersistentSessionGroup(nextPersistent.kind) : '';
      const shouldClearPersistentGroup = !nextPersistent && (session.group === '长期任务' || session.group === '快捷按钮');
      if (
        JSON.stringify(currentNormalized) === JSON.stringify(nextPersistent)
        && JSON.stringify(currentTaskPoolMembership) === JSON.stringify(nextTaskPoolMembership)
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
      if (nextTaskPoolMembership) {
        session.taskPoolMembership = nextTaskPoolMembership;
      } else if (session.taskPoolMembership) {
        delete session.taskPoolMembership;
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
      loop: mergePersistentLoopShape(session?.persistent?.loop, payload?.loop),
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
    const detachedSourceContext = stripPersistentBranchLineage(session.sourceContext || null);
    const nextTaskPoolMembership = buildPersistentTaskPoolMembership(id, nextPersistent, session?.taskPoolMembership || null);
    const result = await mutateSessionMeta(id, (draft) => {
      draft.persistent = nextPersistent;
      if (nextTaskPoolMembership) {
        draft.taskPoolMembership = nextTaskPoolMembership;
      } else if (draft.taskPoolMembership) {
        delete draft.taskPoolMembership;
      }
      if (nextGroup) {
        draft.group = nextGroup;
      }
      if (nextName) {
        draft.name = nextName;
      }
      const nextDescription = String(nextPersistent?.digest?.summary || '').trim();
      if (nextDescription) {
        draft.description = nextDescription;
      }
      draft.taskListOrigin = 'user';
      draft.taskListVisibility = 'primary';
      draft.rootSessionId = draft.id || id;
      if (detachedSourceContext) {
        draft.sourceContext = detachedSourceContext;
      } else if (draft.sourceContext) {
        delete draft.sourceContext;
      }
      delete draft.forkedFromSessionId;
      delete draft.forkedFromSeq;
      delete draft.forkedAt;
      draft.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
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
