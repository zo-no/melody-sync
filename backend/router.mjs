import { parse as parseUrl } from 'url';
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
import { scheduleConfigReload } from './services/system/config-reload-service.mjs';
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

  if (await handleAssetRoutes({
    req,
    res,
    pathname,
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
