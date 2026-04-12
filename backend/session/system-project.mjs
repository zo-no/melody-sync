/**
 * System project management — "日常任务" default project.
 *
 * The "日常任务" system project is a special long-term project that acts as the
 * default home for all sessions that aren't explicitly assigned to another project.
 * It is auto-created on first access and never deleted.
 *
 * All new sessions created without an explicit taskPoolMembership are automatically
 * assigned to this project's inbox bucket.
 */
import { randomBytes } from 'crypto';
import { join } from 'path';
import { CONFIG_DIR } from '../../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../fs-utils.mjs';
import { withSessionsMetaMutation } from './meta-store.mjs';
import { buildLongTermTaskPoolMembership } from './task-pool-membership.mjs';

const SYSTEM_PROJECT_STATE_FILE = join(CONFIG_DIR, 'system-project.json');

// In-memory cache so we only hit disk once per process lifetime
let cachedSystemProjectId = '';
// Pending init promise to prevent concurrent creation races
let initPromise = null;

function generateId() {
  return `sys_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Read the persisted system project ID from disk.
 * Returns '' if not yet created.
 */
async function readSystemProjectId() {
  const state = await readJson(SYSTEM_PROJECT_STATE_FILE, {});
  return typeof state?.projectId === 'string' ? state.projectId.trim() : '';
}

/**
 * Persist the system project ID to disk.
 */
async function saveSystemProjectId(projectId) {
  await writeJsonAtomic(SYSTEM_PROJECT_STATE_FILE, { projectId });
}

/**
 * Find an existing system project session in the metas list.
 * A system project is identified by taskListOrigin === 'system' and
 * taskPoolMembership.longTerm.role === 'project' and fixedNode === true.
 */
function findSystemProjectInMetas(metas) {
  return metas.find((meta) => {
    if (meta?.archived === true) return false;
    if (meta?.taskListOrigin !== 'system') return false;
    const lt = meta?.taskPoolMembership?.longTerm;
    return lt?.role === 'project' && lt?.fixedNode === true;
  }) || null;
}

/**
 * Ensure the "日常任务" system project exists.
 * Creates it if it doesn't exist. Returns the project session ID.
 * Safe to call multiple times — idempotent.
 */
export async function ensureSystemProject() {
  // Fast path: already cached
  if (cachedSystemProjectId) return cachedSystemProjectId;

  // Check disk first
  const persistedId = await readSystemProjectId();
  if (persistedId) {
    cachedSystemProjectId = persistedId;
    return persistedId;
  }

  // Need to create or find the system project
  let resolvedId = '';

  await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    // Check if a system project already exists in session list
    const existing = findSystemProjectInMetas(metas);
    if (existing) {
      resolvedId = existing.id;
      return { changed: false };
    }

    // Create a new system project session
    const id = generateId();
    const now = nowIso();
    const membership = buildLongTermTaskPoolMembership(id, { role: 'project' });
    const session = {
      id,
      name: '日常任务',
      folder: '~',
      tool: 'claude',
      taskListOrigin: 'system',
      taskListVisibility: 'primary',
      persistent: {
        kind: 'recurring_task',
        digest: { title: '日常任务', summary: '默认日常任务项目' },
      },
      taskPoolMembership: membership,
      createdAt: now,
      updatedAt: now,
    };

    metas.push(session);
    await saveSessionsMeta(metas);
    resolvedId = id;
    return { changed: true };
  });

  if (resolvedId) {
    cachedSystemProjectId = resolvedId;
    await saveSystemProjectId(resolvedId);
  }

  return resolvedId;
}

/**
 * Get the system project ID synchronously. Returns '' if not yet initialized.
 * For guaranteed access, use ensureSystemProject() which is async.
 */
export function getSystemProjectId() {
  return cachedSystemProjectId;
}

/**
 * Ensure system project is initialized, reusing an in-flight promise if one exists.
 * Safe to call concurrently.
 */
export function ensureSystemProjectOnce() {
  if (cachedSystemProjectId) return Promise.resolve(cachedSystemProjectId);
  if (!initPromise) {
    initPromise = ensureSystemProject().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

/**
 * Build the taskPoolMembership for a new session that should go into
 * the system project's inbox bucket.
 */
export function buildSystemProjectInboxMembership(systemProjectId) {
  if (!systemProjectId) return null;
  return buildLongTermTaskPoolMembership(systemProjectId, {
    role: 'member',
    bucket: 'inbox',
  });
}
