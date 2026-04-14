import { appendTaskOp } from '../../session/task-ops-log.mjs';

export function createSessionWorkflowRuntimeService({
  appendEvent,
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  buildSessionCompletionNoticeKey,
  didSessionWorkflowTransitionToDone,
  emitHook,
  enrichSessionMeta,
  getSession,
  mutateSessionMeta,
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
  nowIso,
  resolveLatestCompletedRunIdForSession,
  sessionWorkflowStateWaitingUser,
  shouldExposeSession,
  statusEvent,
}) {
  async function updateSessionWorkflowClassification(id, payload = {}) {
    const {
      workflowState,
      workflowPriority,
    } = payload;
    const nextWorkflowState = normalizeSessionWorkflowState(workflowState || '');
    const hasWorkflowState = Object.prototype.hasOwnProperty.call(payload, 'workflowState');
    const nextWorkflowPriority = normalizeSessionWorkflowPriority(workflowPriority || '');
    const hasWorkflowPriority = Object.prototype.hasOwnProperty.call(payload, 'workflowPriority');
    let shouldSendCompletionPush = false;
    let prevWorkflowState = '';
    let prevWorkflowPriority = '';
    const result = await mutateSessionMeta(id, (session) => {
      const currentWorkflowState = normalizeSessionWorkflowState(session.workflowState || '');
      const currentWorkflowPriority = normalizeSessionWorkflowPriority(session.workflowPriority || '');
      prevWorkflowState = currentWorkflowState;
      prevWorkflowPriority = currentWorkflowPriority;
      let changed = false;

      if (hasWorkflowState) {
        if (nextWorkflowState) {
          if (currentWorkflowState !== nextWorkflowState) {
            shouldSendCompletionPush = didSessionWorkflowTransitionToDone(nextWorkflowState, currentWorkflowState);
            session.workflowState = nextWorkflowState;
            if (nextWorkflowState === 'done') {
              session.workflowCompletedAt = nowIso();
            } else {
              delete session.workflowCompletedAt;
            }
            changed = true;
          }
        } else if (currentWorkflowState) {
          delete session.workflowState;
          delete session.workflowCompletedAt;
          changed = true;
        }
      }

      if (hasWorkflowPriority) {
        if (nextWorkflowPriority) {
          if (currentWorkflowPriority !== nextWorkflowPriority) {
            session.workflowPriority = nextWorkflowPriority;
            changed = true;
          }
        } else if (currentWorkflowPriority) {
          delete session.workflowPriority;
          changed = true;
        }
      }

      return changed;
    });

    if (!result.meta) return null;
    const enriched = await enrichSessionMeta(result.meta);
    if (result.changed) {
      // Log workflow state change
      if (hasWorkflowState && nextWorkflowState && prevWorkflowState !== nextWorkflowState) {
        void appendTaskOp(id, 'workflow_state', prevWorkflowState || null, nextWorkflowState);
      }
      if (hasWorkflowPriority && nextWorkflowPriority && prevWorkflowPriority !== nextWorkflowPriority) {
        void appendTaskOp(id, 'workflow_priority', prevWorkflowPriority || null, nextWorkflowPriority);
      }
      broadcastSessionInvalidation(id);
      let completionNoticeKey = '';
      let completionNoticeRunId = '';
      if (shouldSendCompletionPush) {
        completionNoticeRunId = String(enriched?.activeRunId || '').trim();
        if (!completionNoticeRunId) {
          completionNoticeRunId = await resolveLatestCompletedRunIdForSession(enriched?.id || id);
        }
        completionNoticeKey = buildSessionCompletionNoticeKey(
          enriched?.id || id,
          completionNoticeRunId,
        );
      }
      const eventPayload = {
        sessionId: id,
        session: enriched,
        manifest: null,
        run: completionNoticeRunId ? { id: completionNoticeRunId } : undefined,
        completionNoticeKey,
        appendEvent,
        statusEvent,
      };
      if (normalizeSessionWorkflowState(enriched?.workflowState || '') === sessionWorkflowStateWaitingUser) {
        await emitHook('session.waiting_user', eventPayload);
      }
      if (shouldSendCompletionPush) {
        await Promise.all([
          emitHook('run.completed', eventPayload),
          emitHook('session.completed', eventPayload),
        ]);
      }
    }
    return enriched;
  }

  async function updateSessionTool(id, tool) {
    const nextTool = typeof tool === 'string' ? tool.trim() : '';
    if (!nextTool) return null;

    const result = await mutateSessionMeta(id, (session) => {
      if (session.tool === nextTool) return false;
      session.tool = nextTool;
      session.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  async function updateSessionRuntimePreferences(id, patch = {}) {
    const hasToolPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tool');
    const hasModelPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'model');
    const hasEffortPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'effort');
    const hasThinkingPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'thinking');
    if (!hasToolPatch && !hasModelPatch && !hasEffortPatch && !hasThinkingPatch) {
      return getSession(id);
    }

    const nextTool = hasToolPatch && typeof patch.tool === 'string'
      ? patch.tool.trim()
      : '';
    let toolChanged = false;

    const result = await mutateSessionMeta(id, (session) => {
      let changed = false;

      if (hasToolPatch && nextTool && session.tool !== nextTool) {
        session.tool = nextTool;
        toolChanged = true;
        changed = true;
      }

      if (hasModelPatch) {
        const nextModel = typeof patch.model === 'string' ? patch.model.trim() : '';
        if ((session.model || '') !== nextModel) {
          session.model = nextModel;
          changed = true;
        }
      }

      if (hasEffortPatch) {
        const nextEffort = typeof patch.effort === 'string' ? patch.effort.trim() : '';
        if ((session.effort || '') !== nextEffort) {
          session.effort = nextEffort;
          changed = true;
        }
      }

      if (hasThinkingPatch) {
        const nextThinking = patch.thinking === true;
        if (session.thinking !== nextThinking) {
          session.thinking = nextThinking;
          changed = true;
        }
      }

      if (changed) {
        session.updatedAt = nowIso();
      }
      return changed;
    });

    if (!result.meta) return null;
    if (!result.changed) {
      return enrichSessionMeta(result.meta);
    }

    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
    return enrichSessionMeta(result.meta);
  }

  return {
    updateSessionRuntimePreferences,
    updateSessionTool,
    updateSessionWorkflowClassification,
  };
}
