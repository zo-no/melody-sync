export function createSessionTaskCardService({
  loadHistory,
  normalizeSessionTaskCard,
  normalizeSuppressedBranchTitles,
  statusEvent,
  trimString,
}) {
  function normalizeCandidateBranchTitles(taskCard) {
    return Array.isArray(taskCard?.candidateBranches)
      ? taskCard.candidateBranches
        .map((entry) => String(entry || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      : [];
  }

  function getSessionParentSessionId(sessionMeta) {
    return typeof sessionMeta?.sourceContext?.parentSessionId === 'string'
      ? sessionMeta.sourceContext.parentSessionId.trim()
      : '';
  }

  function stabilizeSessionTaskCard(sessionMeta, taskCard, options = {}) {
    const managedBindingKeys = new Set(
      (Array.isArray(options?.managedBindingKeys) ? options.managedBindingKeys : [])
        .map((value) => trimString(value))
        .filter(Boolean),
    );
    const shouldPreserveManagedMainGoal = managedBindingKeys.has('mainGoal') || managedBindingKeys.has('goal');
    const shouldPreserveManagedCandidateBranches = managedBindingKeys.has('candidateBranches');
    const shouldPreserveManagedLineRole = managedBindingKeys.has('lineRole');
    const shouldPreserveManagedBranchFrom = managedBindingKeys.has('branchFrom');
    const shouldPreserveManagedBranchReason = managedBindingKeys.has('branchReason');
    const normalizeTaskCardOptions = shouldPreserveManagedCandidateBranches
      ? { preserveCandidateBranches: true }
      : undefined;
    const parsedTaskCard = normalizeSessionTaskCard(taskCard, normalizeTaskCardOptions);
    if (!parsedTaskCard) return null;

    const currentTaskCard = normalizeSessionTaskCard(sessionMeta?.taskCard || null);
    const stableSessionTitle = trimString(sessionMeta?.name);
    const canPersistBranchRole = Boolean(getSessionParentSessionId(sessionMeta));
    const explicitLineRole = taskCard && Object.prototype.hasOwnProperty.call(taskCard, 'lineRole');
    const resolvedLineRole = canPersistBranchRole && !explicitLineRole && currentTaskCard?.lineRole === 'branch'
      ? 'branch'
      : parsedTaskCard.lineRole;

    if (resolvedLineRole !== 'branch' || !canPersistBranchRole) {
      const anchoredMainGoal = trimString(
        shouldPreserveManagedMainGoal
          ? (parsedTaskCard.mainGoal || parsedTaskCard.goal || currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
          : (
            currentTaskCard?.lineRole !== 'branch'
              ? (currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
              : stableSessionTitle
          )
      ) || trimString(parsedTaskCard.mainGoal || parsedTaskCard.goal);

      return normalizeSessionTaskCard({
        ...parsedTaskCard,
        goal: anchoredMainGoal,
        mainGoal: anchoredMainGoal,
        lineRole: shouldPreserveManagedLineRole ? resolvedLineRole : 'main',
        branchFrom: shouldPreserveManagedBranchFrom
          ? (parsedTaskCard.branchFrom || currentTaskCard?.branchFrom || '')
          : '',
        branchReason: shouldPreserveManagedBranchReason
          ? (parsedTaskCard.branchReason || currentTaskCard?.branchReason || '')
          : '',
      }, normalizeTaskCardOptions);
    }

    const anchoredParentGoal = trimString(
      shouldPreserveManagedMainGoal
        ? (parsedTaskCard.mainGoal || currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
        : (
          parsedTaskCard.mainGoal
          || currentTaskCard?.mainGoal
          || currentTaskCard?.goal
          || stableSessionTitle
        ),
    ) || trimString(parsedTaskCard.branchFrom || parsedTaskCard.goal);

    return normalizeSessionTaskCard({
      ...parsedTaskCard,
      mainGoal: anchoredParentGoal,
      lineRole: shouldPreserveManagedLineRole ? resolvedLineRole : 'branch',
      branchFrom: shouldPreserveManagedBranchFrom
        ? (parsedTaskCard.branchFrom || currentTaskCard?.branchFrom || anchoredParentGoal)
        : trimString(parsedTaskCard.branchFrom || anchoredParentGoal),
      branchReason: shouldPreserveManagedBranchReason
        ? (parsedTaskCard.branchReason || currentTaskCard?.branchReason || '')
        : '',
    }, normalizeTaskCardOptions);
  }

  async function findLatestUserMessageSeqForRun(sessionId, run) {
    if (!sessionId || !run?.id) return 0;
    const events = await loadHistory(sessionId, { includeBodies: false });
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'message' || event.role !== 'user') continue;
      if (run.requestId && event.requestId === run.requestId) {
        return Number.isInteger(event.seq) ? event.seq : 0;
      }
      if (event.runId === run.id) {
        return Number.isInteger(event.seq) ? event.seq : 0;
      }
    }
    return 0;
  }

  function buildBranchCandidateStatusEvents(run, {
    sourceSeq = 0,
    previousTaskCard = null,
    nextTaskCard = null,
    suppressedBranchTitles = [],
  } = {}) {
    const nextCandidates = normalizeCandidateBranchTitles(nextTaskCard);
    if (nextCandidates.length === 0) return [];

    const previousKeys = new Set(
      normalizeCandidateBranchTitles(previousTaskCard).map((entry) => entry.toLowerCase()),
    );
    const suppressedKeys = new Set(
      normalizeSuppressedBranchTitles(suppressedBranchTitles).map((entry) => entry.toLowerCase()),
    );
    const branchReason = trimString(nextTaskCard?.branchReason)
      || `当前主任务保持为「${trimString(nextTaskCard?.mainGoal || nextTaskCard?.goal) || '当前任务'}」，这条线建议单独展开。`;

    return nextCandidates
      .filter((branchTitle) => {
        const key = branchTitle.toLowerCase();
        return !previousKeys.has(key) && !suppressedKeys.has(key);
      })
      .map((branchTitle) => ({
        ...statusEvent(`建议拆出支线：${branchTitle}`, {
          statusKind: 'branch_candidate',
          branchTitle,
          branchReason,
          autoSuggested: true,
          intentShift: true,
          independentGoal: true,
          ...(sourceSeq > 0 ? { sourceSeq } : {}),
        }),
        runId: run.id,
        ...(run.requestId ? { requestId: run.requestId } : {}),
      }));
  }

  return {
    buildBranchCandidateStatusEvents,
    findLatestUserMessageSeqForRun,
    stabilizeSessionTaskCard,
  };
}
