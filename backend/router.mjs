import { readFile, readdir } from 'fs/promises';
import { readFileSync, readdirSync, statSync, watch } from 'fs';
import { homedir } from 'os';
import { join, resolve, dirname, basename, extname, relative, isAbsolute, sep } from 'path';
import { parse as parseUrl, fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execFileSync, spawn } from 'child_process';
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
import { broadcastAll } from './ws-clients.mjs';
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
import { buildChatPageBootstrap, resetChatPageBootstrapCache } from './services/system/chat-bootstrap-service.mjs';
import {
  buildFileAssetDirectUrl,
  createFileAssetUploadIntent,
  finalizeFileAssetUpload,
  getFileAsset,
  getFileAssetForClient,
} from './file-assets.mjs';

// Paths are resolved from the active runtime root on each request.
const __dirname = dirname(fileURLToPath(import.meta.url));
const chatTemplatePath = join(__dirname, '..', 'templates', 'chat.html');
const loginTemplatePath = join(__dirname, '..', 'templates', 'login.html');
const frontendDir = join(__dirname, '..', 'frontend-src');
const frontendLoaderPath = join(frontendDir, 'frontend.js');
const publicDir = join(__dirname, '..', 'public');
const packageJsonPath = join(__dirname, '..', 'package.json');
const releaseMetadataPath = join(__dirname, '..', '.melody-sync-release.json');
const gitRepositoryMarkerPath = join(__dirname, '..', '.git');
const GIT_BUILD_INFO_TIMEOUT_MS = 120;
const serviceBuildRoots = [
  join(__dirname, '..', 'backend'),
  join(__dirname, '..', 'lib'),
  join(__dirname, '..', 'chat-server.mjs'),
  packageJsonPath,
];

const serviceBuildStatusPaths = ['backend', 'lib', 'chat-server.mjs', 'package.json'];

const BUILD_INFO = loadBuildInfo();
const pageBuildRoots = [
  join(__dirname, '..', 'templates'),
  frontendDir,
  frontendLoaderPath,
  publicDir,
];
let cachedPageBuildInfo = null;
const frontendBuildWatchers = [];
let frontendBuildInvalidationTimer = null;
let configReloadScheduled = false;
const FRONTEND_CONTENT_CACHE_TTL_MS = 250;
const frontendContentCache = new Map();

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

const staticMimeTypesByExtension = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const frontendDirResolved = resolve(frontendDir);
const frontendLoaderPathResolved = resolve(frontendLoaderPath);
const publicDirResolved = resolve(publicDir);
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

function getLatestMtimeMsSync(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return 0;
  }

  const ownMtime = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
  if (!stat.isDirectory()) return ownMtime;

  let entries = [];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return ownMtime;
  }

  return entries.reduce((latestMtime, entry) => {
    if (entry.name.startsWith('.')) return latestMtime;
    return Math.max(latestMtime, getLatestMtimeMsSync(join(path, entry.name)));
  }, ownMtime);
}

function formatMtimeFingerprint(mtimeMs, fallbackSeed = Date.now()) {
  const numericValue = Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : fallbackSeed;
  return Math.round(numericValue).toString(36);
}

function hasGitRepository() {
  try {
    return !!statSync(gitRepositoryMarkerPath);
  } catch {
    return false;
  }
}

function execGitBuildInfo(args = []) {
  if (!hasGitRepository()) return '';
  try {
    return execFileSync('git', args, {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_BUILD_INFO_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

function hasDirtyRepoPaths(paths) {
  return execGitBuildInfo(['status', '--porcelain', '--untracked-files=no', '--', ...paths]).length > 0;
}

function normalizeReleaseText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readReleaseMetadata() {
  try {
    const payload = JSON.parse(readFileSync(releaseMetadataPath, 'utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function loadBuildInfo() {
  const releaseMetadata = readReleaseMetadata();
  let version = 'dev';
  const releasedVersion = normalizeReleaseText(releaseMetadata?.sourceVersion);
  if (releasedVersion) {
    version = releasedVersion;
  } else {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (pkg?.version) version = String(pkg.version);
    } catch {}
  }

  let commit = normalizeReleaseText(releaseMetadata?.sourceCommit);
  if (!commit) {
    commit = execGitBuildInfo(['rev-parse', '--short', 'HEAD']);
  }

  const releaseId = normalizeReleaseText(releaseMetadata?.releaseId);
  const runtimeMode = releaseId ? 'release' : 'source';
  const releasedDirty = typeof releaseMetadata?.sourceDirty === 'boolean'
    ? releaseMetadata.sourceDirty
    : null;
  const serviceDirty = releasedDirty === null ? hasDirtyRepoPaths(serviceBuildStatusPaths) : releasedDirty;
  const releasedFingerprint = normalizeReleaseText(releaseMetadata?.sourceFingerprint);
  const computedFingerprint = (!releasedFingerprint && serviceDirty)
    ? formatMtimeFingerprint(serviceBuildRoots.reduce(
      (latestMtime, root) => Math.max(latestMtime, getLatestMtimeMsSync(root)),
      0,
    ))
    : '';
  const serviceFingerprint = releasedFingerprint || computedFingerprint;
  const serviceRevisionBase = commit || '';
  const serviceRevisionLabel = serviceRevisionBase
    ? (serviceDirty ? `${serviceRevisionBase}*` : serviceRevisionBase)
    : (serviceDirty ? 'working*' : '');
  const serviceLabelParts = [`Ver ${version}`];
  if (serviceRevisionLabel) serviceLabelParts.push(serviceRevisionLabel);
  const serviceLabel = serviceLabelParts.join(' · ');
  const serviceAssetVersion = sanitizeAssetVersion([
    version,
    commit || releaseId || 'working',
    serviceDirty && serviceFingerprint ? `dirty-${serviceFingerprint}` : 'clean',
    releaseId ? `rel-${releaseId}` : '',
  ].filter(Boolean).join('-'));
  const serviceTitleParts = [`Service v${version}`];
  if (serviceRevisionLabel) serviceTitleParts.push(serviceRevisionLabel);
  if (serviceFingerprint) serviceTitleParts.push(`srv:${serviceFingerprint}`);
  const serviceTitle = serviceTitleParts.join(' · ');
  return {
    version,
    commit,
    assetVersion: serviceAssetVersion,
    label: serviceLabel,
    title: serviceTitle,
    serviceVersion: version,
    serviceCommit: commit,
    serviceDirty,
    serviceFingerprint,
    serviceAssetVersion,
    serviceLabel,
    serviceTitle,
    runtimeMode,
    releaseId: releaseId || null,
    releaseCreatedAt: normalizeReleaseText(releaseMetadata?.createdAt) || null,
  };
}

function renderPageTemplate(template, nonce, replacements = {}) {
  const merged = {
    NONCE: nonce,
    ASSET_VERSION: BUILD_INFO.assetVersion,
    BUILD_LABEL: BUILD_INFO.label,
    BUILD_TITLE: BUILD_INFO.title,
    BUILD_JSON: serializeJsonForScript(BUILD_INFO),
    PAGE_TITLE: 'MelodySync Chat',
    PAGE_HEAD_TAGS: '',
    BODY_CLASS: '',
    BOOTSTRAP_JSON: serializeJsonForScript({ auth: null }),
    EXTRA_BOOTSTRAP_SCRIPTS: '',
    ...replacements,
  };
  if (!Object.prototype.hasOwnProperty.call(replacements, 'BOOTSTRAP_SCRIPT_TAGS')) {
    merged.BOOTSTRAP_SCRIPT_TAGS = [
      `<script nonce="${merged.NONCE}">window.__MELODYSYNC_BUILD__ = ${merged.BUILD_JSON};</script>`,
      `<script nonce="${merged.NONCE}">window.__MELODYSYNC_BOOTSTRAP__ = ${merged.BOOTSTRAP_JSON};</script>`,
    ].join('\n');
  }
  return Object.entries(merged).reduce(
    (output, [key, value]) => output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => String(value ?? '')),
    template,
  );
}

function buildTemplateReplacements(buildInfo) {
  return {
    ASSET_VERSION: buildInfo.assetVersion,
    BUILD_LABEL: buildInfo.label,
    BUILD_TITLE: buildInfo.title,
    BUILD_JSON: serializeJsonForScript(buildInfo),
  };
}

async function readFrontendFileCached(filepath, encoding = null) {
  const cacheKey = `${encoding || 'buffer'}:${filepath}`;
  const cached = frontendContentCache.get(cacheKey);
  const now = Date.now();
  if (
    cached
    && (frontendBuildWatchers.length > 0 || now - cached.cachedAt < FRONTEND_CONTENT_CACHE_TTL_MS)
  ) {
    return cached.content;
  }

  const content = encoding ? await readFile(filepath, encoding) : await readFile(filepath);
  frontendContentCache.set(cacheKey, { cachedAt: now, content });
  return content;
}

async function getLatestMtimeMs(path) {
  const stat = await statOrNull(path);
  if (!stat) return 0;

  const ownMtime = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
  if (!stat.isDirectory()) return ownMtime;

  let entries = [];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return ownMtime;
  }

  const nestedTimes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => getLatestMtimeMs(join(path, entry.name))),
  );

  return Math.max(ownMtime, ...nestedTimes, 0);
}

function sanitizeAssetVersion(value) {
  return String(value || 'dev').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export async function getPageBuildInfo() {
  const now = Date.now();
  if (
    cachedPageBuildInfo
    && (frontendBuildWatchers.length > 0 || now - cachedPageBuildInfo.cachedAt < 250)
  ) {
    return cachedPageBuildInfo.info;
  }

  let latestMtimeMs = 0;
  for (const root of pageBuildRoots) {
    latestMtimeMs = Math.max(latestMtimeMs, await getLatestMtimeMs(root));
  }

  const frontendFingerprint = latestMtimeMs > 0
    ? Math.round(latestMtimeMs).toString(36)
    : now.toString(36);
  const frontendLabel = `ui:${frontendFingerprint}`;
  const frontendTitle = `Frontend ${frontendLabel}`;
  const assetVersion = sanitizeAssetVersion([
    BUILD_INFO.serviceAssetVersion || BUILD_INFO.assetVersion || 'service',
    frontendFingerprint,
  ].filter(Boolean).join('-'));
  const info = {
    ...BUILD_INFO,
    assetVersion,
    frontendFingerprint,
    frontendLabel,
    frontendTitle,
    label: `${BUILD_INFO.serviceLabel} · ${frontendLabel}`,
    title: `${BUILD_INFO.serviceTitle} · ${frontendTitle}`,
  };

  cachedPageBuildInfo = {
    cachedAt: now,
    info,
  };
  return info;
}

function scheduleFrontendBuildInvalidation() {
  cachedPageBuildInfo = null;
  resetChatPageBootstrapCache();
  frontendContentCache.clear();
  if (frontendBuildInvalidationTimer) return;
  frontendBuildInvalidationTimer = setTimeout(async () => {
    frontendBuildInvalidationTimer = null;
    try {
      const buildInfo = await getPageBuildInfo();
      broadcastAll({ type: 'build_info', buildInfo });
    } catch (error) {
      console.error(`[build] frontend update broadcast failed: ${error.message}`);
    }
  }, 120);
  if (typeof frontendBuildInvalidationTimer.unref === 'function') {
    frontendBuildInvalidationTimer.unref();
  }
}

function startFrontendBuildWatchers() {
  if (frontendBuildWatchers.length > 0) return;
  for (const root of pageBuildRoots) {
    try {
      const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        const changedPath = String(filename || '');
        if (changedPath) {
          const segments = changedPath.split(/[\\/]+/).filter(Boolean);
          if (segments.some((segment) => segment.startsWith('.'))) {
            return;
          }
        }
        scheduleFrontendBuildInvalidation();
      });
      watcher.on('error', (error) => {
        console.error(`[build] frontend watcher error for ${root}: ${error.message}`);
      });
      frontendBuildWatchers.push(watcher);
    } catch (error) {
      console.warn(`[build] frontend watcher disabled for ${root}: ${error.message}`);
    }
  }
}

startFrontendBuildWatchers();

function getSingleQueryValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function hasVersionedAssetTag(query = {}) {
  return getSingleQueryValue(query?.v).trim().length > 0;
}

async function resolveStaticAsset(pathname, query = {}) {
  if (!pathname.startsWith('/')) return null;

  let rootDirResolved = publicDirResolved;
  let staticName = pathname.slice(1);
  if (pathname === '/chat.js' || pathname === '/frontend.js') {
    rootDirResolved = dirname(frontendLoaderPathResolved);
    staticName = basename(frontendLoaderPathResolved);
  } else if (pathname.startsWith('/chat/')) {
    rootDirResolved = frontendDirResolved;
    staticName = pathname.slice('/chat/'.length);
  } else if (pathname.startsWith('/frontend/')) {
    rootDirResolved = frontendDirResolved;
    staticName = pathname.slice('/frontend/'.length);
  }
  if (!staticName || staticName.endsWith('/')) return null;

  const segments = staticName.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment.startsWith('.'))) {
    return null;
  }

  const filepath = resolve(rootDirResolved, staticName);
  const relativePath = relative(rootDirResolved, filepath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }
  if (relativePath.split(sep).some((segment) => segment === '..' || segment.startsWith('.'))) {
    return null;
  }

  const stat = await statOrNull(filepath);
  if (!stat?.isFile()) return null;

  const filename = basename(filepath).toLowerCase();
  const extension = extname(filename);
  const contentType = filename === 'manifest.json'
    ? 'application/manifest+json'
    : staticMimeTypesByExtension[extension] || 'application/octet-stream';

  return {
    filepath,
    cacheControl: filename === 'sw.js'
      ? 'no-store, max-age=0, must-revalidate'
      : hasVersionedAssetTag(query)
        ? 'public, max-age=31536000, immutable'
        : 'public, no-cache, max-age=0, must-revalidate',
    contentType,
  };
}

function buildHeaders(headers = {}) {
  return {
    'X-MelodySync-Build': BUILD_INFO.title,
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
    'X-MelodySync-Build': BUILD_INFO.title,
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

function serializeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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
    loginTemplatePath,
    readFrontendFileCached,
    getPageBuildInfo,
    buildHeaders,
    prepareResponseBody,
    renderPageTemplate,
    buildTemplateReplacements,
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
    getPageBuildInfo,
    readFrontendFileCached,
    chatTemplatePath,
    renderPageTemplate,
    buildTemplateReplacements,
    serializeJsonForScript,
    prepareResponseBody,
    buildHeaders,
  })) {
    return;
  }

  res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
  res.end('Not Found');
}
