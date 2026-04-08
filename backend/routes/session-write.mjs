import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { readBody } from '../../lib/utils.mjs';
import {
  cancelActiveRun,
  createSession,
  delegateSession,
  forkSession,
  getSession,
  organizeSession,
  promoteSessionToPersistent,
  resolveSavedAttachments,
  runSessionPersistent,
  saveAttachments,
  sendMessage,
  submitHttpMessage,
} from '../session/manager.mjs';
import { createSessionDetail } from '../session/api-shapes.mjs';
import { pathExists, statOrNull } from '../fs-utils.mjs';
import { getFileAsset } from '../file-assets.mjs';

const MESSAGE_SUBMISSION_MAX_BYTES = 256 * 1024 * 1024;

function createClientSessionDetail(session) {
  return createSessionDetail(session);
}

async function getSessionForClient(id, options = {}) {
  return createClientSessionDetail(await getSession(id, options));
}

function bodyTooLargeError() {
  return Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' });
}

function getMultipartBodyLength(req) {
  const rawLength = Array.isArray(req.headers['content-length'])
    ? req.headers['content-length'][0]
    : req.headers['content-length'];
  const parsedLength = Number.parseInt(rawLength || '', 10);
  return Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : null;
}

function parseFormString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseFormJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readSessionMessagePayload(req, pathname) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    const body = await readBody(req, MESSAGE_SUBMISSION_MAX_BYTES);
    return JSON.parse(body);
  }

  const contentLength = getMultipartBodyLength(req);
  if (contentLength !== null && contentLength > MESSAGE_SUBMISSION_MAX_BYTES) {
    throw bodyTooLargeError();
  }

  const formRequest = new Request(`http://127.0.0.1${pathname}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  const formData = await formRequest.formData();
  const images = [];
  for (const entry of formData.getAll('images')) {
    if (!entry || typeof entry.arrayBuffer !== 'function') continue;
    images.push({
      buffer: Buffer.from(await entry.arrayBuffer()),
      mimeType: typeof entry.type === 'string' ? entry.type : '',
      originalName: typeof entry.name === 'string' ? entry.name : '',
    });
  }
  const existingImages = parseFormJson(parseFormString(formData.get('existingImages')), []);
  if (Array.isArray(existingImages)) {
    for (const image of existingImages) {
      if (!image || typeof image !== 'object') continue;
      if (typeof image.filename !== 'string' || !image.filename.trim()) continue;
      images.push({
        filename: image.filename.trim(),
        originalName: parseFormString(image.originalName),
        mimeType: parseFormString(image.mimeType),
      });
    }
  }
  const externalAssets = parseFormJson(parseFormString(formData.get('externalAssets')), []);
  if (Array.isArray(externalAssets)) {
    for (const asset of externalAssets) {
      if (!asset || typeof asset !== 'object') continue;
      if (typeof asset.assetId !== 'string' || !asset.assetId.trim()) continue;
      images.push({
        assetId: asset.assetId.trim(),
        originalName: parseFormString(asset.originalName),
        mimeType: parseFormString(asset.mimeType),
      });
    }
  }

  return {
    requestId: parseFormString(formData.get('requestId')),
    text: parseFormString(formData.get('text')),
    tool: parseFormString(formData.get('tool')),
    model: parseFormString(formData.get('model')),
    effort: parseFormString(formData.get('effort')),
    thinking: parseFormString(formData.get('thinking')) === 'true',
    sourceContext: parseFormJson(parseFormString(formData.get('sourceContext')), null),
    images,
  };
}

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
        const body = await readBody(req, 8192);
        payload = body ? JSON.parse(body) : {};
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
        const body = await readBody(req, 16384);
        payload = body ? JSON.parse(body) : {};
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
        const body = await readBody(req, 16384);
        payload = body ? JSON.parse(body) : {};
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
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
        const requestedImages = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : [];
        const uploadedImages = requestedImages.filter((image) => Buffer.isBuffer(image?.buffer) || typeof image?.data === 'string');
        const existingImages = requestedImages.filter((image) => typeof image?.filename === 'string' && image.filename.trim() && !image?.assetId);
        const externalAssetImages = [];
        for (const image of requestedImages) {
          const assetId = typeof image?.assetId === 'string' ? image.assetId.trim() : '';
          if (!assetId) continue;
          const asset = await getFileAsset(assetId);
          if (!asset) {
            writeJson(res, 400, { error: `Unknown asset: ${assetId}` });
            return true;
          }
          if (!requireSessionAccess(res, authSession, asset.sessionId)) return true;
          if (asset.status !== 'ready') {
            writeJson(res, 409, { error: `Asset is not ready: ${assetId}` });
            return true;
          }
          const localizedPath = typeof asset.localizedPath === 'string' && asset.localizedPath && await pathExists(asset.localizedPath)
            ? asset.localizedPath
            : '';
          externalAssetImages.push({
            assetId: asset.id,
            ...(localizedPath ? {
              savedPath: localizedPath,
              filename: typeof image?.filename === 'string' && image.filename.trim()
                ? image.filename.trim()
                : basename(localizedPath),
            } : {}),
            originalName: typeof image?.originalName === 'string' && image.originalName.trim()
              ? image.originalName.trim()
              : asset.originalName,
            mimeType: typeof image?.mimeType === 'string' && image.mimeType.trim()
              ? image.mimeType.trim()
              : asset.mimeType,
          });
        }
        const preSavedAttachments = [
          ...(await resolveSavedAttachments(existingImages)),
          ...(uploadedImages.length > 0 ? await saveAttachments(uploadedImages) : []),
          ...externalAssetImages,
        ];
        const messageOptions = {
          tool: payload.tool || undefined,
          thinking: !!payload.thinking,
          model: payload.model || undefined,
          effort: payload.effort || undefined,
          sourceContext: payload.sourceContext,
          ...(preSavedAttachments.length > 0 ? { preSavedAttachments } : {}),
        };
        const outcome = requestId
          ? await submitHttpMessage(sessionId, payload.text.trim(), [], {
              ...messageOptions,
              requestId,
            })
          : await sendMessage(sessionId, payload.text.trim(), [], messageOptions);
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
        const body = await readBody(req, 32768);
        payload = body ? JSON.parse(body) : {};
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
