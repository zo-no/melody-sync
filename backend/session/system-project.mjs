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
      // Project root is a pure container — no persistent/recurring fields.
      // Execution belongs to member task sessions, not the project itself.
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
      // Project root is a pure container — no persistent/recurring fields.
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
const WELCOME_MESSAGE = `你好！我是 MelodySync 的 AI 助手。

**MelodySync 是你的个人 AI 任务管理系统。** 你可以：

- 直接和我对话，把想法、任务、问题告诉我
- 在「全局任务」里管理所有日常任务
- 在「长期项目」里跟踪持续进行的项目

**快速开始：** 直接告诉我你想做什么，我来帮你拆解和推进。`;

async function ensureDefaultWelcomeSession(dailyTasksId) {
  try {
    const metas = await loadSessionsMeta();
    const isProjectRoot = (m) => m?.taskPoolMembership?.longTerm?.role === 'project';
    // Builtin system tasks (recurring, scheduled) are auto-created — don't count as "user has sessions"
    const isBuiltinTask = (m) => typeof m?.builtinName === 'string' && m.builtinName.length > 0;
    const hasUserSession = Array.isArray(metas) && metas.some(
      (m) => shouldExposeSession(m) && !isProjectRoot(m) && !isBuiltinTask(m),
    );
    if (hasUserSession) return;

    const { createSession } = await import('./manager.mjs');
    const result = await createSession(
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

    // Pre-populate with a welcome message so the session isn't blank
    const sessionId = result?.session?.id || result?.id;
    if (sessionId) {
      try {
        const { appendEvent } = await import('../history.mjs');
        await appendEvent(sessionId, {
          type: 'message',
          role: 'assistant',
          body: WELCOME_MESSAGE,
          timestamp: Date.now(),
        });
      } catch (msgErr) {
        console.warn('[system-project] Failed to add welcome message:', msgErr?.message || msgErr);
      }
    }
  } catch (err) {
    // Non-fatal: a missing welcome session is better than a crashed server
    console.warn('[system-project] Failed to create default welcome session:', err?.message || err);
  }
}

/**
 * Default recurring tasks created under MelodySync 迭代 on first boot.
 * Each task is idempotent — skipped if a session with the same builtinName exists.
 */
const BUILTIN_TASKS = [
  {
    builtinName: 'melodysync-daily-review',
    name: '每日任务回顾',
    description: '每天回顾当前任务状态，整理优先级，推进下一步行动。',
    runPrompt: '回顾当前所有任务，整理优先级，标记已完成的任务，推进下一步行动。输出今日任务摘要。',
    cadence: 'daily',
    timeOfDay: '09:00',
    bucket: 'long_term',
  },
  {
    builtinName: 'melodysync-daily-cleanup',
    name: '每日清理',
    description: '读取今日 worklog，将已完成任务以紧凑格式写入 Obsidian 日记。',
    runPrompt: `你是 MelodySync 的每日清理任务。执行以下步骤：

**第一步：读取今日 worklog**
读取文件：$MELODYSYNC_MEMORY_DIR/worklog/$(date +%Y)/$(date +%m)/$(date +%Y-%m-%d).jsonl
（如果文件不存在，说明今天没有已完成的任务，输出"今日无已完成任务"并结束。）

**第二步：为每条记录生成紧凑单行**
格式：- HH:MM-HH:MM (时长) [emoji 项目名] 任务名，结论1，结论2
规则：
- 时间段 = createdAt → completedAt，加总时长（分钟取整）
- emoji 从 name/conclusions 推断（排查→🔍，设计→🎨，讨论→💬，重构→🔧，部署→🚀，测试→🧪，文档→📄，新增→✨，其他→💻）
- 项目名取 projectName 字段，无项目只显示 emoji
- 正文 = name + conclusions 拼接（逗号分隔）；无 conclusions 降级到 summary；再降级到 goal；再降级到 name

**第三步：写入 Obsidian 日记**
找到今日日记文件（格式：YYYY_MM_DD.md，位于日记目录下的年份子目录）。
在 \`## Agent Notes\` → \`### MelodySync 工作记录\` 区块内追加这些行。
如果区块不存在则创建。
每条记录用 HTML 注释包裹以支持幂等更新：
\`<!-- melodysync:session:{sessionId}:start -->\`
\`- HH:MM-HH:MM (时长) [emoji 项目名] 正文\`
\`<!-- melodysync:session:{sessionId}:end -->\`

**第四步：输出清理报告**
列出写入了多少条记录，以及任何错误。`,
    cadence: 'daily',
    timeOfDay: '22:00',
    bucket: 'long_term',
  },
  {
    builtinName: 'melodysync-weekly-summary',
    name: '每周总结',
    description: '每周总结完成情况，记录关键决策和学习，规划下周目标。',
    runPrompt: '总结本周完成的任务和关键决策，记录重要学习，规划下周3个核心目标。输出周报。',
    cadence: 'weekly',
    timeOfDay: '20:00',
    weekdays: [0],
    bucket: 'long_term',
  },
];

async function ensureBuiltinTasks(melodySyncProjectId) {
  if (!melodySyncProjectId) return;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

    await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
      // Idempotency: check by builtinName OR by name (in case builtinName wasn't persisted before)
      const existingBuiltinNames = new Set(metas.filter((m) => m?.builtinName).map((m) => m.builtinName));
      const existingNames = new Set(
        metas
          .filter((m) => {
            const mem = m?.taskPoolMembership?.longTerm;
            return mem?.projectSessionId === melodySyncProjectId && mem?.role === 'member';
          })
          .map((m) => String(m.name || '').trim()),
      );

      let changed = false;
      for (const task of BUILTIN_TASKS) {
        if (existingBuiltinNames.has(task.builtinName)) continue;
        if (existingNames.has(task.name)) continue;

        const id = generateId();
        const now = nowIso();
        // nextRunAt will be computed by the scheduler on first tick
        const nextRunAt = '';

        metas.push({
          id,
          name: task.name,
          builtinName: task.builtinName,
          description: task.description,
          folder: '~',
          tool: 'claude',
          taskListOrigin: 'user',
          taskListVisibility: 'primary',
          taskPoolMembership: buildLongTermTaskPoolMembership(melodySyncProjectId, {
            role: 'member',
            bucket: task.bucket,
          }),
          persistent: {
            version: 1,
            kind: 'recurring_task',
            state: 'active',
            promotedAt: now,
            updatedAt: now,
            digest: {
              title: task.name,
              summary: task.description,
              goal: task.name,
              keyPoints: [],
              recipe: [],
            },
            execution: {
              mode: 'spawn_session',
              runPrompt: task.runPrompt,
              lastTriggerAt: '',
              lastTriggerKind: '',
            },
            recurring: {
              cadence: task.cadence,
              timeOfDay: task.timeOfDay,
              weekdays: task.weekdays || [],
              timezone: tz,
              nextRunAt: nextRunAt || '',
              lastRunAt: '',
            },
            loop: { collect: { sources: [], instruction: '' }, organize: { instruction: '' }, use: { instruction: '' }, prune: { instruction: '' } },
            runtimePolicy: { manual: { mode: 'follow_current' }, schedule: { mode: 'session_default' } },
          },
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      }

      if (!changed) return { changed: false };
      await saveSessionsMeta(metas);
      return { changed: true };
    });
  } catch (err) {
    console.warn('[system-project] Failed to create builtin tasks:', err?.message || err);
  }
}

// Alias for callers that use ensureBuiltinProjects
export async function ensureBuiltinProjects() {
  const dailyTasksId = await ensureSystemProject();
  const melodySyncId = await ensureMelodySyncProject(dailyTasksId);
  await ensureBuiltinTasks(melodySyncId);
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


