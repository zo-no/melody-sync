import { homedir } from 'os';
import { join, resolve } from 'path';
import { readBody } from '../../lib/utils.mjs';
import { readSessionMessagePayload } from '../controllers/session/message-request.mjs';
import { readJsonRequestBody } from '../shared/http/request-body.mjs';
import {
  cancelActiveRun,
  createSession,
  deleteSessionPermanently,
  delegateSession,
  forkSession,
  organizeSession,
  promoteSessionToPersistent,
  renameSession,
  runSessionPersistent,
  setSessionArchived,
  setSessionPinned,
  updateSessionAgreements,
  updateSessionGrouping,
  updateSessionLastReviewedAt,
  updateSessionPersistent,
  updateSessionRuntimePreferences,
  updateSessionWorkflowClassification,
} from '../session/manager.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from '../session/workflow-state.mjs';
import { getSessionForClient } from '../services/session/client-session-service.mjs';
import { pathExists, statOrNull } from '../fs-utils.mjs';
import { submitSessionHttpMessageForClient } from '../services/session/http-message-service.mjs';
import { createClientSessionDetail } from '../views/session/client.mjs';

async function isDirectoryPath(path) {
  return (await statOrNull(path))?.isDirectory() === true;
}

export async function handleSessionWriteRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (pathname.startsWith('/api/sessions/') && req?.method === 'POST') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    const action = parts[3] || null;

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'organize') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      let payload = {};
      try {
        payload = await readJsonRequestBody(req, 8192);
      } catch {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'tool') && payload.tool !== null && typeof payload.tool !== 'string') {
        writeJson(res, 400, { error: 'tool must be a string when provided' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'model') && payload.model !== null && typeof payload.model !== 'string') {
        writeJson(res, 400, { error: 'model must be a string when provided' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'effort') && payload.effort !== null && typeof payload.effort !== 'string') {
        writeJson(res, 400, { error: 'effort must be a string when provided' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'thinking') && typeof payload.thinking !== 'boolean') {
        writeJson(res, 400, { error: 'thinking must be a boolean when provided' });
        return true;
      }

      try {
        const outcome = await organizeSession(sessionId, {
          tool: typeof payload?.tool === 'string' ? payload.tool.trim() : '',
          model: typeof payload?.model === 'string' ? payload.model.trim() : '',
          effort: typeof payload?.effort === 'string' ? payload.effort.trim() : '',
          thinking: payload?.thinking === true,
        });
        writeJson(res, outcome.duplicate ? 200 : 202, {
          duplicate: outcome.duplicate,
          run: outcome.run || null,
          session: createClientSessionDetail(outcome.session),
        });
      } catch (error) {
        writeJson(res, 409, { error: error.message || 'Failed to organize session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'promote-persistent') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      let payload = {};
      try {
        payload = await readJsonRequestBody(req, 16384);
      } catch {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      if (typeof payload?.kind !== 'string' || !payload.kind.trim()) {
        writeJson(res, 400, { error: 'kind is required' });
        return true;
      }
      try {
        const session = await promoteSessionToPersistent(sessionId, payload);
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' });
          return true;
        }
        writeJson(res, 200, { session: createClientSessionDetail(session) });
      } catch (error) {
        writeJson(res, 409, { error: error.message || 'Failed to promote session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'run-persistent') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      let payload = {};
      try {
        payload = await readJsonRequestBody(req, 16384);
      } catch {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      try {
        const outcome = await runSessionPersistent(sessionId, payload);
        if (!outcome?.session) {
          writeJson(res, 404, { error: 'Session not found' });
          return true;
        }
        writeJson(res, 202, {
          duplicate: outcome.duplicate,
          queued: outcome.queued,
          run: outcome.run || null,
          session: createClientSessionDetail(outcome.session),
        });
      } catch (error) {
        writeJson(res, 409, { error: error.message || 'Failed to run persistent session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'messages') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      let payload;
      try {
        payload = await readSessionMessagePayload(req, pathname);
      } catch (error) {
        writeJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
          error: error.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request',
        });
        return true;
      }
      if (!payload || typeof payload !== 'object') {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      if (!payload?.text || typeof payload.text !== 'string') {
        writeJson(res, 400, { error: 'text is required' });
        return true;
      }

      try {
        const { requestId, outcome } = await submitSessionHttpMessageForClient({
          sessionId,
          payload,
          authSession,
          hasSessionAccess: (nextAuthSession, targetSessionId) => !!nextAuthSession && !!targetSessionId,
        });
        writeJson(res, outcome.duplicate ? 200 : 202, {
          requestId: requestId || outcome.run?.requestId || null,
          duplicate: outcome.duplicate,
          queued: outcome.queued,
          run: outcome.run,
          session: createClientSessionDetail(outcome.session),
        });
      } catch (error) {
        const statusCode = error?.statusCode || (error?.code === 'SESSION_ARCHIVED' ? 409 : 400);
        writeJson(res, statusCode, { error: error.message || 'Failed to submit message' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'cancel') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const run = await cancelActiveRun(sessionId);
      if (!run) {
        const session = await getSessionForClient(sessionId);
        if (session && session.activity?.run?.state !== 'running') {
          writeJson(res, 200, { run: null, session });
          return true;
        }
        writeJson(res, 409, { error: 'No active run' });
        return true;
      }
      writeJson(res, 200, { run });
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'fork') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const source = await getSessionForClient(sessionId);
      if (!source) {
        writeJson(res, 404, { error: 'Session not found' });
        return true;
      }
      const runState = String(source?.activity?.run?.state || '').toLowerCase();
      if (runState === 'running' || runState === 'accepted') {
        writeJson(res, 409, { error: 'Session is running' });
        return true;
      }
      const forked = await forkSession(sessionId);
      if (!forked) {
        writeJson(res, 409, { error: 'Unable to fork session' });
        return true;
      }
      writeJson(res, 201, { session: createClientSessionDetail(forked) });
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'delegate') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const source = await getSessionForClient(sessionId);
      if (!source) {
        writeJson(res, 404, { error: 'Session not found' });
        return true;
      }

      let payload = {};
      try {
        payload = await readJsonRequestBody(req, 32768);
      } catch {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }

      const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
      if (!task) {
        writeJson(res, 400, { error: 'task is required' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'tool') && payload.tool !== null && typeof payload.tool !== 'string') {
        writeJson(res, 400, { error: 'tool must be a string when provided' });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'internal') && typeof payload.internal !== 'boolean') {
        writeJson(res, 400, { error: 'internal must be a boolean when provided' });
        return true;
      }

      try {
        const outcome = await delegateSession(sessionId, {
          task,
          name: typeof payload?.name === 'string' ? payload.name.trim() : '',
          tool: typeof payload?.tool === 'string' ? payload.tool.trim() : '',
          internal: payload?.internal === true,
        });
        if (!outcome?.session) {
          writeJson(res, 409, { error: 'Unable to delegate session' });
          return true;
        }
        writeJson(res, 201, {
          session: createClientSessionDetail(outcome.session),
          run: outcome.run || null,
        });
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Failed to delegate session' });
      }
      return true;
    }
  }

  if (pathname.startsWith('/api/sessions/') && req?.method === 'PATCH') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
      writeJson(res, 400, { error: 'Invalid session path' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, sessionId)) return true;

    let body;
    try {
      body = await readJsonRequestBody(req, 10240);
    } catch {
      writeJson(res, 400, { error: 'Bad request' });
      return true;
    }
    const patch = body;

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

  if (pathname.startsWith('/api/sessions/') && req?.method === 'DELETE') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
      writeJson(res, 400, { error: 'Invalid session path' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    try {
      const outcome = await deleteSessionPermanently(sessionId);
      writeJson(res, 200, { deletedSessionIds: outcome?.deletedSessionIds || [] });
    } catch (error) {
      writeJson(res, error?.statusCode || 409, {
        error: error?.message || 'Failed to delete session',
      });
    }
    return true;
  }

  if (pathname === '/api/sessions' && req?.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 10240);
    } catch (error) {
      writeJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
        error: error.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request',
      });
      return true;
    }

    try {
      const payload = JSON.parse(body);
      const {
        folder,
        tool,
        name,
        userId,
        userName,
        sourceId,
        sourceName,
        group,
        description,
        systemPrompt,
        internalRole,
        completionTargets,
        externalTriggerId,
        sourceContext,
      } = payload;
      if (!folder || !tool) {
        writeJson(res, 400, { error: 'folder and tool are required' });
        return true;
      }
      const resolvedFolder = folder.startsWith('~')
        ? join(homedir(), folder.slice(1))
        : resolve(folder);
      if (!await isDirectoryPath(resolvedFolder)) {
        writeJson(res, 400, { error: 'Folder does not exist' });
        return true;
      }
      const createOptions = {
        userId: typeof userId === 'string' ? userId : '',
        userName: typeof userName === 'string' ? userName : '',
        sourceId: typeof sourceId === 'string' ? sourceId : '',
        sourceName: typeof sourceName === 'string' ? sourceName : '',
        group: (typeof group === 'string' && group.trim()) ? group : '收集箱',
        description: description || '',
        completionTargets: Array.isArray(completionTargets) ? completionTargets : [],
        externalTriggerId: typeof externalTriggerId === 'string' ? externalTriggerId : '',
      };
      if (Object.prototype.hasOwnProperty.call(payload, 'systemPrompt')) {
        createOptions.systemPrompt = typeof systemPrompt === 'string' ? systemPrompt : '';
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'internalRole')) {
        if (internalRole !== null && typeof internalRole !== 'string') {
          writeJson(res, 400, { error: 'internalRole must be a string when provided' });
          return true;
        }
        createOptions.internalRole = typeof internalRole === 'string' ? internalRole.trim() : '';
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'sourceContext')) {
        createOptions.sourceContext = sourceContext;
      }
      const session = await createSession(resolvedFolder, tool, name || '', createOptions);
      writeJson(res, 201, { session: createClientSessionDetail(session) });
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
    }
    return true;
  }

  return false;
}
