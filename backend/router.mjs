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
import { saveUiRuntimeSelection } from '../lib/runtime-selection.mjs';
import {
  deleteSessionPermanently,
  getHistory,
  getSession,
  getSessionEventsAfter,
  getSessionSourceContext,
  getSessionTimelineEvents,
  listSessions,
  renameSession,
  promoteSessionToPersistent,
  runSessionPersistent,
  setSessionArchived,
  setSessionPinned,
  updateSessionLastReviewedAt,
  updateSessionGrouping,
  updateSessionAgreements,
  updateSessionPersistent,
  updateSessionWorkflowClassification,
  updateSessionRuntimePreferences,
} from './session-manager.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from './session-workflow-state.mjs';
import { appendEvent, readEventBody } from './history.mjs';
import { messageEvent } from './normalizer.mjs';
import { createSessionDetail, createSessionListItem } from './session-api-shapes.mjs';
import { buildEventBlockEvents, buildSessionDisplayEvents } from './session-display-events.mjs';
import { parseSessionGetRoute } from './session-route-utils.mjs';
import { escapeHtml, readBody } from '../lib/utils.mjs';
import {
  getClientIp, isRateLimited, recordFailedAttempt, clearFailedAttempts,
  setSecurityHeaders, generateNonce, requireAuth,
} from './middleware.mjs';
import { pathExists, statOrNull } from './fs-utils.mjs';
import { broadcastAll } from './ws-clients.mjs';
import { handlePublicRoutes } from './router-public-routes.mjs';
import { handleAssetRoutes } from './routes/assets.mjs';
import { handleAuthRoutes } from './routes/auth.mjs';
import { handleRunRoutes } from './routes/runs.mjs';
import { handleSessionReadRoutes } from './routes/session-read.mjs';
import { handleSessionWriteRoutes } from './routes/session-write.mjs';
import { handleWorkbenchRoutes } from './routes/workbench.mjs';
import { handleHooksRoutes } from './routes/hooks.mjs';
import { handleSettingsRoutes } from './routes/settings.mjs';
import { handleSystemRoutes } from './router-system-routes.mjs';
import { createWorkbenchNodeDefinitionsPayload } from './workbench/node-definitions.mjs';
import {
  buildFileAssetDirectUrl,
  createFileAssetUploadIntent,
  finalizeFileAssetUpload,
  getFileAsset,
  getFileAssetBootstrapConfig,
  getFileAssetForClient,
} from './file-assets.mjs';

// Paths are resolved from the active runtime root on each request.
const __dirname = dirname(fileURLToPath(import.meta.url));
const chatTemplatePath = join(__dirname, '..', 'templates', 'chat.html');
const loginTemplatePath = join(__dirname, '..', 'templates', 'login.html');
const frontendDir = join(__dirname, '..', 'frontend');
const frontendLoaderPath = join(__dirname, '..', 'frontend.js');
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
const CHAT_SHARED_BOOTSTRAP_CACHE_TTL_MS = 1000;
const frontendContentCache = new Map();
let cachedChatPageSharedBootstrap = null;

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

async function listSessionsForClient(options = {}) {
  const sessions = await listSessions(options);
  return sessions.map(createClientSessionDetail);
}

async function listSessionListItemsForClient(options = {}) {
  const sessions = await listSessions(options);
  return sessions.map(createSessionListItem);
}

async function getSessionForClient(id, options = {}) {
  return createClientSessionDetail(await getSession(id, options));
}

async function getSessionListItemForClient(id, options = {}) {
  return createSessionListItem(await getSession(id, options));
}

function createClientSessionDetail(session) {
  return createSessionDetail(session);
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

function buildAuthInfo(authSession) {
  if (!authSession) return null;
  const info = { role: 'owner' };
  if (typeof authSession.preferredLanguage === 'string' && authSession.preferredLanguage.trim()) {
    info.preferredLanguage = authSession.preferredLanguage.trim();
  }
  return info;
}

function buildChatPageBootstrap(authSession) {
  const now = Date.now();
  if (
    !cachedChatPageSharedBootstrap
    || now - cachedChatPageSharedBootstrap.cachedAt >= CHAT_SHARED_BOOTSTRAP_CACHE_TTL_MS
  ) {
    cachedChatPageSharedBootstrap = {
      cachedAt: now,
      payload: {
        assetUploads: getFileAssetBootstrapConfig(),
        workbench: createWorkbenchNodeDefinitionsPayload(),
      },
    };
  }

  return {
    auth: buildAuthInfo(authSession),
    ...cachedChatPageSharedBootstrap.payload,
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

async function normalizeSessionFolderInput(folder) {
  const trimmed = typeof folder === 'string' && folder.trim() ? folder.trim() : '~';
  const resolvedFolder = trimmed.startsWith('~')
    ? join(homedir(), trimmed.slice(1))
    : resolve(trimmed);
  if (!await isDirectoryPath(resolvedFolder)) return null;
  return trimmed.startsWith('~') ? trimmed : resolvedFolder;
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
  cachedChatPageSharedBootstrap = null;
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

function createSessionSummaryPayload(session) {
  return { session: createSessionListItem(session) };
}

function createSessionSummaryEtag(session) {
  return createEtag(createJsonBody(createSessionSummaryPayload(session)));
}

function createSessionSummaryRef(session) {
  const projected = createSessionListItem(session);
  return {
    id: projected?.id,
    summaryEtag: createSessionSummaryEtag(projected),
  };
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

function isOwnerOnlyRoute(pathname, method) {
  if (pathname === '/api/workbench' && method === 'GET') return true;
  if (pathname.startsWith('/api/workbench/')) return true;
  if (pathname === '/api/sessions' && (method === 'GET' || method === 'POST')) return true;
  if (pathname === '/api/triggers' && (method === 'GET' || method === 'POST')) return true;
  if (pathname.startsWith('/api/triggers/') && ['GET', 'PATCH', 'DELETE'].includes(method)) return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/fork') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/delegate') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/organize') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && method === 'PATCH') return true;
  if (pathname === '/api/models' && method === 'GET') return true;
  if (pathname === '/api/tools' && (method === 'GET' || method === 'POST')) return true;
  if (pathname === '/api/autocomplete' && method === 'GET') return true;
  if (pathname === '/api/browse' && method === 'GET') return true;
  if (pathname === '/api/push/vapid-public-key' && method === 'GET') return true;
  if (pathname === '/api/push/subscribe' && method === 'POST') return true;
  if (pathname === '/api/system/completion-sound' && method === 'POST') return true;
  return false;
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
    listSessionListItemsForClient,
    createSessionSummaryRef,
    writeJsonCached,
    writeJson: writeJsonForReq,
    getSessionListItemForClient,
    getSessionForClient,
    getSessionEventsAfter,
    getSessionTimelineEvents,
    buildSessionDisplayEvents,
    getSessionSourceContext,
    buildEventBlockEvents,
    readEventBody,
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

  if (pathname.startsWith('/api/sessions/') && req.method === 'PATCH') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
      writeJsonForReq(res, 400, { error: 'Invalid session path' });
      return;
    }
    if (!requireSessionAccessForReq(res, authSession, sessionId)) return;
    let body;
    try { body = await readBody(req, 10240); } catch {
      writeJsonForReq(res, 400, { error: 'Bad request' });
      return;
    }
    let patch;
    try { patch = JSON.parse(body); } catch {
      writeJsonForReq(res, 400, { error: 'Invalid request body' });
      return;
    }
    const hasArchivedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'archived');
    const hasPinnedPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'pinned');
    const hasToolPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tool');
    const hasModelPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'model');
    const hasEffortPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'effort');
    const hasThinkingPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'thinking');
    const hasGroupPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'group');
    const hasDescriptionPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'description');
    const hasSidebarOrderPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'sidebarOrder');
    const hasActiveAgreementsPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'activeAgreements');
    const hasPersistentPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'persistent');
    const hasWorkflowStatePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowState');
    const hasWorkflowPriorityPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'workflowPriority');
    const hasLastReviewedAtPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'lastReviewedAt');
    if (hasArchivedPatch && typeof patch.archived !== 'boolean') {
      writeJsonForReq(res, 400, { error: 'archived must be a boolean' });
      return;
    }
    if (hasPinnedPatch && typeof patch.pinned !== 'boolean') {
      writeJsonForReq(res, 400, { error: 'pinned must be a boolean' });
      return;
    }
    if (hasToolPatch && typeof patch.tool !== 'string') {
      writeJsonForReq(res, 400, { error: 'tool must be a string' });
      return;
    }
    if (hasModelPatch && typeof patch.model !== 'string') {
      writeJsonForReq(res, 400, { error: 'model must be a string' });
      return;
    }
    if (hasEffortPatch && typeof patch.effort !== 'string') {
      writeJsonForReq(res, 400, { error: 'effort must be a string' });
      return;
    }
    if (hasThinkingPatch && typeof patch.thinking !== 'boolean') {
      writeJsonForReq(res, 400, { error: 'thinking must be a boolean' });
      return;
    }
    if (hasGroupPatch && patch.group !== null && typeof patch.group !== 'string') {
      writeJsonForReq(res, 400, { error: 'group must be a string or null' });
      return;
    }
    if (hasDescriptionPatch && patch.description !== null && typeof patch.description !== 'string') {
      writeJsonForReq(res, 400, { error: 'description must be a string or null' });
      return;
    }
    if (hasSidebarOrderPatch && patch.sidebarOrder !== null && (!Number.isInteger(patch.sidebarOrder) || patch.sidebarOrder < 1)) {
      writeJsonForReq(res, 400, { error: 'sidebarOrder must be a positive integer or null' });
      return;
    }
    if (hasActiveAgreementsPatch && patch.activeAgreements !== null && !Array.isArray(patch.activeAgreements)) {
      writeJsonForReq(res, 400, { error: 'activeAgreements must be an array of strings or null' });
      return;
    }
    if (hasActiveAgreementsPatch && Array.isArray(patch.activeAgreements)) {
      const invalidAgreement = patch.activeAgreements.find((entry) => typeof entry !== 'string');
      if (invalidAgreement !== undefined) {
        writeJsonForReq(res, 400, { error: 'activeAgreements must contain only strings' });
        return;
      }
    }
    if (hasPersistentPatch && patch.persistent !== null && (typeof patch.persistent !== 'object' || Array.isArray(patch.persistent))) {
      writeJsonForReq(res, 400, { error: 'persistent must be an object or null' });
      return;
    }
    if (hasWorkflowStatePatch && patch.workflowState !== null && typeof patch.workflowState !== 'string') {
      writeJsonForReq(res, 400, { error: 'workflowState must be a string or null' });
      return;
    }
    if (hasWorkflowPriorityPatch && patch.workflowPriority !== null && typeof patch.workflowPriority !== 'string') {
      writeJsonForReq(res, 400, { error: 'workflowPriority must be a string or null' });
      return;
    }
    if (hasLastReviewedAtPatch && patch.lastReviewedAt !== null && typeof patch.lastReviewedAt !== 'string') {
      writeJsonForReq(res, 400, { error: 'lastReviewedAt must be a string or null' });
      return;
    }
    if (
      hasWorkflowStatePatch
      && patch.workflowState !== null
      && String(patch.workflowState).trim()
      && !normalizeSessionWorkflowState(String(patch.workflowState))
    ) {
      writeJsonForReq(res, 400, { error: 'workflowState must be parked, waiting_user, or done' });
      return;
    }
    if (
      hasWorkflowPriorityPatch
      && patch.workflowPriority !== null
      && String(patch.workflowPriority).trim()
      && !normalizeSessionWorkflowPriority(String(patch.workflowPriority))
    ) {
      writeJsonForReq(res, 400, { error: 'workflowPriority must be high, medium, or low' });
      return;
    }
    if (
      hasLastReviewedAtPatch
      && patch.lastReviewedAt !== null
      && String(patch.lastReviewedAt).trim()
      && !Number.isFinite(Date.parse(String(patch.lastReviewedAt).trim()))
    ) {
      writeJsonForReq(res, 400, { error: 'lastReviewedAt must be a valid timestamp or null' });
      return;
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
    if (hasGroupPatch || hasDescriptionPatch || hasSidebarOrderPatch) {
      session = await updateSessionGrouping(sessionId, {
        ...(hasGroupPatch ? { group: patch.group ?? '' } : {}),
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
      writeJsonForReq(res, 404, { error: 'Session not found' });
      return;
    }
    writeJsonForReq(res, 200, { session: createClientSessionDetail(session) });
    return;
  }

  if (pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
      writeJsonForReq(res, 400, { error: 'Invalid session path' });
      return;
    }
    if (!requireSessionAccessForReq(res, authSession, sessionId)) return;
    try {
      const outcome = await deleteSessionPermanently(sessionId);
      writeJsonForReq(res, 200, { deletedSessionIds: outcome?.deletedSessionIds || [] });
    } catch (error) {
      writeJsonForReq(res, error?.statusCode || 409, {
        error: error?.message || 'Failed to delete session',
      });
    }
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

  if (pathname === '/api/runtime-selection' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 4096); } catch (err) {
      writeJsonForReq(res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: err.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      writeJsonForReq(res, 400, { error: 'Invalid request body' });
      return;
    }
    try {
      const selection = await saveUiRuntimeSelection(payload || {});
      writeJsonForReq(res, 200, { selection });
    } catch (error) {
      writeJsonForReq(res, 400, { error: error.message || 'Failed to save runtime selection' });
    }
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
    buildAuthInfo,
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

  // Main page (chat UI) — read from disk each time for hot-reload
  if (pathname === '/') {
    try {
      const authSession = getAuthSession(req);
      const pageBootstrap = buildChatPageBootstrap(authSession);
      const [pageBuildInfo, chatPage, refreshedCookie] = await Promise.all([
        getPageBuildInfo(),
        readFrontendFileCached(chatTemplatePath, 'utf8'),
        refreshAuthSession(req),
      ]);
      const pageResponse = prepareResponseBody(req, {
        contentType: 'text/html; charset=utf-8',
        body: renderPageTemplate(chatPage, nonce, {
          ...buildTemplateReplacements(pageBuildInfo),
          BOOTSTRAP_JSON: serializeJsonForScript(pageBootstrap),
        }),
        allowCompression: true,
      });
      res.writeHead(200, buildHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...(pageResponse.vary ? { Vary: pageResponse.vary } : {}),
        ...pageResponse.headers,
        ...(refreshedCookie ? { 'Set-Cookie': refreshedCookie } : {}),
      }));
      res.end(pageResponse.body);
    } catch {
      res.writeHead(500, buildHeaders({ 'Content-Type': 'text/plain' }));
      res.end('Failed to load chat page');
    }
    return;
  }

  res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
  res.end('Not Found');
}
