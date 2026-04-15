import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

import { getAuthSession, refreshAuthSession } from '../../../lib/auth.mjs';
import { CHAT_IMAGES_DIR } from '../../../lib/config.mjs';
import { getAvailableToolsAsync } from '../../../lib/tools.mjs';

import { pathExists, statOrNull } from '../../fs-utils.mjs';
import { getModelsForTool } from '../../models.mjs';
import { getQueryValue } from '../../shared/http/query.mjs';
import { getPublicKey } from '../../push.mjs';
import { buildAuthInfo } from '../../views/system/auth.mjs';

const uploadedMediaMimeTypes = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  m4a: 'audio/mp4',
  m4v: 'video/x-m4v',
  md: 'text/markdown; charset=utf-8',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  zip: 'application/zip',
};

function jsonError(writeJson, res, statusCode, message) {
  writeJson(res, statusCode, { error: message });
}
async function isDirectoryPath(path) {
  return (await statOrNull(path))?.isDirectory() === true;
}

export async function handleSystemReadRoutes(ctx) {
  const {
    req,
    res,
    pathname,
    parsedUrl,
    writeJson,
    writeJsonCached,
    writeFileCached,
    getAuthSession: getAuthSessionImpl = getAuthSession,
    refreshAuthSession: refreshAuthSessionImpl = refreshAuthSession,
  } = ctx;
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

  if ((pathname.startsWith('/api/images/') || pathname.startsWith('/api/media/')) && req.method === 'GET') {
    const prefix = pathname.startsWith('/api/media/') ? '/api/media/' : '/api/images/';
    const filename = pathname.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return true;
    }
    const filepath = join(CHAT_IMAGES_DIR, filename);
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

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const authSession = getAuthSessionImpl(req);
    if (!authSession) {
      jsonError(writeJson, res, 401, 'Not authenticated');
      return true;
    }
    const info = buildAuthInfo(authSession);
    const refreshedCookie = await refreshAuthSessionImpl(req);
    writeJsonCached(req, res, info, {
      headers: refreshedCookie ? { 'Set-Cookie': refreshedCookie } : undefined,
    });
    return true;
  }

  return false;
}
