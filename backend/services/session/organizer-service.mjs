function serializeOrganizerPatchState(session) {
  return JSON.stringify({
    name: session?.name || '',
    group: session?.group || '',
    description: session?.description || '',
    workflowState: session?.workflowState || '',
    workflowPriority: session?.workflowPriority || '',
  });
}

export function createSessionOrganizerService({
  extractSessionOrganizerAssistantText,
  getSession,
  getSessionQueueCount,
  isSessionAutoRenamePending,
  parseSessionOrganizerResult,
  renameSession,
  triggerSessionLabelSuggestion,
  updateRun,
  updateSessionGrouping,
  updateSessionWorkflowClassification,
}) {
  async function applySessionOrganizerPatch(sessionId, patch = {}) {
    let session = await getSession(sessionId);
    if (!session) return null;

    const nextName = typeof patch?.name === 'string' ? patch.name.trim() : '';
    if (nextName && nextName !== session.name) {
      session = await renameSession(sessionId, nextName) || session;
    }

    const nextGroup = typeof patch?.group === 'string' ? patch.group : '';
    const nextDescription = typeof patch?.description === 'string' ? patch.description : '';
    if ((nextGroup && nextGroup !== (session.group || '')) || (nextDescription && nextDescription !== (session.description || ''))) {
      session = await updateSessionGrouping(sessionId, {
        ...(nextGroup ? { group: nextGroup } : {}),
        ...(nextDescription ? { description: nextDescription } : {}),
      }) || session;
    }

    const nextWorkflowState = typeof patch?.workflowState === 'string' ? patch.workflowState : '';
    const nextWorkflowPriority = typeof patch?.workflowPriority === 'string' ? patch.workflowPriority : '';
    if (
      (nextWorkflowState && nextWorkflowState !== (session.workflowState || ''))
      || (nextWorkflowPriority && nextWorkflowPriority !== (session.workflowPriority || ''))
    ) {
      session = await updateSessionWorkflowClassification(sessionId, {
        ...(nextWorkflowState ? { workflowState: nextWorkflowState } : {}),
        ...(nextWorkflowPriority ? { workflowPriority: nextWorkflowPriority } : {}),
      }) || session;
    }

    return session;
  }

  async function finalizeSessionOrganizerRun(sessionId, run, normalizedEvents = []) {
    const assistantText = extractSessionOrganizerAssistantText(normalizedEvents);
    if (!assistantText) {
      await updateRun(run.id, (current) => ({
        ...current,
        state: 'failed',
        failureReason: 'Session organizer produced no assistant output',
      }));
      return { session: await getSession(sessionId), changed: false };
    }

    const parsed = parseSessionOrganizerResult(assistantText);
    if (!parsed.ok) {
      await updateRun(run.id, (current) => ({
        ...current,
        state: 'failed',
        failureReason: 'Session organizer returned invalid JSON',
      }));
      return { session: await getSession(sessionId), changed: false };
    }

    const before = await getSession(sessionId);
    const updated = await applySessionOrganizerPatch(sessionId, parsed);
    return {
      session: updated || before,
      changed: serializeOrganizerPatchState(before) !== serializeOrganizerPatchState(updated),
    };
  }

  async function triggerAutomaticSessionLabeling(sessionId, session) {
    const currentSession = await getSession(sessionId) || session;
    if (!currentSession || !isSessionAutoRenamePending(currentSession)) {
      return {
        ok: true,
        skipped: 'session_labels_not_needed',
        rename: { attempted: false, renamed: false },
      };
    }
    if (getSessionQueueCount(currentSession) > 0) {
      return {
        ok: true,
        skipped: 'queued_follow_ups_present',
        rename: { attempted: false, renamed: false },
      };
    }

    const outcome = await triggerSessionLabelSuggestion(
      currentSession,
      async (newName) => !!(await renameSession(sessionId, newName)),
      { skipReason: 'Auto-rename no longer needed' },
    );

    const summary = outcome?.summary;
    if (summary && (summary.group || summary.description)) {
      await updateSessionGrouping(sessionId, {
        ...(summary.group ? { group: summary.group } : {}),
        ...(summary.description ? { description: summary.description } : {}),
      });
    }
    return outcome;
  }

  return {
    finalizeSessionOrganizerRun,
    triggerAutomaticSessionLabeling,
  };
}
