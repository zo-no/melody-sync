import { homedir } from 'os';
import { join, resolve } from 'path';

import {
  cancelActiveRun,
  createSession,
  delegateSession,
  forkSession,
  getSession,
  organizeSession,
  promoteSessionToPersistent,
  runSessionPersistent,
} from '../../session/manager.mjs';
import { statOrNull } from '../../fs-utils.mjs';

async function isDirectoryPath(path) {
  return (await statOrNull(path))?.isDirectory() === true;
}

export async function organizeSessionForHttp(sessionId, payload = {}) {
  return organizeSession(sessionId, {
    tool: typeof payload?.tool === 'string' ? payload.tool.trim() : '',
    model: typeof payload?.model === 'string' ? payload.model.trim() : '',
    effort: typeof payload?.effort === 'string' ? payload.effort.trim() : '',
    thinking: payload?.thinking === true,
  });
}

export async function promoteSessionPersistentForHttp(sessionId, payload = {}) {
  return promoteSessionToPersistent(sessionId, payload);
}

export async function runSessionPersistentForHttp(sessionId, payload = {}) {
  return runSessionPersistent(sessionId, payload);
}

export async function cancelSessionRunForHttp(sessionId) {
  const run = await cancelActiveRun(sessionId);
  if (run) {
    return { run, session: null, kind: 'canceled' };
  }
  const session = await getSession(sessionId);
  if (session && session.activity?.run?.state !== 'running') {
    return { run: null, session, kind: 'idle' };
  }
  return { run: null, session: null, kind: 'missing_active_run' };
}

export async function forkSessionForHttp(sessionId) {
  const source = await getSession(sessionId);
  if (!source) {
    return { session: null, kind: 'not_found' };
  }
  const runState = String(source?.activity?.run?.state || '').toLowerCase();
  if (runState === 'running' || runState === 'accepted') {
    return { session: null, kind: 'running' };
  }
  const session = await forkSession(sessionId);
  if (!session) {
    return { session: null, kind: 'unavailable' };
  }
  return { session, kind: 'created' };
}

export async function delegateSessionForHttp(sessionId, payload = {}) {
  const source = await getSession(sessionId);
  if (!source) {
    return { session: null, run: null, kind: 'not_found' };
  }
  const outcome = await delegateSession(sessionId, {
    task: typeof payload?.task === 'string' ? payload.task.trim() : '',
    name: typeof payload?.name === 'string' ? payload.name.trim() : '',
    tool: typeof payload?.tool === 'string' ? payload.tool.trim() : '',
    internal: payload?.internal === true,
  });
  if (!outcome?.session) {
    return { session: null, run: null, kind: 'unavailable' };
  }
  return { ...outcome, kind: 'created' };
}

export async function createSessionForHttp(payload = {}) {
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
    const error = new Error('folder and tool are required');
    error.statusCode = 400;
    throw error;
  }
  const resolvedFolder = folder.startsWith('~')
    ? join(homedir(), folder.slice(1))
    : resolve(folder);
  if (!await isDirectoryPath(resolvedFolder)) {
    const error = new Error('Folder does not exist');
    error.statusCode = 400;
    throw error;
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
      const error = new Error('internalRole must be a string when provided');
      error.statusCode = 400;
      throw error;
    }
    createOptions.internalRole = typeof internalRole === 'string' ? internalRole.trim() : '';
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceContext')) {
    createOptions.sourceContext = sourceContext;
  }
  return createSession(resolvedFolder, tool, name || '', createOptions);
}
