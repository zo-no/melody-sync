import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import { getSessionForClient } from '../../services/session/client-session-service.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from '../../session/workflow-state.mjs';
import {
  renameSession,
  setSessionArchived,
  setSessionPinned,
  updateSessionAgreements,
  updateSessionGrouping,
  updateSessionLastReviewedAt,
  updateSessionPersistent,
  updateSessionRuntimePreferences,
  updateSessionWorkflowClassification,
} from '../../session/manager.mjs';
import { createClientSessionDetail } from '../../views/session/client.mjs';

export async function handleSessionPatchRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (!(pathname.startsWith('/api/sessions/') && req?.method === 'PATCH')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);
  const sessionId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
    writeJson(res, 400, { error: 'Invalid session path' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, sessionId)) return true;

  let patch;
  try {
    patch = await readJsonRequestBody(req, 10240);
  } catch {
    writeJson(res, 400, { error: 'Bad request' });
    return true;
  }

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
  const hasWorkflowStatePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowState');
  const hasWorkflowPriorityPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowPriority');
  const hasLastReviewedAtPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'lastReviewedAt');

  if (hasArchivedPatch && typeof patch.archived !== 'boolean') {
    writeJson(res, 400, { error: 'archived must be a boolean' });
    return true;
  }
  if (hasPinnedPatch && typeof patch.pinned !== 'boolean') {
    writeJson(res, 400, { error: 'pinned must be a boolean' });
    return true;
  }
  if (hasToolPatch && typeof patch.tool !== 'string') {
    writeJson(res, 400, { error: 'tool must be a string' });
    return true;
  }
  if (hasModelPatch && typeof patch.model !== 'string') {
    writeJson(res, 400, { error: 'model must be a string' });
    return true;
  }
  if (hasEffortPatch && typeof patch.effort !== 'string') {
    writeJson(res, 400, { error: 'effort must be a string' });
    return true;
  }
  if (hasThinkingPatch && typeof patch.thinking !== 'boolean') {
    writeJson(res, 400, { error: 'thinking must be a boolean' });
    return true;
  }
  if (hasGroupPatch && patch.group !== null && typeof patch.group !== 'string') {
    writeJson(res, 400, { error: 'group must be a string or null' });
    return true;
  }
  if (hasManualGroupPatch && patch.manualGroup !== null && typeof patch.manualGroup !== 'string') {
    writeJson(res, 400, { error: 'manualGroup must be a string or null' });
    return true;
  }
  if (hasDescriptionPatch && patch.description !== null && typeof patch.description !== 'string') {
    writeJson(res, 400, { error: 'description must be a string or null' });
    return true;
  }
  if (hasSidebarOrderPatch && patch.sidebarOrder !== null && (!Number.isInteger(patch.sidebarOrder) || patch.sidebarOrder < 1)) {
    writeJson(res, 400, { error: 'sidebarOrder must be a positive integer or null' });
    return true;
  }
  if (hasActiveAgreementsPatch && patch.activeAgreements !== null && !Array.isArray(patch.activeAgreements)) {
    writeJson(res, 400, { error: 'activeAgreements must be an array of strings or null' });
    return true;
  }
  if (hasActiveAgreementsPatch && Array.isArray(patch.activeAgreements)) {
    const invalidAgreement = patch.activeAgreements.find((entry) => typeof entry !== 'string');
    if (invalidAgreement !== undefined) {
      writeJson(res, 400, { error: 'activeAgreements must contain only strings' });
      return true;
    }
  }
  if (hasPersistentPatch && patch.persistent !== null && (typeof patch.persistent !== 'object' || Array.isArray(patch.persistent))) {
    writeJson(res, 400, { error: 'persistent must be an object or null' });
    return true;
  }
  if (hasWorkflowStatePatch && patch.workflowState !== null && typeof patch.workflowState !== 'string') {
    writeJson(res, 400, { error: 'workflowState must be a string or null' });
    return true;
  }
  if (hasWorkflowPriorityPatch && patch.workflowPriority !== null && typeof patch.workflowPriority !== 'string') {
    writeJson(res, 400, { error: 'workflowPriority must be a string or null' });
    return true;
  }
  if (hasLastReviewedAtPatch && patch.lastReviewedAt !== null && typeof patch.lastReviewedAt !== 'string') {
    writeJson(res, 400, { error: 'lastReviewedAt must be a string or null' });
    return true;
  }
  if (
    hasWorkflowStatePatch
    && patch.workflowState !== null
    && String(patch.workflowState).trim()
    && !normalizeSessionWorkflowState(String(patch.workflowState))
  ) {
    writeJson(res, 400, { error: 'workflowState must be parked, waiting_user, or done' });
    return true;
  }
  if (
    hasWorkflowPriorityPatch
    && patch.workflowPriority !== null
    && String(patch.workflowPriority).trim()
    && !normalizeSessionWorkflowPriority(String(patch.workflowPriority))
  ) {
    writeJson(res, 400, { error: 'workflowPriority must be high, medium, or low' });
    return true;
  }
  if (
    hasLastReviewedAtPatch
    && patch.lastReviewedAt !== null
    && String(patch.lastReviewedAt).trim()
    && !Number.isFinite(Date.parse(String(patch.lastReviewedAt).trim()))
  ) {
    writeJson(res, 400, { error: 'lastReviewedAt must be a valid timestamp or null' });
    return true;
  }

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
  if (!session) {
    session = await getSessionForClient(sessionId);
  }
  if (!session) {
    writeJson(res, 404, { error: 'Session not found' });
    return true;
  }
  writeJson(res, 200, { session: createClientSessionDetail(session) });
  return true;
}
