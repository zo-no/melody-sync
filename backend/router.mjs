import { join, dirname } from 'path';
import { parse as parseUrl, fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'zlib';
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

const compressibleContentTypes = [
  'application/javascript',
  'application/json',
  'application/manifest+json',
  'application/xml',
  'image/svg+xml',
];
const MIN_COMPRESSIBLE_RESPONSE_BYTES = 1024;
const MAX_COMPRESSED_RESPONSE_CACHE_ENTRIES = 256;
const compressedResponseCache = new Map();
const brotliCompressionOptions = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
  },
};
const gzipCompressionOptions = { level: 6 };
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

function buildHeaders(headers = {}) {
  return {
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
    ...headers,
  };
}

function normalizeContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function isCompressibleContentType(contentType) {
  const normalized = normalizeContentType(contentType);
  return normalized.startsWith('text/') || compressibleContentTypes.includes(normalized);
}

function appendVaryValue(currentValue, nextToken) {
  const currentTokens = String(currentValue || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (currentTokens.some((token) => token.toLowerCase() === nextToken.toLowerCase())) {
    return currentTokens.join(', ');
  }
  currentTokens.push(nextToken);
  return currentTokens.join(', ');
}

function parseAcceptEncodingHeader(value) {
  const weights = new Map();
  for (const part of String(value || '').split(',')) {
    const [namePart, ...parameterParts] = part.split(';');
    const name = namePart.trim().toLowerCase();
    if (!name) continue;
    let weight = 1;
    for (const parameter of parameterParts) {
      const [key, rawValue] = parameter.split('=');
      if (key?.trim().toLowerCase() !== 'q') continue;
      const parsedValue = Number.parseFloat(String(rawValue || '').trim());
      if (Number.isFinite(parsedValue)) {
        weight = Math.max(0, Math.min(1, parsedValue));
      }
    }
    weights.set(name, weight);
  }
  return weights;
}

function getAcceptedEncodingWeight(weights, name) {
  if (weights.has(name)) return weights.get(name) || 0;
  if (weights.has('*')) return weights.get('*') || 0;
  return 0;
}

function selectCompressionEncoding(req, contentType, body) {
  if (!isCompressibleContentType(contentType)) return null;
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  if (bodyBuffer.length < MIN_COMPRESSIBLE_RESPONSE_BYTES) return null;
  const acceptedEncodings = parseAcceptEncodingHeader(req.headers['accept-encoding']);
  const brotliWeight = getAcceptedEncodingWeight(acceptedEncodings, 'br');
  const gzipWeight = getAcceptedEncodingWeight(acceptedEncodings, 'gzip');
  if (brotliWeight <= 0 && gzipWeight <= 0) return null;
  return brotliWeight >= gzipWeight ? 'br' : 'gzip';
}

function getCompressedResponseBody(body, encoding) {
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const cacheKey = `${encoding}:${createEtag(bodyBuffer)}`;
  const cached = compressedResponseCache.get(cacheKey);
  if (cached) {
    compressedResponseCache.delete(cacheKey);
    compressedResponseCache.set(cacheKey, cached);
    return cached;
  }

  const compressedBody = encoding === 'br'
    ? brotliCompressSync(bodyBuffer, brotliCompressionOptions)
    : gzipSync(bodyBuffer, gzipCompressionOptions);
  compressedResponseCache.set(cacheKey, compressedBody);
  while (compressedResponseCache.size > MAX_COMPRESSED_RESPONSE_CACHE_ENTRIES) {
    const oldestKey = compressedResponseCache.keys().next().value;
    if (!oldestKey) break;
    compressedResponseCache.delete(oldestKey);
  }
  return compressedBody;
}

function prepareResponseBody(req, {
  contentType,
  body,
  vary,
  allowCompression = false,
} = {}) {
  const responseBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  let responseVary = vary;
  if (!allowCompression || !isCompressibleContentType(contentType)) {
    return {
      body: responseBody,
      headers: {},
      vary: responseVary,
    };
  }

  responseVary = appendVaryValue(responseVary, 'Accept-Encoding');
  const encoding = selectCompressionEncoding(req, contentType, responseBody);
  if (!encoding) {
    return {
      body: responseBody,
      headers: {},
      vary: responseVary,
    };
  }

  return {
    body: getCompressedResponseBody(responseBody, encoding),
    headers: { 'Content-Encoding': encoding },
    vary: responseVary,
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, buildHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(payload));
}

function createWriteJsonWriter(req) {
  return function writeJsonForReq(
    res,
    statusCode,
    payload,
    {
      cacheControl = 'private, no-store, max-age=0, must-revalidate',
      vary = 'Cookie',
      headers = {},
    } = {},
  ) {
    writeCachedResponse(req, res, {
      statusCode,
      contentType: 'application/json',
      body: createJsonBody(payload),
      cacheControl,
      vary,
      allowCompression: true,
      headers,
    });
  };
}

function createJsonBody(value) {
  return JSON.stringify(value);
}

function createEtag(value) {
  return `"${createHash('sha1').update(value).digest('hex')}"`;
}

function normalizeEtag(value) {
  return String(value || '').trim().replace(/^W\//, '');
}

function requestHasFreshEtag(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  const candidates = String(header)
    .split(',')
    .map((value) => normalizeEtag(value))
    .filter(Boolean);
  if (candidates.includes('*')) return true;
  return candidates.includes(normalizeEtag(etag));
}

function writeCachedResponse(req, res, {
  statusCode = 200,
  contentType,
  body,
  cacheControl,
  vary,
  allowCompression = false,
  headers: extraHeaders = {},
} = {}) {
  const preparedResponse = prepareResponseBody(req, {
    contentType,
    body,
    vary,
    allowCompression,
  });
  const etag = createEtag(preparedResponse.body);
  const headers = {
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
    ...preparedResponse.headers,
    ...extraHeaders,
  };
  if (preparedResponse.vary) headers.Vary = preparedResponse.vary;

  if (requestHasFreshEtag(req, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (contentType) headers['Content-Type'] = contentType;
  res.writeHead(statusCode, headers);
  res.end(preparedResponse.body);
}

function writeJsonCached(req, res, payload, {
  statusCode = 200,
  cacheControl = 'private, no-cache',
  vary = 'Cookie',
  headers,
} = {}) {
  writeCachedResponse(req, res, {
    statusCode,
    contentType: 'application/json',
    body: createJsonBody(payload),
    cacheControl,
    vary,
    allowCompression: true,
    headers,
  });
}

function writeFileCached(req, res, contentType, body, {
  cacheControl = 'public, no-cache',
  vary,
  allowCompression = true,
} = {}) {
  writeCachedResponse(req, res, {
    statusCode: 200,
    contentType,
    body,
    cacheControl,
    vary,
    allowCompression,
  });
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
