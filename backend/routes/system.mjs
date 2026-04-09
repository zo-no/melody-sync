import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve, dirname, basename } from 'path';

import { getAuthSession, refreshAuthSession } from '../../lib/auth.mjs';
import { saveUiRuntimeSelection } from '../../lib/runtime-selection.mjs';
import { getAvailableToolsAsync } from '../../lib/tools.mjs';
import { readBody } from '../../lib/utils.mjs';

import { playHostCompletionSound } from '../completion-sound.mjs';
import { getModelsForTool } from '../models.mjs';
import { getPublicKey, addSubscription } from '../push.mjs';
import { enqueueHostCompletionSpeech } from '../completion-speech-queue.mjs';
import { buildAuthInfo } from '../views/system/auth.mjs';

function jsonError(writeJson, res, statusCode, message) {
  writeJson(res, statusCode, { error: message });
}

function getQueryValue(value, fallback = '') {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : fallback;
  return typeof value === 'string' ? value : fallback;
}

export async function handleSystemRoutes({
  req,
  res,
  pathname,
  parsedUrl,
  writeJson,
  writeJsonCached,
  writeFileCached,
  isDirectoryPath,
  pathExists,
  chatImagesDir,
  uploadedMediaMimeTypes,
  getAuthSession: getAuthSessionImpl = getAuthSession,
  playHostCompletionSound: playHostCompletionSoundImpl = playHostCompletionSound,
}) {
  if (pathname === '/api/models' && req.method === 'GET') {
    const toolId = getQueryValue(parsedUrl?.query?.tool);
    const result = await getModelsForTool(toolId);
    writeJsonCached(req, res, result);
    return true;
  }

  if (pathname === '/api/tools' && req.method === 'GET') {
    const tools = await getAvailableToolsAsync();
    writeJsonCached(req, res, { tools });
    return true;
  }

  if (pathname === '/api/autocomplete' && req.method === 'GET') {
    const query = getQueryValue(parsedUrl?.query?.q);
    const suggestions = [];
    try {
      const resolvedQuery = query.startsWith('~') ? join(homedir(), query.slice(1)) : query;
      const parentDir = dirname(resolvedQuery);
      const prefix = basename(resolvedQuery);
      if (await isDirectoryPath(parentDir)) {
        for (const entry of await readdir(parentDir)) {
          if (!prefix.startsWith('.') && entry.startsWith('.')) continue;
          const fullPath = join(parentDir, entry);
          if (await isDirectoryPath(fullPath) && entry.toLowerCase().startsWith(prefix.toLowerCase())) {
            suggestions.push(fullPath);
          }
        }
      }
    } catch {}
    writeJsonCached(req, res, { suggestions: suggestions.slice(0, 20) });
    return true;
  }

  if (pathname === '/api/browse' && req.method === 'GET') {
    const pathQuery = getQueryValue(parsedUrl?.query?.path, '~') || '~';
    try {
      const resolvedPath = pathQuery === '~' || pathQuery === ''
        ? homedir()
        : pathQuery.startsWith('~')
          ? join(homedir(), pathQuery.slice(1))
          : resolve(pathQuery);
      const children = [];
      let parent = null;
      if (await isDirectoryPath(resolvedPath)) {
        const parentPath = dirname(resolvedPath);
        parent = parentPath !== resolvedPath ? parentPath : null;
        for (const entry of await readdir(resolvedPath)) {
          if (entry.startsWith('.')) continue;
          const fullPath = join(resolvedPath, entry);
          try {
            if (await isDirectoryPath(fullPath)) children.push({ name: entry, path: fullPath });
          } catch {}
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
      }
      writeJsonCached(req, res, { path: resolvedPath, parent, children });
    } catch {
      jsonError(writeJson, res, 500, 'Failed to browse directory');
    }
    return true;
  }

  if (pathname === '/api/runtime-selection' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 4096);
    } catch (err) {
      jsonError(writeJson, res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, err.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request');
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      jsonError(writeJson, res, 400, 'Invalid request body');
      return true;
    }
    try {
      const selection = await saveUiRuntimeSelection(payload || {});
      writeJson(res, 200, { selection });
    } catch (error) {
      jsonError(writeJson, res, 400, error.message || 'Failed to save runtime selection');
    }
    return true;
  }

  if ((pathname.startsWith('/api/images/') || pathname.startsWith('/api/media/')) && req.method === 'GET') {
    const prefix = pathname.startsWith('/api/media/') ? '/api/media/' : '/api/images/';
    const filename = pathname.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return true;
    }
    const filepath = join(chatImagesDir, filename);
    if (!await pathExists(filepath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return true;
    }
    const ext = filename.split('.').pop()?.toLowerCase();
    writeFileCached(
      req,
      res,
      uploadedMediaMimeTypes[ext] || 'application/octet-stream',
      await readFile(filepath),
      { cacheControl: 'public, max-age=31536000, immutable' },
    );
    return true;
  }

  if (pathname === '/api/push/vapid-public-key' && req.method === 'GET') {
    writeJsonCached(req, res, { publicKey: await getPublicKey() });
    return true;
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 4096);
    } catch {
      jsonError(writeJson, res, 400, 'Bad request');
      return true;
    }
    try {
      const sub = JSON.parse(body);
      if (!sub.endpoint) throw new Error('Missing endpoint');
      await addSubscription(sub);
      writeJson(res, 200, { ok: true });
    } catch {
      jsonError(writeJson, res, 400, 'Invalid subscription');
    }
    return true;
  }

  if (pathname === '/api/system/completion-sound' && req.method === 'POST') {
    const authSession = getAuthSessionImpl(req);
    if (authSession?.role !== 'owner') {
      jsonError(writeJson, res, 403, 'Owner access required');
      return true;
    }
    try {
      let body = '';
      try {
        body = await readBody(req, 4096);
      } catch {}
      const parsedBody = body ? JSON.parse(body) : {};
      const completionNoticeKey = typeof parsedBody?.completionNoticeKey === 'string'
        ? parsedBody.completionNoticeKey.trim()
        : '';
      const runId = typeof parsedBody?.runId === 'string'
        ? parsedBody.runId.trim()
        : '';
      const speechText = typeof parsedBody?.speechText === 'string'
        ? parsedBody.speechText
        : undefined;
      const completionVoiceProvider = typeof parsedBody?.completionTtsProvider === 'string'
        ? parsedBody.completionTtsProvider
        : undefined;
      const completionFallbackToSay = typeof parsedBody?.fallbackToSay === 'boolean'
        ? parsedBody.fallbackToSay
        : undefined;
      const voice = typeof parsedBody?.voice === 'string'
        ? parsedBody.voice
        : undefined;
      const rate = Number.isFinite(Number(parsedBody?.rate))
        ? Number(parsedBody.rate)
        : undefined;

      if (completionNoticeKey) {
        const queuedPath = await enqueueHostCompletionSpeech({
          speechText,
          voice,
          rate,
          completionNoticeKey,
          runId,
          completionTtsProvider: completionVoiceProvider,
          fallbackToSay: completionFallbackToSay,
        });
        writeJson(res, 200, {
          ok: true,
          mode: queuedPath ? 'host:queued' : 'host:deduped',
          soundPath: '',
          queue: !!queuedPath,
        });
        return;
      }

      const playback = await playHostCompletionSoundImpl({
        speechText,
        voice,
        rate,
        completionTtsProvider: completionVoiceProvider,
        fallbackToSay: completionFallbackToSay,
      });
      writeJson(res, 200, {
        ok: true,
        mode: playback?.provider ? `host:${playback.provider}` : 'host',
        soundPath: playback?.soundPath || '',
      });
    } catch (error) {
      jsonError(writeJson, res, 500, error?.message || 'Failed to play host completion sound');
    }
    return true;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const authSession = getAuthSessionImpl(req);
    if (!authSession) {
      jsonError(writeJson, res, 401, 'Not authenticated');
      return true;
    }
    const info = buildAuthInfo(authSession);
    const refreshedCookie = await refreshAuthSession(req);
    writeJsonCached(req, res, info, {
      headers: refreshedCookie ? { 'Set-Cookie': refreshedCookie } : undefined,
    });
    return true;
  }

  return false;
}
