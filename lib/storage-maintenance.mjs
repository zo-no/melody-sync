import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, resolve } from 'path';
import { removePath, statOrNull } from '../backend/fs-utils.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled']);

export const DEFAULT_STORAGE_RETENTION_DAYS = Object.freeze({
  apiLogs: 7,
  runPayloads: 7,
  providerSessions: 7,
});

const CATEGORY_ORDER = Object.freeze([
  'run_payloads',
  'provider_sessions',
  'provider_shell_snapshots',
  'api_logs',
]);

const CATEGORY_LABELS = Object.freeze({
  api_logs: 'API logs',
  run_payloads: 'Run payloads',
  provider_sessions: 'Codex managed sessions',
  provider_shell_snapshots: 'Codex shell snapshots',
});

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveOptionalPath(value) {
  const trimmed = trimString(value);
  return trimmed ? resolve(trimmed) : '';
}

function normalizePositiveInteger(value, fallback, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

function normalizeNowMs(value) {
  if (value === null || value === undefined) return Date.now();
  const numeric = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return numeric;
}

function formatAgeDays(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.floor(ageMs / DAY_MS);
}

function safeIso(value) {
  if (!Number.isFinite(value)) return '';
  try {
    return new Date(value).toISOString();
  } catch {
    return '';
  }
}

export function formatBytes(bytes) {
  const numeric = Number.isFinite(bytes) ? bytes : 0;
  if (numeric < 1024) return `${numeric} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = numeric / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

async function readJsonFile(pathname, fallback = null) {
  try {
    return JSON.parse(await readFile(pathname, 'utf8'));
  } catch {
    return fallback;
  }
}

async function listDirectoryEntries(pathname) {
  try {
    return await readdir(pathname, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function measurePathBytes(pathname) {
  const stats = await statOrNull(pathname);
  if (!stats) return 0;
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  let total = 0;
  const entries = await listDirectoryEntries(pathname);
  for (const entry of entries) {
    total += await measurePathBytes(join(pathname, entry.name));
  }
  return total;
}

function relativePath(rootPath, pathname) {
  const root = resolveOptionalPath(rootPath);
  const target = resolveOptionalPath(pathname);
  if (!root || !target) return pathname;
  const rel = relative(root, target).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') ? rel : pathname;
}

function buildCandidate(base, {
  path,
  bytes,
  ageMs,
  kind,
  runId = '',
  anchorTimeMs = null,
  note = '',
}) {
  return {
    path,
    relativePath: relativePath(base, path),
    bytes,
    ageDays: formatAgeDays(ageMs),
    ageMs,
    kind,
    runId,
    anchorTime: safeIso(anchorTimeMs),
    note,
  };
}

function buildCategory(key, retentionDays, scopePath, items) {
  const normalizedItems = [...items].sort((left, right) => {
    return right.bytes - left.bytes
      || right.ageMs - left.ageMs
      || left.relativePath.localeCompare(right.relativePath);
  });
  const uniqueRuns = new Set(normalizedItems.map((item) => item.runId).filter(Boolean));
  return {
    key,
    label: CATEGORY_LABELS[key] || key,
    retentionDays,
    scopePath: resolveOptionalPath(scopePath),
    itemCount: normalizedItems.length,
    reclaimableBytes: normalizedItems.reduce((sum, item) => sum + item.bytes, 0),
    runCount: uniqueRuns.size,
    items: normalizedItems,
  };
}

async function collectApiLogCategory(paths, options) {
  const scopePath = resolveOptionalPath(paths.apiRequestLogsDir);
  if (!scopePath) return buildCategory('api_logs', options.apiLogDays, scopePath, []);
  const cutoffMs = options.nowMs - options.apiLogDays * DAY_MS;
  const entries = await listDirectoryEntries(scopePath);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = join(scopePath, entry.name);
    const stats = await statOrNull(absolutePath);
    if (!stats || stats.mtimeMs >= cutoffMs) continue;
    items.push(buildCandidate(paths.basePath, {
      path: absolutePath,
      bytes: stats.size,
      ageMs: options.nowMs - stats.mtimeMs,
      kind: 'api_log',
      anchorTimeMs: stats.mtimeMs,
      note: entry.name,
    }));
  }
  return buildCategory('api_logs', options.apiLogDays, scopePath, items);
}

function extractRunAnchorTime(status, fallbackStats) {
  const candidates = [
    status?.completedAt,
    status?.updatedAt,
    status?.startedAt,
    status?.createdAt,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(value || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.isFinite(fallbackStats?.mtimeMs) ? fallbackStats.mtimeMs : null;
}

async function collectRunPayloadCategory(paths, options) {
  const scopePath = resolveOptionalPath(paths.chatRunsDir);
  if (!scopePath) return buildCategory('run_payloads', options.runPayloadDays, scopePath, []);
  const cutoffMs = options.nowMs - options.runPayloadDays * DAY_MS;
  const entries = await listDirectoryEntries(scopePath);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const runRoot = join(scopePath, runId);
    const statusPath = join(runRoot, 'status.json');
    const statusStats = await statOrNull(statusPath);
    const status = await readJsonFile(statusPath, null);
    if (!status || !TERMINAL_RUN_STATES.has(status.state)) continue;
    const anchorTimeMs = extractRunAnchorTime(status, statusStats);
    if (!Number.isFinite(anchorTimeMs) || anchorTimeMs >= cutoffMs) continue;
    const ageMs = options.nowMs - anchorTimeMs;

    const spoolPath = join(runRoot, 'spool.jsonl');
    const spoolStats = await statOrNull(spoolPath);
    if (spoolStats?.isFile()) {
      items.push(buildCandidate(paths.basePath, {
        path: spoolPath,
        bytes: spoolStats.size,
        ageMs,
        kind: 'run_spool',
        runId,
        anchorTimeMs,
        note: `terminal run ${status.state}`,
      }));
    }

    const artifactsPath = join(runRoot, 'artifacts');
    const artifactsStats = await statOrNull(artifactsPath);
    if (artifactsStats?.isDirectory()) {
      const bytes = await measurePathBytes(artifactsPath);
      if (bytes > 0) {
        items.push(buildCandidate(paths.basePath, {
          path: artifactsPath,
          bytes,
          ageMs,
          kind: 'run_artifacts',
          runId,
          anchorTimeMs,
          note: `terminal run ${status.state}`,
        }));
      }
    }
  }
  return buildCategory('run_payloads', options.runPayloadDays, scopePath, items);
}

async function collectFilesOlderThan(rootPath, options = {}) {
  const scopePath = resolveOptionalPath(rootPath);
  if (!scopePath) return [];
  const cutoffMs = options.cutoffMs;
  const items = [];

  async function walk(currentPath) {
    const entries = await listDirectoryEntries(currentPath);
    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (typeof options.match === 'function' && !options.match(absolutePath, entry.name)) continue;
      const stats = await stat(absolutePath).catch(() => null);
      if (!stats || stats.mtimeMs >= cutoffMs) continue;
      items.push(buildCandidate(options.basePath || scopePath, {
        path: absolutePath,
        bytes: stats.size,
        ageMs: options.nowMs - stats.mtimeMs,
        kind: options.kind || 'file',
        anchorTimeMs: stats.mtimeMs,
        note: entry.name,
      }));
    }
  }

  await walk(scopePath);
  return items;
}

async function collectProviderSessionCategory(paths, options) {
  const scopePath = join(resolveOptionalPath(paths.codexManagedHomeDir), 'sessions');
  const items = await collectFilesOlderThan(scopePath, {
    basePath: paths.basePath,
    cutoffMs: options.nowMs - options.providerSessionDays * DAY_MS,
    nowMs: options.nowMs,
    kind: 'provider_session',
    match: (absolutePath, name) => name.endsWith('.jsonl') && absolutePath.includes('/sessions/'),
  });
  return buildCategory('provider_sessions', options.providerSessionDays, scopePath, items);
}

async function collectProviderShellSnapshotCategory(paths, options) {
  const scopePath = join(resolveOptionalPath(paths.codexManagedHomeDir), 'shell_snapshots');
  const items = await collectFilesOlderThan(scopePath, {
    basePath: paths.basePath,
    cutoffMs: options.nowMs - options.providerSessionDays * DAY_MS,
    nowMs: options.nowMs,
    kind: 'provider_shell_snapshot',
    match: (_absolutePath, name) => name.endsWith('.sh'),
  });
  return buildCategory('provider_shell_snapshots', options.providerSessionDays, scopePath, items);
}

export async function collectStorageMaintenancePlan(options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const retentionDays = {
    apiLogs: normalizePositiveInteger(
      options.apiLogDays ?? DEFAULT_STORAGE_RETENTION_DAYS.apiLogs,
      DEFAULT_STORAGE_RETENTION_DAYS.apiLogs,
      '--api-log-days',
    ),
    runPayloads: normalizePositiveInteger(
      options.runPayloadDays ?? DEFAULT_STORAGE_RETENTION_DAYS.runPayloads,
      DEFAULT_STORAGE_RETENTION_DAYS.runPayloads,
      '--run-payload-days',
    ),
    providerSessions: normalizePositiveInteger(
      options.providerSessionDays ?? DEFAULT_STORAGE_RETENTION_DAYS.providerSessions,
      DEFAULT_STORAGE_RETENTION_DAYS.providerSessions,
      '--provider-session-days',
    ),
  };

  const paths = {
    basePath: resolveOptionalPath(options.basePath || options.appRoot || options.rootPath),
    apiRequestLogsDir: resolveOptionalPath(options.apiRequestLogsDir),
    chatRunsDir: resolveOptionalPath(options.chatRunsDir),
    codexManagedHomeDir: resolveOptionalPath(options.codexManagedHomeDir),
  };

  const categories = await Promise.all([
    collectRunPayloadCategory(paths, { nowMs, runPayloadDays: retentionDays.runPayloads }),
    collectProviderSessionCategory(paths, { nowMs, providerSessionDays: retentionDays.providerSessions }),
    collectProviderShellSnapshotCategory(paths, { nowMs, providerSessionDays: retentionDays.providerSessions }),
    collectApiLogCategory(paths, { nowMs, apiLogDays: retentionDays.apiLogs }),
  ]);

  const orderedCategories = CATEGORY_ORDER
    .map((key) => categories.find((category) => category.key === key))
    .filter(Boolean);
  const totalCandidates = orderedCategories.reduce((sum, category) => sum + category.itemCount, 0);
  const totalReclaimableBytes = orderedCategories.reduce((sum, category) => sum + category.reclaimableBytes, 0);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    nowMs,
    paths,
    retentionDays,
    categories: orderedCategories,
    totalCandidates,
    totalReclaimableBytes,
  };
}

export async function applyStorageMaintenancePlan(plan) {
  const failures = [];
  const removedPaths = [];
  const seenPaths = new Set();
  let removedBytes = 0;

  for (const category of Array.isArray(plan?.categories) ? plan.categories : []) {
    for (const item of Array.isArray(category?.items) ? category.items : []) {
      if (!item?.path || seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);
      try {
        await removePath(item.path);
        removedPaths.push(item.path);
        removedBytes += Number.isFinite(item.bytes) ? item.bytes : 0;
      } catch (error) {
        failures.push({
          path: item.path,
          message: error?.message || String(error),
        });
      }
    }
  }

  return {
    appliedAt: new Date().toISOString(),
    removedCount: removedPaths.length,
    removedBytes,
    failedCount: failures.length,
    failures,
    removedPaths,
  };
}

function categorySummaryLine(category) {
  if (!category.itemCount) {
    return `- ${category.label} (keep ${category.retentionDays}d): nothing to prune`;
  }
  const runNote = category.runCount > 0 ? ` across ${category.runCount} run(s)` : '';
  return `- ${category.label} (keep ${category.retentionDays}d): ${category.itemCount} path(s)${runNote}, ${formatBytes(category.reclaimableBytes)}`;
}

export function formatStorageMaintenanceReport(plan, result = null) {
  const lines = [];
  const title = result ? 'Storage maintenance applied.' : 'Storage maintenance dry run.';
  lines.push(title);
  if (plan?.paths?.basePath) {
    lines.push(`Target: ${plan.paths.basePath}`);
  }
  lines.push(`Reclaimable: ${formatBytes(plan?.totalReclaimableBytes || 0)} across ${plan?.totalCandidates || 0} path(s).`);
  if (result) {
    lines.push(`Removed: ${formatBytes(result.removedBytes || 0)} across ${result.removedCount || 0} path(s).`);
    if (result.failedCount) {
      lines.push(`Failures: ${result.failedCount}.`);
    }
  }
  lines.push('');
  for (const category of Array.isArray(plan?.categories) ? plan.categories : []) {
    lines.push(categorySummaryLine(category));
    for (const item of category.items.slice(0, 3)) {
      lines.push(`  ${item.relativePath} (${formatBytes(item.bytes)}, ${item.ageDays}d old)`);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
