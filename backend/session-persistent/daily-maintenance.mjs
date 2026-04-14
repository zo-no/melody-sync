import { readFile } from 'fs/promises';
import { join } from 'path';

import { CONFIG_DIR, MEMORY_DIR } from '../../lib/config.mjs';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from '../fs-utils.mjs';
import { loadSessionsMeta } from '../session/meta-store.mjs';
import { getSession, setSessionArchived, updateSessionWorkflowState } from '../session/manager.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import { trimText } from '../shared/text.mjs';

const DAILY_MAINTENANCE_STATE_FILE = join(CONFIG_DIR, 'session-daily-maintenance.json');
const CONTEXT_DIGEST_MD = join(MEMORY_DIR, 'context-digest.md');
const TASKS_DIR = join(MEMORY_DIR, 'tasks');
const WORKLOG_DIR = join(MEMORY_DIR, 'worklog');

let maintenanceInFlight = false;

function normalizeText(value) {
  return trimText(String(value || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' '));
}

function clipText(value, maxChars = 220) {
  const text = normalizeText(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeList(value, maxItems = 4, maxChars = 160) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const text = clipText(String(entry || '').replace(/^[-*•]\s*/, ''), maxChars);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }
  return normalized;
}

function normalizeIsoTimestamp(value) {
  const text = trimText(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function getLocalDayStart(value = new Date()) {
  const date = parseDate(value) || new Date();
  const next = new Date(date.getTime());
  next.setHours(0, 0, 0, 0);
  return next;
}

function getPreviousLocalDay(value = new Date()) {
  const next = getLocalDayStart(value);
  next.setDate(next.getDate() - 1);
  return next;
}

function formatLocalDayKey(value = new Date()) {
  const date = parseDate(value) || new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDoneWorkflowState(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  return ['done', 'complete', 'completed', 'finished', '完成', '已完成', '运行完毕', '运行完成'].includes(normalized);
}

function isPersistentSession(session = {}) {
  const kind = trimText(session?.persistent?.kind).toLowerCase();
  return kind === 'skill'
    || kind === 'recurring_task'
    || kind === 'scheduled_task'
    || kind === 'waiting_task';
}

function bulletize(text) {
  const normalized = normalizeText(text);
  return normalized ? `- ${normalized}` : '';
}

function appendSection(content, heading, line) {
  const nextLine = normalizeText(line);
  if (!nextLine) return String(content || '');
  const current = String(content || '').replace(/\r\n/g, '\n');
  const lines = current.split('\n');
  const headingLine = `## ${heading}`;
  if (lines.some((entry) => normalizeText(entry) === nextLine)) {
    return current;
  }
  const sectionIndex = lines.findIndex((entry) => normalizeText(entry) === normalizeText(headingLine));
  if (sectionIndex === -1) {
    const trimmed = current.trimEnd();
    return `${trimmed ? `${trimmed}\n\n` : ''}${headingLine}\n${nextLine}\n`;
  }
  let insertAt = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      insertAt = index;
      break;
    }
  }
  const nextLines = [...lines];
  nextLines.splice(insertAt, 0, nextLine);
  return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function updateFrontmatterTimestamp(content, isoString) {
  const text = String(content || '');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return text;
  const frontmatter = text.slice(4, end).split('\n');
  let updated = false;
  const nextFrontmatter = frontmatter.map((line) => {
    if (/^updated_at:\s*/.test(line)) {
      updated = true;
      return `updated_at: ${isoString}`;
    }
    return line;
  });
  if (!updated) nextFrontmatter.push(`updated_at: ${isoString}`);
  return `---\n${nextFrontmatter.join('\n')}\n---\n${text.slice(end + 5)}`;
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function appendMarkdownLine(path, heading, line, { updateDigestTimestamp = false } = {}) {
  const current = await readText(path);
  let next = appendSection(current, heading, line);
  if (updateDigestTimestamp) {
    next = updateFrontmatterTimestamp(next, new Date().toISOString());
  }
  if (next !== current) {
    await writeTextAtomic(path, next);
  }
}

function buildTaskMemoryPath(sessionId = '') {
  const normalized = normalizeText(sessionId).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return join(TASKS_DIR, `${normalized || 'session'}.md`);
}

function buildWorklogPath(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return join(WORKLOG_DIR, year, month, `${year}-${month}-${day}.jsonl`);
}

function resolveWorkflowCompletedAt(session = {}) {
  return normalizeIsoTimestamp(
    session?.workflowCompletedAt
    || session?.updatedAt
    || session?.lastEventAt
    || session?.created
    || '',
  );
}

function isEligibleForDailyArchive(session = {}, cutoffDate = new Date()) {
  if (!session?.id || session?.archived === true || isPersistentSession(session)) return false;
  // PROTECTION: Never auto-archive tasks that belong to a long-term project
  // These are managed by the project owner, not the daily sweep
  const ltMembership = session?.taskPoolMembership?.longTerm;
  if (ltMembership?.projectSessionId && ltMembership?.role === 'member') return false;
  if (!isDoneWorkflowState(session?.workflowState || '')) return false;
  const completedAt = resolveWorkflowCompletedAt(session);
  if (!completedAt) return false;
  const completedTime = Date.parse(completedAt);
  return Number.isFinite(completedTime) && completedTime < cutoffDate.getTime();
}

const ACTIVITY_EMOJI_RULES = [
  { pattern: /排查|报错|错误|bug|debug|修复|fix|crash|异常|失败/, emoji: '🔍' },
  { pattern: /设计|ui|ux|界面|样式|布局|视觉|原型/, emoji: '🎨' },
  { pattern: /讨论|分享|会议|头脑风暴|brainstorm|review|评审/, emoji: '💬' },
  { pattern: /重构|优化|清理|整理|迁移|refactor/, emoji: '🔧' },
  { pattern: /部署|发布|上线|deploy|release|ci|cd/, emoji: '🚀' },
  { pattern: /测试|test|spec|单测|集成/, emoji: '🧪' },
  { pattern: /文档|doc|readme|注释/, emoji: '📄' },
  { pattern: /新增|添加|实现|开发|feature|功能/, emoji: '✨' },
];

function inferActivityEmoji(texts = []) {
  const combined = texts.filter(Boolean).join(' ').toLowerCase();
  for (const rule of ACTIVITY_EMOJI_RULES) {
    if (rule.pattern.test(combined)) return rule.emoji;
  }
  return '💻';
}

function formatTimeLabel(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDuration(startIso, endIso) {
  const start = startIso ? Date.parse(startIso) : 0;
  const end = endIso ? Date.parse(endIso) : 0;
  if (!start || !end || end <= start) return '';
  const totalMinutes = Math.round((end - start) / 60000);
  if (totalMinutes <= 0) return '';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function buildArchiveDigest(session = {}) {
  const sessionState = resolveSessionStateFromSession(session, session?.sourceContext || null);
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const conclusions = normalizeList(taskCard?.knownConclusions, 4, 160);
  const memory = normalizeList(taskCard?.memory, 3, 140);
  const title = clipText(
    session?.name
    || taskCard?.goal
    || sessionState.goal
    || taskCard?.summary
    || '未命名任务',
    120,
  );
  const summary = clipText(taskCard?.summary || sessionState.checkpoint || '', 200);
  let goal = clipText(taskCard?.goal || sessionState.goal || '', 180);
  const checkpoint = clipText(sessionState.checkpoint || taskCard?.checkpoint || summary || title, 200);
  if (!goal || goal === title) {
    goal = clipText(summary || checkpoint || title, 180);
  }
  const completedAt = resolveWorkflowCompletedAt(session);
  const createdAt = normalizeIsoTimestamp(session?.created || '');
  const projectName = trimText(session?.sessionState?.longTerm?.rootTitle || session?.group || '');
  const emoji = inferActivityEmoji([title, conclusions[0]]);
  const tag = projectName ? `${emoji} ${projectName}` : emoji;

  // Human line: compact single-line for Obsidian diary
  const startLabel = formatTimeLabel(createdAt);
  const endLabel = formatTimeLabel(completedAt);
  const durationLabel = formatDuration(createdAt, completedAt);
  const timeRange = startLabel && endLabel ? `${startLabel}-${endLabel}` : (endLabel || startLabel || '');
  const timePart = durationLabel ? `${timeRange} (${durationLabel})` : timeRange;
  const bodyText = conclusions.length > 0
    ? `${title}，${conclusions.join('，')}`
    : (summary || goal || title);
  const humanLine = bulletize(
    timePart ? `${timePart} [${tag}] ${clipText(bodyText, 200)}` : `[${tag}] ${clipText(bodyText, 200)}`,
  );

  // Agent lines: multi-layer structured block for worklog (AI-readable)
  const agentLines = [
    `#### ${endLabel || formatLocalDayKey(completedAt ? new Date(completedAt) : new Date())} ${title}`,
    goal && goal !== title ? `- 任务目标：${goal}` : '',
    summary && summary !== goal && summary !== title ? `- 工作摘要：${summary}` : '',
    conclusions.length > 0 ? '- 关键结论：' : '',
    ...conclusions.map((c) => `  - ${c}`),
    memory.length > 0 ? '- 持久记忆：' : '',
    ...memory.map((m) => `  - ${m}`),
    completedAt ? `- 完成时间：${completedAt}` : '',
    projectName ? `- 所属项目：${projectName}` : '',
  ].filter(Boolean);

  // JSONL record for worklog file — machine-readable, used by daily diary task
  const worklogRecord = {
    sessionId: session.id,
    date: formatLocalDayKey(completedAt ? new Date(completedAt) : new Date()),
    ts: new Date().toISOString(),
    name: title,
    kind: trimText(session?.persistent?.kind || 'inbox'),
    bucket: trimText(session?.taskPoolMembership?.longTerm?.bucket || 'inbox'),
    result: 'done',
    createdAt: createdAt || null,
    completedAt: completedAt || null,
    projectName: projectName || null,
    goal: goal !== title ? goal : null,
    summary: summary || null,
    conclusions: conclusions.length > 0 ? conclusions : null,
    memory: memory.length > 0 ? memory : null,
  };

  return {
    sessionId: session.id,
    title,
    goal,
    summary,
    checkpoint,
    conclusions,
    memory,
    completedAt,
    humanLine,
    agentLines,
    worklogRecord,
  };
}

async function writeTaskArchiveDigest(digest) {
  const targetPath = buildTaskMemoryPath(digest.sessionId);
  const current = await readText(targetPath);
  const header = current.trim()
    ? current
    : `# Task Memory\n\n- Session ID: \`${normalizeText(digest.sessionId) || 'unknown'}\`\n- Session: ${digest.title}\n`;
  let next = appendSection(header, 'Archive Digest', bulletize(`Archived after midnight sweep. Completed at ${digest.completedAt || 'unknown'}.`));
  next = appendSection(next, 'Archive Digest', bulletize(`Goal: ${digest.goal || digest.title}`));
  if (digest.summary) {
    next = appendSection(next, 'Archive Digest', bulletize(`Summary: ${digest.summary}`));
  }
  if (digest.checkpoint) {
    next = appendSection(next, 'Archive Digest', bulletize(`Checkpoint: ${digest.checkpoint}`));
  }
  if (digest.conclusions.length > 0) {
    next = appendSection(next, 'Archive Digest', bulletize(`Conclusions: ${digest.conclusions.join('；')}`));
  }
  if (digest.memory.length > 0) {
    next = appendSection(next, 'Archive Digest', bulletize(`Durable memory: ${digest.memory.join('；')}`));
  }
  if (next !== current) {
    await writeTextAtomic(targetPath, next);
  }
}

async function writeHumanWorklog(digests = [], sweepDate = new Date()) {
  // Worklog: JSONL format, one record per task, written to WORKLOG_DIR
  // Machine-readable source of truth — read by the daily diary recurring_task
  // to generate Obsidian diary entries in compact single-line format
  if (!digests.length) return;
  const targetPath = buildWorklogPath(sweepDate);
  const { appendFile } = await import('fs/promises');
  const { mkdirSync } = await import('fs');
  const { dirname } = await import('path');
  try { mkdirSync(dirname(targetPath), { recursive: true }); } catch { /* already exists */ }
  const lines = digests
    .map((digest) => JSON.stringify(digest.worklogRecord))
    .join('\n');
  await appendFile(targetPath, `${lines}\n`, 'utf8');
}

async function writeAgentDigest(digests = [], sweepDate = new Date()) {
  // Agent digest: multi-layer structured format written to context-digest.md (AI-readable)
  // Preserves full task card fields: goal, summary, conclusions, memory, timestamps
  if (!digests.length) return;
  const dayKey = formatLocalDayKey(sweepDate);
  const current = await readText(CONTEXT_DIGEST_MD);
  const heading = 'Midnight Archive';
  const headingLine = `## ${heading}`;
  // Build the block to append: summary line + one structured block per digest
  const allNewLines = [
    bulletize(`${dayKey}：自动归档 ${digests.length} 项任务，后续迭代优先复用这些收束结论。`),
    ...digests.flatMap((digest) => ['', ...digest.agentLines]),
  ].filter((line) => line !== undefined);

  const text = String(current || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const sectionIndex = lines.findIndex((l) => normalizeText(l) === normalizeText(headingLine));
  let nextLines;
  if (sectionIndex === -1) {
    const trimmed = text.trimEnd();
    const prefix = trimmed ? `${trimmed}\n\n` : '';
    nextLines = `${prefix}${headingLine}\n${allNewLines.join('\n')}\n`;
  } else {
    // Find end of this section
    let insertAt = lines.length;
    for (let i = sectionIndex + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i])) { insertAt = i; break; }
    }
    const next = [...lines];
    next.splice(insertAt, 0, ...allNewLines);
    nextLines = `${next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }
  const withTs = updateFrontmatterTimestamp(nextLines, new Date().toISOString());
  if (withTs !== text) {
    await writeTextAtomic(CONTEXT_DIGEST_MD, withTs);
  }
}

async function archiveSessions(sessionIds = []) {
  // Sessions are now marked done via workflowState; no separate archived flag needed.
  // This function is kept for call-site compatibility but is intentionally a no-op.
  void sessionIds;
}

export async function scanDailySessionMaintenance(nowValue = new Date()) {
  if (maintenanceInFlight) {
    return { ran: false, skipped: 'in_flight', archivedCount: 0, archivedSessionIds: [] };
  }
  maintenanceInFlight = true;
  try {
    const now = parseDate(nowValue) || new Date();
    const cutoffDate = getLocalDayStart(now);
    const dayKey = formatLocalDayKey(cutoffDate);
    const previousDay = getPreviousLocalDay(now);
    const state = await readJson(DAILY_MAINTENANCE_STATE_FILE, {});
    if (trimText(state?.lastDailySweepDate) === dayKey) {
      return { ran: false, skipped: 'already_processed', archivedCount: 0, archivedSessionIds: [] };
    }

    const sessions = await loadSessionsMeta();
    const eligibleSessions = [];
    for (const meta of Array.isArray(sessions) ? sessions : []) {
      if (!isEligibleForDailyArchive(meta, cutoffDate)) continue;
      try {
        const session = await getSession(meta.id);
        if (session && isEligibleForDailyArchive(session, cutoffDate)) {
          eligibleSessions.push(session);
        }
      } catch (error) {
        console.error(`[daily-maintenance] Failed to load ${meta?.id || 'session'}: ${error.message}`);
      }
    }

    const digests = eligibleSessions.map(buildArchiveDigest);
    await Promise.all([
      ensureDir(TASKS_DIR),
      ensureDir(WORKLOG_DIR),
    ]);
    await writeHumanWorklog(digests, previousDay);
    await writeAgentDigest(digests, previousDay);
    for (const digest of digests) {
      await writeTaskArchiveDigest(digest);
    }
    await archiveSessions(digests.map((digest) => digest.sessionId));

    // ── B5: Auto-complete stale inbox tasks (30+ days without update) ─────────────────────
    const INBOX_STALE_DAYS = 30;
    const allSessionsRaw = Array.isArray(sessions) ? sessions : [];
    const staleInboxIds = [];
    const staleCutoff = new Date(now.getTime() - INBOX_STALE_DAYS * 24 * 60 * 60 * 1000);
    for (const meta of allSessionsRaw) {
      if (meta?.archived) continue;
      const metaWf = trimText(meta?.workflowState || '').toLowerCase();
      if (metaWf === 'done' || metaWf === 'complete' || metaWf === 'completed') continue;
      // Only inbox bucket
      const bucket = trimText(meta?.taskPoolMembership?.longTerm?.bucket || '').toLowerCase();
      if (bucket !== 'inbox') continue;
      // Skip if it has an active workflow state
      if (metaWf && !['', 'pending', 'idle'].includes(metaWf)) continue;
      // Skip sessions that belong to a long-term project (project roots AND members)
      const projectSessionId = trimText(meta?.taskPoolMembership?.longTerm?.projectSessionId || '');
      if (projectSessionId) continue;
      // Check last updated time
      const lastUpdated = parseDate(meta?.updatedAt || meta?.lastEventAt || meta?.created);
      if (!lastUpdated || lastUpdated.getTime() > staleCutoff.getTime()) continue;
      staleInboxIds.push(meta.id);
    }
    if (staleInboxIds.length > 0) {
      for (const sessionId of staleInboxIds) {
        try {
          await updateSessionWorkflowState(sessionId, 'done');
        } catch (error) {
          console.error(`[daily-maintenance] Failed to mark done ${sessionId}: ${error.message}`);
        }
      }
      await appendMarkdownLine(
        CONTEXT_DIGEST_MD,
        'Auto Maintenance',
        `- ${dayKey}：自动完成 ${staleInboxIds.length} 条超过 ${INBOX_STALE_DAYS} 天未更新的收集箱任务。`,
        { updateDigestTimestamp: true },
      );
    }

    // ── Pattern analysis: detect recurring themes for long-term project recommendations ──
    const allSessions = Array.isArray(sessions) ? sessions : [];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentSessions = allSessions.filter((s) => {
      if (s.archived) return false;
      const t = parseDate(s.lastEventAt || s.updatedAt || s.created);
      return t && t.getTime() > thirtyDaysAgo.getTime();
    });

    // Extract keywords from session names and goals
    const keywordCounts = new Map();
    for (const s of recentSessions) {
      const text = [s.name || '', s.taskCard?.goal || '', s.taskCard?.summary || ''].join(' ');
      const words = text.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
      for (const word of words) {
        const lower = word.toLowerCase();
        if (['session', 'new', 'task', '任务', '会话', '今天', '明天', '一个', '这个'].includes(lower)) continue;
        keywordCounts.set(lower, (keywordCounts.get(lower) || 0) + 1);
      }
    }

    // Find keywords appearing 3+ times (potential long-term patterns)
    const patterns = [...keywordCounts.entries()]
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word, count]) => `${word}(${count}次)`);

    if (patterns.length > 0) {
      await appendMarkdownLine(
        CONTEXT_DIGEST_MD,
        'Behavior Patterns',
        `- ${dayKey}：近30天高频主题：${patterns.join('、')}。如用户未创建相关长期项目，可主动推荐。`,
        { updateDigestTimestamp: true },
      );
    }

    const allArchivedIds = [
      ...digests.map((digest) => digest.sessionId),
    ];
    const nextState = {
      lastDailySweepDate: dayKey,
      lastSweepAt: now.toISOString(),
      archivedCount: allArchivedIds.length,
      archivedSessionIds: allArchivedIds,
      staleInboxMarkedDoneCount: staleInboxIds.length,
      patterns,
    };
    await writeJsonAtomic(DAILY_MAINTENANCE_STATE_FILE, nextState);
    return {
      ran: true,
      archivedCount: allArchivedIds.length,
      archivedSessionIds: allArchivedIds,
      staleInboxMarkedDoneCount: staleInboxIds.length,
      patterns,
    };
  } finally {
    maintenanceInFlight = false;
  }
}
