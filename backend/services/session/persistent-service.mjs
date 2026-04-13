import { spawn } from 'child_process';
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

} from '../../session/task-pool-membership.mjs';
import {
  normalizePersistentKind,
  KIND_TO_BUCKET,
  KIND_GROUP_LABELS,
  PERSISTENT_GROUPS,
  getPersistentSessionGroup,
} from '../../session/persistent-kind.mjs';

function mergeObjectShape(current, patch) {
  const currentValue = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patchValue = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return { ...currentValue, ...patchValue };
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function mergeOptionalPersistentObject(current, patch, hasPatch) {
  if (!hasPatch) return current;
  if (patch === null || patch === false) return null;
  return mergeObjectShape(current, patch);
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
  const hasScheduledPatch = hasOwn(patch, 'scheduled');
  const hasRecurringPatch = hasOwn(patch, 'recurring') || hasOwn(patch, 'schedule');
  const recurringPatch = hasOwn(patch, 'recurring') ? patch.recurring : patch?.schedule;
  const hasSkillPatch = hasOwn(patch, 'skill');
  const hasKnowledgeBasePathPatch = hasOwn(patch, 'knowledgeBasePath');
  const hasWorkspacePatch = hasOwn(patch, 'workspace');
  return {
    ...(currentPersistent && typeof currentPersistent === 'object' ? currentPersistent : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
    digest: mergeObjectShape(currentPersistent?.digest, patch?.digest),
    execution: mergeObjectShape(currentPersistent?.execution, patch?.execution),
    scheduled: mergeOptionalPersistentObject(currentPersistent?.scheduled, patch?.scheduled, hasScheduledPatch),
    recurring: mergeOptionalPersistentObject(currentPersistent?.recurring, recurringPatch, hasRecurringPatch),
    loop: mergePersistentLoopShape(currentPersistent?.loop, patch?.loop),
    skill: mergeOptionalPersistentObject(currentPersistent?.skill, patch?.skill, hasSkillPatch),
    knowledgeBasePath: hasKnowledgeBasePathPatch ? patch?.knowledgeBasePath || '' : currentPersistent?.knowledgeBasePath || '',
    workspace: hasWorkspacePatch
      ? (patch.workspace && typeof patch.workspace === 'object' ? mergeObjectShape(currentPersistent?.workspace, patch.workspace) : null)
      : (currentPersistent?.workspace || null),
    runtimePolicy: {
      ...currentRuntimePolicy,
      ...patchRuntimePolicy,
      manual: mergeObjectShape(currentRuntimePolicy?.manual, patchRuntimePolicy?.manual),
      schedule: mergeObjectShape(currentRuntimePolicy?.schedule, patchRuntimePolicy?.schedule),
    },
  };
}

// Infer bucket from kind only — used at promote time to always override existing bucket.
// Contrast with inferLongTermBucketFromSession() in persistent-kind.mjs which respects explicit bucket.
function inferBucketFromKind(session = null, persistent = null) {
  const bucket = KIND_TO_BUCKET[normalizePersistentKind(persistent?.kind || '')];
  if (bucket) return bucket;
  const workflowState = typeof session?.workflowState === 'string'
    ? session.workflowState.trim().toLowerCase() : '';
  return workflowState === 'waiting_user' ? 'waiting' : 'inbox';
}

function buildPersistentTriggerLabel(triggerKind = '') {
  if (triggerKind === 'recurring') return '循环触发';
  if (triggerKind === 'schedule') return '定时触发';
  return '一键触发';
}

function buildPersistentSpawnGoal(session = null, persistent = null, triggerKind = '') {
  const title = String(
    persistent?.digest?.title
    || session?.name
    || '',
  ).trim() || '未命名任务';
  return `${buildPersistentTriggerLabel(triggerKind)} · ${title}`;
}

function buildPersistentSpawnCheckpoint(session = null, persistent = null) {
  return String(
    persistent?.digest?.summary
    || persistent?.digest?.goal
    || session?.description
    || session?.taskCard?.checkpoint
    || '',
  ).trim();
}

function buildPersistentSpawnReason(persistent = null, triggerKind = '') {
  const kind = normalizePersistentKind(persistent?.kind || '');
  const taskType = KIND_GROUP_LABELS[kind] || '任务';
  return `${taskType}${buildPersistentTriggerLabel(triggerKind)}创建的执行支线`;
}

function normalizeSessionId(value) {
  return typeof value === 'string' ? value.trim() : '';
}


function collectLongTermLineageCandidateIds(session = null) {
  const sessionId = normalizeSessionId(session?.id || '');
  const candidateIds = [];
  for (const candidateId of [
    session?.rootSessionId,
    session?.sourceContext?.rootSessionId,
    session?._branchParentSessionId,
    session?.branchParentSessionId,
    session?.sourceContext?.parentSessionId,
  ]) {
    const normalizedCandidateId = normalizeSessionId(candidateId || '');
    if (!normalizedCandidateId || normalizedCandidateId === sessionId || candidateIds.includes(normalizedCandidateId)) {
      continue;
    }
    candidateIds.push(normalizedCandidateId);
  }
  return candidateIds;
}

function buildPersistentTaskPoolMembership(sessionId, persistent, currentTaskPoolMembership = null, session = null) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const currentLongTermMembership = currentTaskPoolMembership?.longTerm || null;
  if (currentLongTermMembership?.projectSessionId && currentLongTermMembership.role !== 'project') {
    return buildLongTermTaskPoolMembership(currentLongTermMembership.projectSessionId, {
      role: 'member',
      bucket: inferBucketFromKind(session, persistent),
    });
  }
  if (persistent?.kind === 'recurring_task') {
    return buildLongTermTaskPoolMembership(normalizedSessionId, { role: 'project' });
  }
  return null; // strip membership for non-project, non-member kinds
}

export function createSessionPersistentService({
  broadcastSessionInvalidation,
  createBranchFromSession: createBranchFromSessionOverride,
  createSession,
  createInternalRequestId,
  enrichSessionMeta,
  getSession,
  getSessionQueueCount,
  isSessionRunning,
  mutateSessionMeta,
  nowIso,
  submitHttpMessage,
}) {
  async function resolveCurrentTaskPoolMembership(session = null, { sessionId = '', visited = new Set() } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId || session?.id || '');
    const explicitMembership = normalizeTaskPoolMembership(session?.taskPoolMembership, {
      sessionId: normalizedSessionId,
    });
    if (explicitMembership) return explicitMembership;
    if (!normalizedSessionId || visited.has(normalizedSessionId)) return null;
    if (normalizePersistentKind(session?.persistent?.kind || '') === 'recurring_task') {
      return buildLongTermTaskPoolMembership(normalizedSessionId, { role: 'project' });
    }

    const nextVisited = new Set(visited);
    nextVisited.add(normalizedSessionId);
    for (const candidateId of collectLongTermLineageCandidateIds(session)) {
      const candidate = await getSession(candidateId, { includeQueuedMessages: false }).catch(() => null);
      if (!candidate) continue;
      const candidateMembership = await resolveCurrentTaskPoolMembership(candidate, {
        sessionId: candidateId,
        visited: nextVisited,
      });
      const projectSessionId = candidateMembership?.longTerm?.projectSessionId || '';
      if (!projectSessionId) continue;
      return buildLongTermTaskPoolMembership(projectSessionId, {
        role: projectSessionId === normalizedSessionId ? 'project' : 'member',
        bucket: inferBucketFromKind(session, session?.persistent || null),
      });
    }
    return null;
  }

  async function stampPersistentSpawnedSessionMembership(childSessionId, sourceSession, persistent) {
    const normalizedChildSessionId = normalizeSessionId(childSessionId);
    if (!normalizedChildSessionId) return null;
    const sourceMembership = await resolveCurrentTaskPoolMembership(sourceSession, {
      sessionId: sourceSession?.id || '',
    });
    const projectSessionId = normalizeSessionId(
      sourceMembership?.longTerm?.projectSessionId
      || (persistent?.kind === 'recurring_task' ? sourceSession?.id : '')
      || sourceSession?.rootSessionId
      || sourceSession?.sourceContext?.rootSessionId
      || '',
    );
    if (!projectSessionId) {
      return getSession(normalizedChildSessionId, { includeQueuedMessages: true }).catch(() => null);
    }
    const taskPoolMembership = buildLongTermTaskPoolMembership(projectSessionId, {
      role: 'member',
      bucket: inferBucketFromKind(sourceSession, persistent),
    });
    if (!taskPoolMembership) {
      return getSession(normalizedChildSessionId, { includeQueuedMessages: true }).catch(() => null);
    }
    const result = await mutateSessionMeta(normalizedChildSessionId, (draft) => {
      draft.taskPoolMembership = taskPoolMembership;
      draft.rootSessionId = projectSessionId;
      draft.sourceContext = {
        ...(draft.sourceContext && typeof draft.sourceContext === 'object' && !Array.isArray(draft.sourceContext)
          ? draft.sourceContext
          : {}),
        rootSessionId: projectSessionId,
        parentSessionId: normalizeSessionId(sourceSession?.id || ''),
      };
      draft.updatedAt = nowIso();
      return true;
    }).catch(() => null);
    if (result?.changed) {
      broadcastSessionInvalidation(normalizedChildSessionId);
    }
    return result?.meta
      ? enrichSessionMeta(result.meta)
      : getSession(normalizedChildSessionId, { includeQueuedMessages: true }).catch(() => null);
  }

  async function createPersistentSpawnedSession(session, persistent, triggerKind) {
    const sourceSessionId = normalizeSessionId(session?.id || '');
    const goal = buildPersistentSpawnGoal(session, persistent, triggerKind);
    const checkpointSummary = buildPersistentSpawnCheckpoint(session, persistent);
    const branchReason = buildPersistentSpawnReason(persistent, triggerKind);

    try {
      const createBranchFromSession = typeof createBranchFromSessionOverride === 'function'
        ? createBranchFromSessionOverride
        : (await import('../../workbench/branch-lifecycle.mjs'))?.createBranchFromSession;
      if (typeof createBranchFromSession === 'function') {
        const branch = await createBranchFromSession(sourceSessionId, {
          goal,
          branchReason,
          checkpointSummary,
          nextStep: String(persistent?.execution?.runPrompt || '').trim(),
        });
        if (branch?.session?.id) {
          return await stampPersistentSpawnedSessionMembership(branch.session.id, session, persistent)
            || branch.session;
        }
      }
    } catch (error) {
      console.warn(`[persistent-spawn] Falling back to session branch creation: ${error.message}`);
    }

    if (typeof createSession !== 'function') {
      throw new Error('Persistent branch creation is unavailable');
    }

    const sourceMembership = await resolveCurrentTaskPoolMembership(session, {
      sessionId: sourceSessionId,
    });
    const projectSessionId = normalizeSessionId(
      sourceMembership?.longTerm?.projectSessionId
      || (persistent?.kind === 'recurring_task' ? sourceSessionId : '')
      || session?.rootSessionId
      || session?.sourceContext?.rootSessionId
      || '',
    );
    const child = await createSession(session.folder, session.tool, `Branch · ${goal}`, {
      group: session.group || getPersistentSessionGroup(persistent?.kind || ''),
      description: checkpointSummary || session.description || '',
      sourceId: session.sourceId || '',
      sourceName: session.sourceName || '',
      userId: session.userId || '',
      userName: session.userName || '',
      systemPrompt: session.systemPrompt || '',
      activeAgreements: session.activeAgreements || [],
      model: session.model || '',
      effort: session.effort || '',
      thinking: session.thinking === true,
      rootSessionId: projectSessionId || session.rootSessionId || sourceSessionId,
      sourceContext: {
        kind: 'persistent_task_run',
        parentSessionId: sourceSessionId,
        rootSessionId: projectSessionId || session.rootSessionId || sourceSessionId,
        persistentKind: persistent?.kind || '',
        triggerKind,
      },
      taskListOrigin: triggerKind === 'manual' ? 'user' : 'system',
      taskListVisibility: 'secondary',
      ...(projectSessionId
        ? {
            taskPoolMembership: buildLongTermTaskPoolMembership(projectSessionId, {
              role: 'member',
              bucket: inferBucketFromKind(session, persistent),
            }),
          }
        : {}),
    });
    if (!child?.id) {
      throw new Error('Persistent branch creation failed');
    }
    return child;
  }

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

    const resolvedCurrentTaskPoolMembership = await resolveCurrentTaskPoolMembership(currentSession, {
      sessionId: id,
    });
    const result = await mutateSessionMeta(id, (session) => {
      const currentNormalized = normalizeSessionPersistent(session.persistent || null, {
        defaultDigest,
        defaultRuntime: session,
        defaultTimezone: timezone,
      });
      const currentTaskPoolMembership = normalizeTaskPoolMembership(session.taskPoolMembership, {
        sessionId: session?.id || id,
      }) || resolvedCurrentTaskPoolMembership;
      const nextTaskPoolMembership = buildPersistentTaskPoolMembership(
        session?.id || id,
        nextPersistent,
        currentTaskPoolMembership,
        session,
      );
      const nextGroup = nextPersistent ? getPersistentSessionGroup(nextPersistent.kind) : '';
      const shouldClearPersistentGroup = !nextPersistent && PERSISTENT_GROUPS.has(session.group);
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
        if (PERSISTENT_GROUPS.has(session.group)) {
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
    const hasScheduledPayload = hasOwn(payload, 'scheduled');
    const hasRecurringPayload = hasOwn(payload, 'recurring') || hasOwn(payload, 'schedule');
    const recurringPayload = hasOwn(payload, 'recurring') ? payload.recurring : payload?.schedule;
    const hasSkillPayload = hasOwn(payload, 'skill');
    const hasKnowledgeBasePathPayload = hasOwn(payload, 'knowledgeBasePath');
    const nextPersistent = normalizeSessionPersistent({
      ...(session?.persistent && typeof session.persistent === 'object' ? session.persistent : {}),
      ...(payload && typeof payload === 'object' ? payload : {}),
      kind: payload?.kind || payload?.type,
      digest: mergeObjectShape(defaultDigest, payload?.digest),
      execution: mergeObjectShape(session?.persistent?.execution, payload?.execution),
      scheduled: mergeOptionalPersistentObject(session?.persistent?.scheduled, payload?.scheduled, hasScheduledPayload),
      recurring: mergeOptionalPersistentObject(session?.persistent?.recurring, recurringPayload, hasRecurringPayload),
      loop: mergePersistentLoopShape(session?.persistent?.loop, payload?.loop),
      skill: mergeOptionalPersistentObject(session?.persistent?.skill, payload?.skill, hasSkillPayload),
      knowledgeBasePath: hasKnowledgeBasePathPayload ? payload?.knowledgeBasePath || '' : session?.persistent?.knowledgeBasePath || '',
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
    const resolvedCurrentTaskPoolMembership = await resolveCurrentTaskPoolMembership(session, {
      sessionId: id,
    });
    const nextTaskPoolMembership = buildPersistentTaskPoolMembership(
      id,
      nextPersistent,
      resolvedCurrentTaskPoolMembership,
      session,
    );
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
    if (persistent.state !== 'active' && options.triggerKind && options.triggerKind !== 'manual') {
      throw new Error('Persistent task is paused');
    }
    if (isSessionRunning(session) || getSessionQueueCount(session) > 0) {
      throw new Error('Session is busy');
    }

    const requestedTriggerKind = String(options.triggerKind || '').trim().toLowerCase();
    const triggerKind = requestedTriggerKind === 'recurring'
      ? 'recurring'
      : (requestedTriggerKind === 'schedule' ? 'schedule' : 'manual');
    const runtime = resolvePersistentRunRuntime(session, persistent, {
      triggerKind,
      runtime: options.runtime,
    });
    const text = buildPersistentRunMessage(session, persistent, {
      triggerKind,
      runPrompt: options.runPrompt || '',
    });
    const requestId = createInternalRequestId(
      triggerKind === 'recurring'
        ? 'persistent_recurring'
        : (triggerKind === 'schedule' ? 'persistent_schedule' : 'persistent_run'),
    );
    // Resolve maxTurns: explicit config wins; auto-triggered runs fall back to 40
    // to prevent runaway loops. Manual runs default to unlimited (0).
    const explicitMaxTurns = persistent?.execution?.maxTurns;
    const isAutoTrigger = triggerKind === 'schedule' || triggerKind === 'recurring';
    const resolvedMaxTurns = (Number.isFinite(explicitMaxTurns) && explicitMaxTurns > 0)
      ? explicitMaxTurns
      : (isAutoTrigger ? 40 : 0);

    const submitOptions = {
      requestId,
      queueIfBusy: false,
      scheduledTriggerId: isAutoTrigger ? `persistent:${id}` : '',
      ...(runtime?.tool ? { tool: runtime.tool } : {}),
      ...(runtime?.model ? { model: runtime.model } : {}),
      ...(runtime?.effort ? { effort: runtime.effort } : {}),
      thinking: runtime?.thinking === true,
      ...(resolvedMaxTurns > 0 ? { maxTurns: resolvedMaxTurns } : {}),
    };
    // ── Shell command execution (skill only) ────────────────────────────────
    const shellCommand = String(persistent?.execution?.shellCommand || '').trim();
    let shellOutput = '';
    if (shellCommand && persistent?.kind === 'skill') {
      try {
        shellOutput = await new Promise((resolve) => {
          let out = '';
          let err = '';
          const child = spawn('/bin/sh', ['-lc', shellCommand], {
            cwd: String(persistent?.knowledgeBasePath || process.cwd()).trim() || process.cwd(),
            env: { ...process.env, MELODYSYNC_SESSION_ID: String(id || '') },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout?.setEncoding?.('utf8');
          child.stderr?.setEncoding?.('utf8');
          child.stdout?.on?.('data', (chunk) => { out += chunk; });
          child.stderr?.on?.('data', (chunk) => { err += chunk; });
          child.on('close', (code) => {
            const combined = [out, err].filter(Boolean).join('\n').trim();
            resolve(code === 0 ? combined : `[exit ${code}] ${combined}`);
          });
          child.on('error', (e) => resolve(`[error] ${e.message}`));
          // Timeout after 30s
          setTimeout(() => { child.kill(); resolve('[timeout] shell command exceeded 30s'); }, 30000);
        });
      } catch (shellErr) {
        shellOutput = `[error] ${shellErr?.message || shellErr}`;
      }
    }
    // Append shell output to AI message if present
    const effectiveText = shellOutput
      ? `${text}\n\n[Shell 执行结果]\n\`\`\`\n${shellOutput.slice(0, 2000)}\n\`\`\``
      : text;

    const spawnedSession = persistent?.execution?.mode === 'spawn_session'
      ? await createPersistentSpawnedSession(session, persistent, triggerKind)
      : null;
    const outcome = await submitHttpMessage(spawnedSession?.id || id, effectiveText, [], {
      ...submitOptions,
      ...(spawnedSession?.id ? {
        requestId: createInternalRequestId(
          triggerKind === 'recurring'
            ? 'persistent_recurring_branch'
            : (triggerKind === 'schedule' ? 'persistent_schedule_branch' : 'persistent_run_branch'),
        ),
      } : {}),
    });

    const parentSessionBeforeUpdate = session;
    let parentSessionAfterUpdate = null;

    const referenceTime = new Date();
    await updateSessionPersistent(id, {
      execution: {
        ...(persistent.execution || {}),
        lastTriggerAt: referenceTime.toISOString(),
        lastTriggerKind: triggerKind,
      },
      ...(triggerKind === 'recurring'
        ? {
            recurring: {
              ...(persistent.recurring || {}),
              lastRunAt: referenceTime.toISOString(),
              nextRunAt: computeNextRecurringRunAt(persistent.recurring || {}, referenceTime),
            },
          }
        : (triggerKind === 'schedule'
          ? {
              scheduled: {
                ...(persistent.scheduled || {}),
                lastRunAt: referenceTime.toISOString(),
                nextRunAt: '',
              },
            }
          : persistent.kind === 'skill'
            ? {
                skill: {
                  ...(persistent.skill || {}),
                  lastUsedAt: referenceTime.toISOString(),
                },
              }
            : {})),
    }, {
      referenceTime,
    }).then((updatedSession) => {
      parentSessionAfterUpdate = updatedSession || null;
    }).catch(() => {});

    if (spawnedSession?.id) {
      const resolvedSpawnedSession = outcome.session
        || await getSession(spawnedSession.id, { includeQueuedMessages: true })
        || spawnedSession;
      return {
        ...outcome,
        session: resolvedSpawnedSession,
        spawnedSession: resolvedSpawnedSession,
        parentSession: parentSessionAfterUpdate || parentSessionBeforeUpdate,
      };
    }

    return {
      ...outcome,
      parentSession: parentSessionAfterUpdate || null,
    };
  }

  return {
    promoteSessionToPersistent,
    runSessionPersistent,
    updateSessionPersistent,
  };
}
