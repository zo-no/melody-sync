import {
  deleteSessionPermanently,
  getSession,
  renameSession,
  setSessionArchived,
  setSessionPinned,
  updateSessionAgreements,
  updateSessionGrouping,
  updateSessionLastReviewedAt,
  updateSessionPersistent,
  updateSessionRuntimePreferences,
  updateSessionTaskPoolMembership,
  updateSessionWorkflowClassification,
} from '../../session/manager.mjs';

export async function applySessionHttpPatch(sessionId, patch = {}) {
  const hasArchivedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'archived');
  const hasPinnedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'pinned');
  const hasToolPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tool');
  const hasModelPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'model');
  const hasEffortPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'effort');
  const hasThinkingPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'thinking');
  const hasGroupPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'group');
  const hasManualGroupPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'manualGroup');
  const hasDescriptionPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'description');
  const hasSidebarOrderPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'sidebarOrder');
  const hasActiveAgreementsPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'activeAgreements');
  const hasPersistentPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'persistent');
  const hasTaskPoolMembershipPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'taskPoolMembership');
  const hasWorkflowStatePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowState');
  const hasWorkflowPriorityPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowPriority');
  const hasLastReviewedAtPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'lastReviewedAt');

  let session = null;
  if (typeof patch.name === 'string' && patch.name.trim()) {
    session = await renameSession(sessionId, patch.name.trim());
  }
  if (hasArchivedPatch) {
    session = await setSessionArchived(sessionId, patch.archived) || session;
  }
  if (hasPinnedPatch) {
    session = await setSessionPinned(sessionId, patch.pinned) || session;
  }
  if (hasGroupPatch || hasManualGroupPatch || hasDescriptionPatch || hasSidebarOrderPatch) {
    session = await updateSessionGrouping(sessionId, {
      ...(hasGroupPatch ? { group: patch.group ?? '' } : {}),
      ...(hasManualGroupPatch ? { manualGroup: patch.manualGroup ?? '' } : {}),
      ...(hasDescriptionPatch ? { description: patch.description ?? '' } : {}),
      ...(hasSidebarOrderPatch ? { sidebarOrder: patch.sidebarOrder ?? null } : {}),
    }) || session;
  }
  if (hasActiveAgreementsPatch) {
    session = await updateSessionAgreements(sessionId, {
      activeAgreements: patch.activeAgreements ?? [],
    }) || session;
  }
  if (hasPersistentPatch) {
    session = await updateSessionPersistent(sessionId, patch.persistent, {
      recomputeNextRunAt: true,
    }) || session;
  }
  if (hasTaskPoolMembershipPatch) {
    session = await updateSessionTaskPoolMembership(sessionId, patch.taskPoolMembership ?? null) || session;
  }
  if (hasWorkflowStatePatch || hasWorkflowPriorityPatch) {
    session = await updateSessionWorkflowClassification(sessionId, {
      ...(hasWorkflowStatePatch ? { workflowState: patch.workflowState || '' } : {}),
      ...(hasWorkflowPriorityPatch ? { workflowPriority: patch.workflowPriority || '' } : {}),
    }) || session;
  }
  if (hasToolPatch || hasModelPatch || hasEffortPatch || hasThinkingPatch) {
    session = await updateSessionRuntimePreferences(sessionId, {
      ...(hasToolPatch ? { tool: patch.tool } : {}),
      ...(hasModelPatch ? { model: patch.model } : {}),
      ...(hasEffortPatch ? { effort: patch.effort } : {}),
      ...(hasThinkingPatch ? { thinking: patch.thinking } : {}),
    }) || session;
  }
  if (hasLastReviewedAtPatch) {
    session = await updateSessionLastReviewedAt(sessionId, patch.lastReviewedAt || '') || session;
  }
  return session || await getSession(sessionId);
}

export async function deleteSessionForHttp(sessionId) {
  return deleteSessionPermanently(sessionId);
}
