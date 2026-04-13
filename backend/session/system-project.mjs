/**
 * System project management — "日常任务" default project.
 *
 * The "日常任务" system project is a special long-term project that acts as the
 * default home for all sessions that aren't explicitly assigned to another project.
 * It is auto-created on first access and never deleted.
 *
 * All new sessions created without an explicit taskPoolMembership are automatically
 * assigned to this project's inbox bucket.
 *
 * Built-in projects at startup:
 *   1. 日常任务  (builtinName: 'daily-tasks')  — default catch-all for all tasks
 *   2. MelodySync 系统管理 — product iteration project (managed separately)
 */
import { randomBytes } from 'crypto';
import { join } from 'path';
import { CONFIG_DIR } from '../../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../fs-utils.mjs';
import { withSessionsMetaMutation, loadSessionsMeta } from './meta-store.mjs';
import { buildLongTermTaskPoolMembership } from './task-pool-membership.mjs';
import { shouldExposeSession } from './visibility.mjs';

const SYSTEM_PROJECT_STATE_FILE = join(CONFIG_DIR, 'system-project.json');

// In-memory cache so we only hit disk once per process lifetime
let cachedSystemProjectId = '';

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
 * Find the 日常任务 system project in metas.
 * Matches by builtinName (new) or display name (legacy).
 */
function findDailyTasksProjectInMetas(metas) {
  return metas.find((meta) => {
    if (meta?.archived === true) return false;
    if (meta?.taskListOrigin !== 'system') return false;
    const lt = meta?.taskPoolMembership?.longTerm;
    if (!(lt?.role === 'project' && lt?.fixedNode === true)) return false;
    if (meta?.builtinName) return meta.builtinName === 'daily-tasks';
    return meta?.name === '日常任务';
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

  let resolvedId = '';

  // Read disk hint (validate against metas — legacy file may point to wrong project)
  const persistedHint = await readSystemProjectId();

  await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    // Authoritative: search metas by builtinName / display name
    const existing = findDailyTasksProjectInMetas(metas);
    if (existing) {
      resolvedId = existing.id;
      return { changed: false };
    }

    // Validate persisted hint
    if (persistedHint) {
      const persisted = metas.find((m) => m.id === persistedHint && !m.archived);
      if (persisted && (persisted.builtinName === 'daily-tasks' || persisted.name === '日常任务')) {
        resolvedId = persistedHint;
        return { changed: false };
      }
    }

    // Create a new system project session
    const id = generateId();
    const now = nowIso();
    const membership = buildLongTermTaskPoolMembership(id, { role: 'project' });
    metas.push({
      id,
      name: '日常任务',
      builtinName: 'daily-tasks',
      folder: '~',
      tool: 'claude',
      taskListOrigin: 'system',
      taskListVisibility: 'primary',
      persistent: {
        kind: 'recurring_task',
        digest: { title: '日常任务', summary: '默认项目，所有任务的集合' },
      },
      taskPoolMembership: membership,
      createdAt: now,
      updatedAt: now,
    });
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
 * Find the MelodySync product iteration project in metas.
 */
function findMelodySyncProjectInMetas(metas) {
  return metas.find((meta) => {
    if (meta?.archived === true) return false;
    if (meta?.taskListOrigin !== 'user') return false;
    if (meta?.builtinName) return meta.builtinName === 'melodysync-iteration';
    return false;
  }) || null;
}

/**
 * Ensure the MelodySync product iteration project exists.
 * This is a user-visible long-term project for iterating on MelodySync itself.
 */
export async function ensureMelodySyncProject(systemProjectId = '') {
  let resolvedId = '';

  await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    const existing = findMelodySyncProjectInMetas(metas);
    if (existing) {
      resolvedId = existing.id;
      return { changed: false };
    }

    const id = generateId();
    const now = nowIso();
    const membership = buildLongTermTaskPoolMembership(id, { role: 'project' });
    metas.push({
      id,
      name: 'MelodySync 迭代',
      builtinName: 'melodysync-iteration',
      folder: '~',
      tool: 'claude',
      taskListOrigin: 'user',
      taskListVisibility: 'primary',
      persistent: {
        kind: 'recurring_task',
        digest: { title: 'MelodySync 迭代', summary: 'MelodySync 产品迭代与功能开发' },
      },
      taskPoolMembership: membership,
      createdAt: now,
      updatedAt: now,
    });
    await saveSessionsMeta(metas);
    resolvedId = id;
    return { changed: true };
  });

  return resolvedId;
}

/**
 * On first boot (no user-visible sessions), create a default welcome session so
 * new users see something in the sidebar instead of a blank screen.
 *
 * Idempotent: only creates if no user-facing sessions exist.
 * Lazy import of createSession to avoid circular deps at module load time.
 */
async function ensureDefaultWelcomeSession(dailyTasksId) {
  try {
    const metas = await loadSessionsMeta();
    const hasUserSession = Array.isArray(metas) && metas.some((m) => shouldExposeSession(m));
    if (hasUserSession) return;

    const { createSession } = await import('./manager.mjs');
    await createSession(
      '~',
      'claude',
      '开始使用 MelodySync',
      {
        taskListOrigin: 'user',
        ...(dailyTasksId ? {
          taskPoolMembership: buildLongTermTaskPoolMembership(dailyTasksId, { role: 'member', bucket: 'inbox' }),
        } : {}),
      },
    );
  } catch (err) {
    // Non-fatal: a missing welcome session is better than a crashed server
    console.warn('[system-project] Failed to create default welcome session:', err?.message || err);
  }
}

// Alias for callers that use ensureBuiltinProjects
export async function ensureBuiltinProjects() {
  const dailyTasksId = await ensureSystemProject();
  await ensureMelodySyncProject(dailyTasksId);
  await ensureDefaultWelcomeSession(dailyTasksId);
  return { dailyTasksId };
}

/**
 * Get the system project ID synchronously. Returns '' if not yet initialized.
 * For guaranteed access, use ensureSystemProject() which is async.
 */
export function getSystemProjectId() {
  return cachedSystemProjectId;
}


