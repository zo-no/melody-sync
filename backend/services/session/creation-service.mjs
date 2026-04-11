import { sanitizeEmailCompletionTargets } from '../../../lib/agent-mail-completion-targets.mjs';
import { appendEvent, appendEvents, loadHistory } from '../../history.mjs';
import { statusEvent } from '../../normalizer.mjs';
import { emit as emitHook } from '../../hooks/runtime/registry.mjs';
import { withSessionsMetaMutation } from '../../session/meta-store.mjs';
import { normalizeSessionAgreements } from '../../session/agreements.mjs';
import {
  isSessionAutoRenamePending,
  normalizeSessionDescription,
  normalizeSessionGroup,
  resolveInitialSessionName,
} from '../../session/naming.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from '../../session/workflow-state.mjs';
import {
  normalizeSessionTaskListOrigin,
  normalizeSessionTaskListVisibility,
  shouldExposeSession,
} from '../../session/visibility.mjs';
import { appendGraphBootstrapPromptContext } from '../../workbench/graph-prompt-context.mjs';
import {
  applySessionCompatFields,
  normalizeSessionCompatInput,
} from '../../session-source/meta-fields.mjs';
import { normalizeSessionPersistent } from '../../session-persistent/core.mjs';
import {
  buildLongTermTaskPoolMembership,
  normalizeTaskPoolMembership,
} from '../../session/task-pool-membership.mjs';

function getPersistentSessionGroup(kind = '') {
  const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (normalizedKind === 'skill') return '快捷按钮';
  if (normalizedKind === 'recurring_task') return '长期任务';
  if (normalizedKind === 'scheduled_task') return '短期任务';
  if (normalizedKind === 'waiting_task') return '等待任务';
  return '';
}

export async function createSessionWithDeps({
  ensureSessionManagerBuiltinHooksRegistered,
  normalizeSourceContext,
  getNextSessionOrdinal,
  generateId,
  nowIso,
  enrichSessionMeta,
  broadcastSessionsInvalidation,
}, folder, tool, name, extra = {}) {
  ensureSessionManagerBuiltinHooksRegistered();
  const normalizedFolder = folder;
  const externalTriggerId = typeof extra.externalTriggerId === 'string' ? extra.externalTriggerId.trim() : '';
  const {
    requestedAppId,
    requestedAppName,
    requestedSourceId,
    requestedSourceName,
    requestedUserId,
    requestedUserName,
  } = normalizeSessionCompatInput(extra);
  const requestedGroup = normalizeSessionGroup(extra.group || '');
  const requestedDescription = normalizeSessionDescription(extra.description || '');
  const requestedTaskListOrigin = normalizeSessionTaskListOrigin(extra.taskListOrigin);
  const requestedTaskListVisibility = normalizeSessionTaskListVisibility(extra.taskListVisibility);
  const hasRequestedSystemPrompt = Object.prototype.hasOwnProperty.call(extra, 'systemPrompt');
  const requestedSystemPrompt = typeof extra.systemPrompt === 'string' ? extra.systemPrompt : '';
  const hasRequestedModel = Object.prototype.hasOwnProperty.call(extra, 'model');
  const requestedModel = typeof extra.model === 'string' ? extra.model.trim() : '';
  const hasRequestedEffort = Object.prototype.hasOwnProperty.call(extra, 'effort');
  const requestedEffort = typeof extra.effort === 'string' ? extra.effort.trim() : '';
  const hasRequestedThinking = Object.prototype.hasOwnProperty.call(extra, 'thinking');
  const requestedThinking = extra.thinking === true;
  const requestedTaskPoolMembership = normalizeTaskPoolMembership(extra.taskPoolMembership, {
    sessionId: '',
  });
  const requestedPersistent = Object.prototype.hasOwnProperty.call(extra, 'persistent') && extra.persistent
    ? extra.persistent
    : null;
  const hasRequestedSourceContext = Object.prototype.hasOwnProperty.call(extra, 'sourceContext');
  const requestedSourceContext = normalizeSourceContext(extra.sourceContext);
  const hasRequestedActiveAgreements = Object.prototype.hasOwnProperty.call(extra, 'activeAgreements');
  const requestedActiveAgreements = hasRequestedActiveAgreements
    ? normalizeSessionAgreements(extra.activeAgreements || [])
    : [];
  const normalizedPersistent = requestedPersistent && typeof requestedPersistent === 'object' && !Array.isArray(requestedPersistent)
    ? normalizeSessionPersistent(requestedPersistent)
    : null;
  const requestedInitialNaming = resolveInitialSessionName(name, {
    group: requestedGroup,
    sourceId: requestedSourceId,
    sourceName: requestedSourceName,
    externalTriggerId,
  });

  const created = await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    if (externalTriggerId) {
      const existingIndex = metas.findIndex((meta) => meta.externalTriggerId === externalTriggerId && !meta.archived);
      if (existingIndex !== -1) {
        const existing = metas[existingIndex];
        const updated = { ...existing };
        let changed = false;

        if (requestedGroup && updated.group !== requestedGroup) {
          updated.group = requestedGroup;
          changed = true;
        }

        if (requestedDescription && updated.description !== requestedDescription) {
          updated.description = requestedDescription;
          changed = true;
        }

        if (requestedTaskListOrigin && updated.taskListOrigin !== requestedTaskListOrigin) {
          updated.taskListOrigin = requestedTaskListOrigin;
          changed = true;
        }

        if (requestedTaskListVisibility && updated.taskListVisibility !== requestedTaskListVisibility) {
          updated.taskListVisibility = requestedTaskListVisibility;
          changed = true;
        }

        if (updated.folder !== normalizedFolder) {
          updated.folder = normalizedFolder;
          changed = true;
        }

        const refreshedInitialNaming = resolveInitialSessionName(name, {
          group: requestedGroup || updated.group || '',
          sourceId: requestedSourceId || updated.sourceId || '',
          sourceName: requestedSourceName || updated.sourceName || '',
          externalTriggerId: externalTriggerId || updated.externalTriggerId || '',
        });
        if (isSessionAutoRenamePending(updated) && !refreshedInitialNaming.autoRenamePending) {
          if (updated.name !== refreshedInitialNaming.name || updated.autoRenamePending !== false) {
            updated.name = refreshedInitialNaming.name;
            updated.autoRenamePending = false;
            changed = true;
          }
        }

        const workflowState = normalizeSessionWorkflowState(extra.workflowState || '');
        if (workflowState && updated.workflowState !== workflowState) {
          updated.workflowState = workflowState;
          changed = true;
        }

        const workflowPriority = normalizeSessionWorkflowPriority(extra.workflowPriority || '');
        if (workflowPriority && updated.workflowPriority !== workflowPriority) {
          updated.workflowPriority = workflowPriority;
          changed = true;
        }

        if (requestedSourceId && updated.sourceId !== requestedSourceId) {
          updated.sourceId = requestedSourceId;
          changed = true;
        }

        if (requestedSourceName && updated.sourceName !== requestedSourceName) {
          updated.sourceName = requestedSourceName;
          changed = true;
        }

        if (requestedUserId && updated.userId !== requestedUserId) {
          updated.userId = requestedUserId;
          changed = true;
        }

        if (requestedUserName && updated.userName !== requestedUserName) {
          updated.userName = requestedUserName;
          changed = true;
        }

        if (hasRequestedSystemPrompt && (updated.systemPrompt || '') !== requestedSystemPrompt) {
          if (requestedSystemPrompt) updated.systemPrompt = requestedSystemPrompt;
          else delete updated.systemPrompt;
          changed = true;
        }

        if (hasRequestedModel && (updated.model || '') !== requestedModel) {
          if (requestedModel) updated.model = requestedModel;
          else delete updated.model;
          changed = true;
        }

        if (hasRequestedEffort && (updated.effort || '') !== requestedEffort) {
          if (requestedEffort) updated.effort = requestedEffort;
          else delete updated.effort;
          changed = true;
        }

        if (hasRequestedThinking && updated.thinking !== requestedThinking) {
          if (requestedThinking) updated.thinking = true;
          else delete updated.thinking;
          changed = true;
        }

        const completionTargets = sanitizeEmailCompletionTargets(extra.completionTargets || []);
        if (completionTargets.length > 0 && JSON.stringify(updated.completionTargets || []) !== JSON.stringify(completionTargets)) {
          updated.completionTargets = completionTargets;
          changed = true;
        }

        if (hasRequestedActiveAgreements) {
          if (JSON.stringify(normalizeSessionAgreements(updated.activeAgreements || [])) !== JSON.stringify(requestedActiveAgreements)) {
            if (requestedActiveAgreements.length > 0) updated.activeAgreements = requestedActiveAgreements;
            else delete updated.activeAgreements;
            changed = true;
          }
        }

        if (hasRequestedSourceContext) {
          const currentSourceContext = normalizeSourceContext(updated.sourceContext);
          if (JSON.stringify(currentSourceContext) !== JSON.stringify(requestedSourceContext)) {
            if (requestedSourceContext) updated.sourceContext = requestedSourceContext;
            else delete updated.sourceContext;
            changed = true;
          }
        }

        const beforeCompat = JSON.stringify({
          appId: updated.appId || '',
          appName: updated.appName || '',
          sourceId: updated.sourceId || '',
          sourceName: updated.sourceName || '',
          userId: updated.userId || '',
          userName: updated.userName || '',
        });
        applySessionCompatFields(updated, {
          requestedAppId,
          requestedAppName,
          requestedSourceId,
          requestedSourceName,
          requestedUserId,
          requestedUserName,
        });
        if (JSON.stringify({
          appId: updated.appId || '',
          appName: updated.appName || '',
          sourceId: updated.sourceId || '',
          sourceName: updated.sourceName || '',
          userId: updated.userId || '',
          userName: updated.userName || '',
        }) !== beforeCompat) {
          changed = true;
        }

        if (changed) {
          updated.updatedAt = nowIso();
          metas[existingIndex] = updated;
          await saveSessionsMeta(metas);
          return { session: updated, created: false, changed: true };
        }

        return { session: existing, created: false, changed: false };
      }
    }

    const id = generateId();
    const initialNaming = requestedInitialNaming;
    const now = nowIso();
    const workflowState = normalizeSessionWorkflowState(extra.workflowState || '');
    const workflowPriority = normalizeSessionWorkflowPriority(extra.workflowPriority || '');
    const completionTargets = sanitizeEmailCompletionTargets(extra.completionTargets || []);

    const session = {
      id,
      folder: normalizedFolder,
      tool,
      ordinal: getNextSessionOrdinal(metas),
      name: initialNaming.name,
      autoRenamePending: initialNaming.autoRenamePending,
      created: now,
      updatedAt: now,
    };
    applySessionCompatFields(session, {
      requestedAppId,
      requestedAppName,
      requestedSourceId,
      requestedSourceName,
      requestedUserId,
      requestedUserName,
    });

    const inferredPersistentGroup = getPersistentSessionGroup(normalizedPersistent?.kind || '');
    if (requestedGroup) session.group = requestedGroup;
    else if (inferredPersistentGroup) session.group = inferredPersistentGroup;
    if (requestedDescription) session.description = requestedDescription;
    if (requestedTaskListOrigin) session.taskListOrigin = requestedTaskListOrigin;
    if (requestedTaskListVisibility) session.taskListVisibility = requestedTaskListVisibility;
    if (workflowState) session.workflowState = workflowState;
    if (workflowPriority) session.workflowPriority = workflowPriority;
    if (requestedSystemPrompt) session.systemPrompt = requestedSystemPrompt;
    if (requestedModel) session.model = requestedModel;
    if (requestedEffort) session.effort = requestedEffort;
    if (requestedThinking) session.thinking = true;
    if (extra.internalRole) session.internalRole = extra.internalRole;
    if (extra.compactsSessionId) session.compactsSessionId = extra.compactsSessionId;
    if (externalTriggerId) session.externalTriggerId = externalTriggerId;
    if (requestedSourceContext) session.sourceContext = requestedSourceContext;
    if (extra.forkedFromSessionId) session.forkedFromSessionId = extra.forkedFromSessionId;
    if (Number.isInteger(extra.forkedFromSeq)) session.forkedFromSeq = extra.forkedFromSeq;
    if (extra.rootSessionId) session.rootSessionId = extra.rootSessionId;
    if (extra.forkedAt) session.forkedAt = extra.forkedAt;
    if (completionTargets.length > 0) session.completionTargets = completionTargets;
    if (hasRequestedActiveAgreements && requestedActiveAgreements.length > 0) {
      session.activeAgreements = requestedActiveAgreements;
    }
    if (normalizedPersistent) {
      session.persistent = normalizedPersistent;
    }
    const normalizedTaskPoolMembership = requestedTaskPoolMembership
      || (normalizedPersistent?.kind === 'recurring_task'
        ? buildLongTermTaskPoolMembership(id, { role: 'project' })
        : null);
    if (normalizedTaskPoolMembership) {
      session.taskPoolMembership = normalizedTaskPoolMembership;
    }

    metas.push(session);
    await saveSessionsMeta(metas);
    return { session, created: true, changed: true };
  });

  if ((created.created || created.changed) && shouldExposeSession(created.session)) {
    broadcastSessionsInvalidation();
  }

  const enriched = await enrichSessionMeta(created.session);
  if (created.created) {
    await emitHook('session.created', {
      sessionId: enriched.id,
      session: enriched,
      manifest: null,
      appendEvent,
      statusEvent,
    });
  }
  await appendGraphBootstrapPromptContext({
    sessionId: enriched.id,
    session: enriched,
    appendEvents,
    loadHistory,
  });
  return enriched;
}
