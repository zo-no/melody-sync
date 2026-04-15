import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from '../../session/workflow-state.mjs';

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export async function readSessionPatchRequest(req) {
  let patch;
  try {
    patch = await readJsonRequestBody(req, 10240);
  } catch {
    throw badRequest('Bad request');
  }

  const hasArchivedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'archived');
  const hasPinnedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'pinned');
  const hasToolPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tool');
  const hasModelPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'model');
  const hasEffortPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'effort');
  const hasThinkingPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'thinking');
  const hasGroupPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'group');
  const hasDescriptionPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'description');
  const hasSidebarOrderPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'sidebarOrder');
  const hasActiveAgreementsPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'activeAgreements');
  const hasPersistentPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'persistent');
  const hasWorkflowStatePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowState');
  const hasWorkflowPriorityPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowPriority');
  const hasLastReviewedAtPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'lastReviewedAt');

  if (hasArchivedPatch && typeof patch.archived !== 'boolean') throw badRequest('archived must be a boolean');
  if (hasPinnedPatch && typeof patch.pinned !== 'boolean') throw badRequest('pinned must be a boolean');
  if (hasToolPatch && typeof patch.tool !== 'string') throw badRequest('tool must be a string');
  if (hasModelPatch && typeof patch.model !== 'string') throw badRequest('model must be a string');
  if (hasEffortPatch && typeof patch.effort !== 'string') throw badRequest('effort must be a string');
  if (hasThinkingPatch && typeof patch.thinking !== 'boolean') throw badRequest('thinking must be a boolean');
  if (hasGroupPatch && patch.group !== null && typeof patch.group !== 'string') throw badRequest('group must be a string or null');
  if (hasDescriptionPatch && patch.description !== null && typeof patch.description !== 'string') throw badRequest('description must be a string or null');
  if (hasSidebarOrderPatch && patch.sidebarOrder !== null && (!Number.isInteger(patch.sidebarOrder) || patch.sidebarOrder < 1)) {
    throw badRequest('sidebarOrder must be a positive integer or null');
  }
  if (hasActiveAgreementsPatch && patch.activeAgreements !== null && !Array.isArray(patch.activeAgreements)) {
    throw badRequest('activeAgreements must be an array of strings or null');
  }
  if (hasActiveAgreementsPatch && Array.isArray(patch.activeAgreements)) {
    const invalidAgreement = patch.activeAgreements.find((entry) => typeof entry !== 'string');
    if (invalidAgreement !== undefined) throw badRequest('activeAgreements must contain only strings');
  }
  if (hasPersistentPatch && patch.persistent !== null && (typeof patch.persistent !== 'object' || Array.isArray(patch.persistent))) {
    throw badRequest('persistent must be an object or null');
  }
  if (hasWorkflowStatePatch && patch.workflowState !== null && typeof patch.workflowState !== 'string') {
    throw badRequest('workflowState must be a string or null');
  }
  if (hasWorkflowPriorityPatch && patch.workflowPriority !== null && typeof patch.workflowPriority !== 'string') {
    throw badRequest('workflowPriority must be a string or null');
  }
  if (hasLastReviewedAtPatch && patch.lastReviewedAt !== null && typeof patch.lastReviewedAt !== 'string') {
    throw badRequest('lastReviewedAt must be a string or null');
  }
  if (
    hasWorkflowStatePatch
    && patch.workflowState !== null
    && String(patch.workflowState).trim()
    && !normalizeSessionWorkflowState(String(patch.workflowState))
  ) {
    throw badRequest('workflowState must be parked, waiting_user, or done');
  }
  if (
    hasWorkflowPriorityPatch
    && patch.workflowPriority !== null
    && String(patch.workflowPriority).trim()
    && !normalizeSessionWorkflowPriority(String(patch.workflowPriority))
  ) {
    throw badRequest('workflowPriority must be high, medium, or low');
  }
  if (
    hasLastReviewedAtPatch
    && patch.lastReviewedAt !== null
    && String(patch.lastReviewedAt).trim()
    && !Number.isFinite(Date.parse(String(patch.lastReviewedAt).trim()))
  ) {
    throw badRequest('lastReviewedAt must be a valid timestamp or null');
  }

  return patch;
}
