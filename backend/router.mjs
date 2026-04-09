import { join, dirname } from 'path';
import { parse as parseUrl, fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { CHAT_IMAGES_DIR } from '../lib/config.mjs';
import {
  getAuthSession, refreshAuthSession,
} from '../lib/auth.mjs';
import {
  getHistory,
} from './session/manager.mjs';
import { appendEvent } from './history.mjs';
import { messageEvent } from './normalizer.mjs';
import { parseSessionGetRoute } from './session/route-utils.mjs';
import { escapeHtml, readBody } from '../lib/utils.mjs';
import {
  getClientIp, isRateLimited, recordFailedAttempt, clearFailedAttempts,
  setSecurityHeaders, generateNonce, requireAuth,
} from './middleware.mjs';
import { pathExists, statOrNull } from './fs-utils.mjs';
import { handlePublicRoutes } from './routes/public.mjs';
import { handleAssetRoutes } from './routes/assets.mjs';
import { handleRunRoutes } from './routes/runs.mjs';
import { handleSessionReadRoutes } from './routes/session-read.mjs';
import { handleSessionWriteRoutes } from './routes/session-write.mjs';
import { handleWorkbenchRoutes } from './routes/workbench.mjs';
import { handleHooksRoutes } from './routes/hooks.mjs';
import { handleSettingsRoutes } from './routes/settings.mjs';
import { handleSystemRoutes } from './routes/system.mjs';
import { isOwnerOnlyRoute } from './contracts/system/owner-only-routes.mjs';
import { handleChatPageRequest } from './controllers/system/chat-page.mjs';
import { buildChatPageBootstrap } from './services/system/chat-bootstrap-service.mjs';
import {
  SERVICE_BUILD_INFO,
  readFrontendFileCached,
  resolveStaticAsset,
} from './services/system/page-build-service.mjs';
import { createResponseCacheHelpers } from './shared/http/response-cache.mjs';
import {
  buildFileAssetDirectUrl,
  createFileAssetUploadIntent,
  finalizeFileAssetUpload,
  getFileAsset,
  getFileAssetForClient,
} from './file-assets.mjs';

// Paths are resolved from the active runtime root on each request.
const __dirname = dirname(fileURLToPath(import.meta.url));
let configReloadScheduled = false;

function scheduleConfigReload() {
  if (configReloadScheduled) return true;
  configReloadScheduled = true;
  if (!process.env.XPC_SERVICE_NAME) {
    const restartEnv = {
      ...process.env,
      MELODYSYNC_RESTART_NODE: process.execPath,
      MELODYSYNC_RESTART_ENTRY: process.argv[1] || join(__dirname, '..', 'chat-server.mjs'),
    };
    const child = spawn('/bin/sh', ['-lc', 'sleep 0.4; exec "$MELODYSYNC_RESTART_NODE" "$MELODYSYNC_RESTART_ENTRY"'], {
      cwd: process.cwd(),
      env: restartEnv,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
  const timer = setTimeout(() => {
    process.kill(process.pid, 'SIGTERM');
  }, 150);
  timer.unref?.();
  return true;
}

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

const {
  prepareResponseBody,
  writeJson,
  createWriteJsonWriter,
  writeJsonCached,
  writeFileCached,
} = createResponseCacheHelpers({
  defaultHeaders: {
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
  },
});

function buildHeaders(headers = {}) {
  return {
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
    ...headers,
  };
}

const IMMUTABLE_PRIVATE_EVENT_CACHE_CONTROL = 'private, max-age=1296000, immutable';

function canAccessSession(authSession, sessionId) {
  return !!authSession && !!sessionId;
}

function requireSessionAccess(res, authSession, sessionId, writeJsonFn = writeJson) {
  if (canAccessSession(authSession, sessionId)) return true;
  writeJsonFn(res, 403, { error: 'Access denied' });
  return false;
}

async function isDirectoryPath(path) {
  return (await statOrNull(path))?.isDirectory() === true;
}

function parseFileAssetRoute(pathname) {
  const match = /^\/api\/assets\/(fasset_[a-f0-9]{24})(?:\/(download|finalize))?$/.exec(pathname || '');
  if (!match) return null;
  return {
    assetId: match[1],
    action: match[2] || null,
  };
}

export async function handleRequest(req, res) {
  const parsedUrl = parseUrl(req.url, true);
  const pathname = parsedUrl.pathname;
  const writeJsonForReq = createWriteJsonWriter(req);
  const requireSessionAccessForReq = (response, targetAuthSession, sessionId) => {
    return requireSessionAccess(response, targetAuthSession, sessionId, writeJsonForReq);
  };

  // Static assets (read from disk each time for hot-reload)
  const staticAsset = await resolveStaticAsset(pathname, parsedUrl.query);
  if (staticAsset) {
    try {
      const content = await readFrontendFileCached(staticAsset.filepath);
      writeFileCached(req, res, staticAsset.contentType, content, {
        cacheControl: staticAsset.cacheControl,
      });
    } catch {
      res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
      res.end('Not Found');
    }
    return;
  }

  const nonce = generateNonce();
  setSecurityHeaders(res, nonce);

  if (await handlePublicRoutes({
    req,
    res,
    parsedUrl,
    pathname,
    nonce,
    buildHeaders,
    prepareResponseBody,
    writeJsonCached,
  })) {
    return;
  }

  // Auth required from here on
  if (!requireAuth(req, res)) return;
  const authSession = getAuthSession(req);
  if (authSession?.role !== 'owner' && isOwnerOnlyRoute(pathname, req.method)) {
    writeJsonForReq(res, 403, { error: 'Owner access required' });
    return;
  }

  // ---- API endpoints ----

  const sessionGetRoute = req.method === 'GET' ? parseSessionGetRoute(pathname) : null;
  const fileAssetRoute = parseFileAssetRoute(pathname);

  if (await handleAssetRoutes({
    req,
    res,
    pathname,
    fileAssetRoute,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    createFileAssetUploadIntent,
    getFileAsset,
    getFileAssetForClient,
    finalizeFileAssetUpload,
    buildFileAssetDirectUrl,
    readBody,
    writeJson: writeJsonForReq,
    buildHeaders,
  })) {
    return;
  }

  if (await handleSessionReadRoutes({
    req,
    res,
    parsedUrl,
    sessionGetRoute,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJsonCached,
    writeJson: writeJsonForReq,
    immutablePrivateEventCacheControl: IMMUTABLE_PRIVATE_EVENT_CACHE_CONTROL,
  })) {
    return;
  }

  if (await handleWorkbenchRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJson: writeJsonForReq,
  })) {
    return;
  }

  if (await handleSettingsRoutes({
    req,
    res,
    pathname,
    writeJson: writeJsonForReq,
    scheduleConfigReload,
  })) {
    return;
  }

  if (await handleSessionWriteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJson: writeJsonForReq,
  })) {
    return;
  }

  if (await handleRunRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJsonCached,
    writeJson: writeJsonForReq,
  })) {
    return;
  }

  if (await handleHooksRoutes({ req, res, pathname, writeJson: writeJsonForReq })) {
    return;
  }

  // System routes: models, tools, autocomplete, browse, media, push, auth/me
  if (await handleSystemRoutes({
    req,
    res,
    pathname,
    parsedUrl,
    writeJson: writeJsonForReq,
    writeJsonCached,
    writeFileCached,
    isDirectoryPath,
    pathExists,
    chatImagesDir: CHAT_IMAGES_DIR,
    uploadedMediaMimeTypes,
  })) {
    return;
  }

  if (await handleChatPageRequest({
    req,
    res,
    pathname,
    nonce,
    getAuthSession,
    refreshAuthSession,
    buildChatPageBootstrap,
    prepareResponseBody,
    buildHeaders,
  })) {
    return;
  }

  res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
  res.end('Not Found');
}
