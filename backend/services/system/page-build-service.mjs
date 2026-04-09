import { readFile, readdir } from 'fs/promises';
import { readFileSync, readdirSync, statSync, watch } from 'fs';
import { join, resolve, dirname, basename, extname, relative, isAbsolute, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

import { statOrNull } from '../../fs-utils.mjs';
import { broadcastAll } from '../../ws-clients.mjs';
import { resetChatPageBootstrapCache } from './chat-bootstrap-service.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dirname, '..', '..', '..');

export const chatTemplatePath = join(repositoryRoot, 'templates', 'chat.html');
export const loginTemplatePath = join(repositoryRoot, 'templates', 'login.html');

const frontendDir = join(repositoryRoot, 'frontend-src');
const frontendLoaderPath = join(frontendDir, 'frontend.js');
const publicDir = join(repositoryRoot, 'public');
const packageJsonPath = join(repositoryRoot, 'package.json');
const releaseMetadataPath = join(repositoryRoot, '.melody-sync-release.json');
const gitRepositoryMarkerPath = join(repositoryRoot, '.git');

const GIT_BUILD_INFO_TIMEOUT_MS = 120;
const FRONTEND_CONTENT_CACHE_TTL_MS = 250;

const serviceBuildRoots = [
  join(repositoryRoot, 'backend'),
  join(repositoryRoot, 'lib'),
  join(repositoryRoot, 'chat-server.mjs'),
  packageJsonPath,
];

const serviceBuildStatusPaths = ['backend', 'lib', 'chat-server.mjs', 'package.json'];

const pageBuildRoots = [
  join(repositoryRoot, 'templates'),
  frontendDir,
  frontendLoaderPath,
  publicDir,
];

const staticMimeTypesByExtension = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
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

let cachedPageBuildInfo = null;
const frontendBuildWatchers = [];
let frontendBuildInvalidationTimer = null;
const frontendContentCache = new Map();

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
      cwd: repositoryRoot,
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

function sanitizeAssetVersion(value) {
  return String(value || 'dev').replace(/[^a-zA-Z0-9._-]+/g, '-');
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

function getSingleQueryValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function hasVersionedAssetTag(query = {}) {
  return getSingleQueryValue(query?.v).trim().length > 0;
}

export const SERVICE_BUILD_INFO = loadBuildInfo();

export async function readFrontendFileCached(filepath, encoding = null) {
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

export async function getPageBuildInfo() {
  const now = Date.now();
  if (
    cachedPageBuildInfo
    && (frontendBuildWatchers.length > 0 || now - cachedPageBuildInfo.cachedAt < FRONTEND_CONTENT_CACHE_TTL_MS)
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
    SERVICE_BUILD_INFO.serviceAssetVersion || SERVICE_BUILD_INFO.assetVersion || 'service',
    frontendFingerprint,
  ].filter(Boolean).join('-'));
  const info = {
    ...SERVICE_BUILD_INFO,
    assetVersion,
    frontendFingerprint,
    frontendLabel,
    frontendTitle,
    label: `${SERVICE_BUILD_INFO.serviceLabel} · ${frontendLabel}`,
    title: `${SERVICE_BUILD_INFO.serviceTitle} · ${frontendTitle}`,
  };

  cachedPageBuildInfo = {
    cachedAt: now,
    info,
  };
  return info;
}

export async function resolveStaticAsset(pathname, query = {}) {
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

startFrontendBuildWatchers();
