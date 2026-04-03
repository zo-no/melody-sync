import { readBody } from '../../lib/utils.mjs';
import { createSessionDetail } from '../session-api-shapes.mjs';
import {
  createCustomNodeKind,
  deleteCustomNodeKind,
  updateCustomNodeKind,
} from '../workbench/node-settings-store.mjs';
import {
  createBranchFromSession,
  createBranchFromNode,
  createCaptureItem,
  createNode as createWorkbenchNode,
  createProject as createWorkbenchProject,
  createProjectSummary,
  getSessionOperationRecords,
  getWorkbenchSnapshot,
  getWorkbenchTrackerSnapshot,
  mergeBranchSessionBackToMain,
  promoteCaptureItem,
  setBranchCandidateSuppressed,
  setBranchSessionStatus,
  setSessionReminderSnooze,
  writeProjectToObsidian,
} from '../workbench-store.mjs';
import { createWorkbenchNodeDefinitionsPayload } from '../workbench/node-definitions.mjs';

function createClientSessionDetail(session) {
  return createSessionDetail(session);
}

async function readJsonBody(req, maxBytes = 65536) {
  const raw = await readBody(req, maxBytes);
  return raw ? JSON.parse(raw) : {};
}

export async function handleWorkbenchRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'GET') {
    writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    return true;
  }

  if (pathname === '/api/workbench' && req?.method === 'GET') {
    const snapshot = await getWorkbenchSnapshot();
    writeJson(res, 200, snapshot);
    return true;
  }

  if (pathname === '/api/workbench/node-definitions' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      await createCustomNodeKind(payload);
      writeJson(res, 201, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to create custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'PATCH') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    let payload = {};
    try {
      payload = await readJsonBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      await updateCustomNodeKind(nodeKindId, payload);
      writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    try {
      await deleteCustomNodeKind(nodeKindId);
      writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/') && req?.method === 'GET') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'tracker') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const trackerSnapshot = await getWorkbenchTrackerSnapshot(sessionId);
      writeJson(res, 200, trackerSnapshot);
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'operation-record') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const result = await getSessionOperationRecords(sessionId);
        writeJson(res, 200, result);
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Failed to build operation record' });
      }
      return true;
    }

    return false;
  }

  if (!(pathname.startsWith('/api/workbench/') && req?.method === 'POST')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);
  let payload = {};
  try {
    payload = await readJsonBody(req, 65536);
  } catch {
    writeJson(res, 400, { error: 'Invalid request body' });
    return true;
  }

  try {
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures') {
      const captureItem = await createCaptureItem(payload);
      writeJson(res, 201, {
        captureItem,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects') {
      const project = await createWorkbenchProject(payload);
      writeJson(res, 201, {
        project,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes') {
      const node = await createWorkbenchNode(payload);
      writeJson(res, 201, {
        node,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures' && parts[4] === 'promote') {
      const captureId = parts[3];
      const outcome = await promoteCaptureItem(captureId, payload);
      writeJson(res, 201, {
        ...outcome,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes' && parts[4] === 'branch') {
      const nodeId = parts[3];
      const outcome = await createBranchFromNode(nodeId, payload);
      writeJson(res, 201, {
        session: createClientSessionDetail(outcome.session),
        branchContext: outcome.branchContext,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branches') {
      const sessionId = parts[3];
      const outcome = await createBranchFromSession(sessionId, payload);
      writeJson(res, 201, {
        session: createClientSessionDetail(outcome.session),
        branchContext: outcome.branchContext,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'candidate-suppression') {
      const sessionId = parts[3];
      const branchTitle = typeof payload?.branchTitle === 'string' ? payload.branchTitle.trim() : '';
      if (!branchTitle) {
        writeJson(res, 400, { error: 'branchTitle is required' });
        return true;
      }
      const outcome = await setBranchCandidateSuppressed(sessionId, branchTitle, payload?.suppressed !== false);
      writeJson(res, 200, {
        session: createClientSessionDetail(outcome.session),
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branch-status') {
      const sessionId = parts[3];
      const outcome = await setBranchSessionStatus(sessionId, payload);
      writeJson(res, 200, {
        session: createClientSessionDetail(outcome.session),
        branchContext: outcome.branchContext,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'reminder') {
      const sessionId = parts[3];
      const reminder = await setSessionReminderSnooze(sessionId, payload);
      writeJson(res, 200, {
        reminder,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'merge-return') {
      const sessionId = parts[3];
      const outcome = await mergeBranchSessionBackToMain(sessionId, payload);
      writeJson(res, 200, {
        session: createClientSessionDetail(outcome.parentSession),
        mergeNote: outcome.mergeNote,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'summaries') {
      const projectId = parts[3];
      const summary = await createProjectSummary(projectId);
      writeJson(res, 201, {
        summary,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'writeback') {
      const projectId = parts[3];
      const outcome = await writeProjectToObsidian(projectId, payload);
      writeJson(res, 200, {
        ...outcome,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Workbench request failed' });
    return true;
  }

  writeJson(res, 404, { error: 'Workbench route not found' });
  return true;
}
