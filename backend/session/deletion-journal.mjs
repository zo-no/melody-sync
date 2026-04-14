import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { MELODYSYNC_APP_ROOT } from '../../lib/config.mjs';
import { pathExists, writeTextAtomic } from '../fs-utils.mjs';
import { stripGraphOpsFromAssistantContent } from './graph-ops.mjs';
import { normalizeSessionTaskCard, stripTaskCardFromAssistantContent } from './task-card.mjs';

const JOURNAL_DIR_SEGMENTS = ['02-📓journal', '04-📂日记'];
const AGENT_NOTES_HEADING = '## Agent Notes';
const MELODYSYNC_SECTION_HEADING = '### MelodySync 工作记录';

function createDeleteError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

import { trimText } from './text.mjs';

function clipText(value, maxChars = 160) {
  const text = trimText(value).replace(/\s+/g, ' ');
  if (!text || text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function formatLocalDateParts(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return {
    year,
    fileName: `${year}_${month}_${day}.md`,
    timeLabel: `${hour}:${minute}`,
  };
}

async function resolveJournalVaultRoot() {
  const parentRoot = dirname(MELODYSYNC_APP_ROOT);
  const parentJournalDir = join(parentRoot, ...JOURNAL_DIR_SEGMENTS);
  if (await pathExists(parentJournalDir)) {
    return parentRoot;
  }
  const localJournalDir = join(MELODYSYNC_APP_ROOT, ...JOURNAL_DIR_SEGMENTS);
  if (await pathExists(localJournalDir)) {
    return MELODYSYNC_APP_ROOT;
  }
  return parentRoot;
}

async function openObsidianVault(vaultRoot) {
  const target = trimText(vaultRoot);
  if (!target) return;
  try {
    const child = spawn('open', ['-a', 'Obsidian', target], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {}
}

function normalizeInlineMarkdown(value) {
  return clipText(
    trimText(value)
      .replace(/\r\n/g, '\n')
      .replace(/<private>[\s\S]*?<\/private>/gi, ' ')
      .replace(/<hide>[\s\S]*?<\/hide>/gi, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\n+/g, ' '),
    180,
  );
}

function textEquivalent(left, right) {
  const normalize = (value) => trimText(value).toLowerCase().replace(/\s+/g, ' ');
  const leftText = normalize(left);
  const rightText = normalize(right);
  if (!leftText || !rightText) return false;
  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText);
}

function pushUnique(values, value, maxItems = 6) {
  const next = clipText(value, 180);
  if (!next) return values.length < maxItems;
  if (values.some((entry) => textEquivalent(entry, next))) return values.length < maxItems;
  values.push(next);
  return values.length < maxItems;
}

function mergeTaskCardSignals(rootSession, relatedSessions = []) {
  const cards = [rootSession, ...(Array.isArray(relatedSessions) ? relatedSessions : [])]
    .map((session) => normalizeSessionTaskCard(session?.taskCard || {}))
    .filter((card) => card && (
      trimText(card.goal)
      || trimText(card.mainGoal)
      || trimText(card.summary)
      || trimText(card.checkpoint)
      || (card.knownConclusions || []).length > 0
    ));

  const knownConclusions = [];
  for (const card of cards) {
    for (const entry of card.knownConclusions || []) {
      if (!pushUnique(knownConclusions, entry, 6)) break;
    }
    if (knownConclusions.length >= 6) break;
  }

  return {
    goal: trimText(cards[0]?.goal) || '',
    mainGoal: trimText(cards[0]?.mainGoal) || '',
    summary: trimText(cards[0]?.summary) || '',
    checkpoint: trimText(cards[0]?.checkpoint) || '',
    knownConclusions,
  };
}

function extractSessionCreatedAt(historiesBySessionId = {}, sessionIds = []) {
  let earliest = 0;
  for (const sessionId of sessionIds) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      const ts = Number.isFinite(event?.timestamp) ? event.timestamp : 0;
      if (ts > 0 && (earliest === 0 || ts < earliest)) {
        earliest = ts;
      }
    }
  }
  return earliest > 0 ? new Date(earliest) : null;
}

function formatDuration(createdAt, now = new Date()) {
  if (!(createdAt instanceof Date)) return '';
  const totalMinutes = Math.round((now - createdAt) / 60000);
  if (totalMinutes <= 0) return '';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

function formatCreatedAtLabel(createdAt, now = new Date()) {
  if (!(createdAt instanceof Date)) return '';
  const sameDay =
    createdAt.getFullYear() === now.getFullYear() &&
    createdAt.getMonth() === now.getMonth() &&
    createdAt.getDate() === now.getDate();
  const month = String(createdAt.getMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getDate()).padStart(2, '0');
  const hour = String(createdAt.getHours()).padStart(2, '0');
  const minute = String(createdAt.getMinutes()).padStart(2, '0');
  return sameDay ? `${hour}:${minute}` : `${month}-${day} ${hour}:${minute}`;
}

function extractFirstUserMessage(historiesBySessionId = {}, sessionIds = []) {
  for (const sessionId of sessionIds) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      if (event?.type !== 'message' || event?.role !== 'user') continue;
      const content = normalizeInlineMarkdown(event?.content || '');
      if (content) return content;
    }
  }
  return '';
}

function extractAssistantSummaryLines(historiesBySessionId = {}, sessionIds = []) {
  const flattened = [];
  for (const sessionId of sessionIds) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      flattened.push({
        timestamp: Number.isFinite(event?.timestamp) ? event.timestamp : 0,
        sessionId,
        event,
      });
    }
  }
  flattened.sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));
  const summaries = [];
  for (const item of flattened) {
    const event = item.event;
    if (event?.type !== 'message' || event?.role !== 'assistant') continue;
    const content = normalizeInlineMarkdown(
      stripTaskCardFromAssistantContent(
        stripGraphOpsFromAssistantContent(event?.content || ''),
      ),
    );
    if (!content) continue;
    if (!pushUnique(summaries, content, 3)) break;
    if (summaries.length >= 2) break;
  }
  return summaries;
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

function resolveProjectName(rootSession) {
  return trimText(rootSession?.sessionState?.longTerm?.rootTitle || '');
}

function buildJournalBodyText(title, objective, workSummaryLines, taskCard) {
  const seen = new Set();
  const addUnique = (entry) => {
    if (!entry) return false;
    if (textEquivalent(entry, title)) return false;
    const key = trimText(entry).toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  // 优先用结构化结论，有结论时不再追加 assistant 摘要和 objective
  const conclusions = taskCard.knownConclusions.filter(addUnique);
  if (conclusions.length > 0) {
    return `${title}，${conclusions.join('，')}`;
  }

  // 没有结论时降级到 assistant 摘要，再降级到 objective
  const fallbacks = [...workSummaryLines, objective].filter(addUnique);
  if (fallbacks.length > 0) {
    return `${title}，${fallbacks[0]}`;
  }

  return title;
}

function buildSessionDeletionJournalEntry({
  rootSession = null,
  relatedSessions = [],
  historiesBySessionId = {},
  deletedSessionIds = [],
  now = new Date(),
} = {}) {
  const rootId = trimText(rootSession?.id);
  const title = clipText(trimText(rootSession?.name) || '未命名任务', 120);
  const orderedSessionIds = [
    rootId,
    ...(Array.isArray(deletedSessionIds) ? deletedSessionIds : []).filter((sessionId) => trimText(sessionId) && trimText(sessionId) !== rootId),
  ].filter(Boolean);
  const taskCard = mergeTaskCardSignals(rootSession, relatedSessions);
  const firstUserMessage = extractFirstUserMessage(historiesBySessionId, orderedSessionIds);
  const objective = clipText(
    taskCard.goal
      || taskCard.mainGoal
      || trimText(rootSession?.description)
      || firstUserMessage,
    160,
  );
  const workSummaryLines = extractAssistantSummaryLines(historiesBySessionId, orderedSessionIds);

  const { timeLabel } = formatLocalDateParts(now);
  const projectName = resolveProjectName(rootSession);
  const emoji = inferActivityEmoji([title, objective, taskCard.knownConclusions[0]]);
  const bodyText = buildJournalBodyText(title, objective, workSummaryLines, taskCard);
  const createdAt = extractSessionCreatedAt(historiesBySessionId, orderedSessionIds);
  const createdAtLabel = formatCreatedAtLabel(createdAt, now);
  const durationLabel = createdAt ? formatDuration(createdAt, now) : '';
  const timeRange = createdAtLabel ? `${createdAtLabel}-${timeLabel}` : timeLabel;
  const timePart = durationLabel ? `${timeRange} (${durationLabel})` : timeRange;
  const tag = projectName ? `${emoji} ${projectName}` : emoji;
  const startMarker = `<!-- melodysync:session:${rootId}:start -->`;
  const endMarker = `<!-- melodysync:session:${rootId}:end -->`;

  const lines = [
    startMarker,
    `- ${timePart} [${tag}] ${clipText(bodyText, 200)}`,
    endMarker,
  ];

  return lines;
}

function findHeadingLineIndex(lines, heading, start = 0, end = lines.length) {
  for (let index = start; index < end; index += 1) {
    if (trimText(lines[index]) === heading) {
      return index;
    }
  }
  return -1;
}

function findNextHeadingLineIndex(lines, start = 0, prefixes = []) {
  for (let index = start; index < lines.length; index += 1) {
    const line = trimText(lines[index]);
    if (prefixes.some((prefix) => line.startsWith(prefix))) {
      return index;
    }
  }
  return lines.length;
}

function trimBlankEdgeLines(lines = []) {
  const next = [...lines];
  while (next.length > 0 && trimText(next[0]) === '') {
    next.shift();
  }
  while (next.length > 0 && trimText(next[next.length - 1]) === '') {
    next.pop();
  }
  return next;
}

function removeSessionEntryBlock(lines = [], sessionId = '') {
  const startMarker = `<!-- melodysync:session:${sessionId}:start -->`;
  const endMarker = `<!-- melodysync:session:${sessionId}:end -->`;
  const startIndex = findHeadingLineIndex(lines, startMarker);
  if (startIndex === -1) {
    return trimBlankEdgeLines(lines);
  }
  const endIndex = findHeadingLineIndex(lines, endMarker, startIndex + 1);
  if (endIndex === -1) {
    return trimBlankEdgeLines(lines.filter((_, index) => index < startIndex || index > startIndex));
  }
  return trimBlankEdgeLines([
    ...lines.slice(0, startIndex),
    ...lines.slice(endIndex + 1),
  ]);
}

function upsertEntryIntoNote(noteText, sessionId, entryLines) {
  const lines = String(noteText || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 1 && lines[0] === '') {
    lines.pop();
  }

  const agentNotesIndex = findHeadingLineIndex(lines, AGENT_NOTES_HEADING);
  if (agentNotesIndex === -1) {
    const nextLines = trimBlankEdgeLines(lines);
    if (nextLines.length > 0) {
      nextLines.push('');
    }
    nextLines.push(AGENT_NOTES_HEADING, '', MELODYSYNC_SECTION_HEADING, '', ...entryLines);
    return `${nextLines.join('\n')}\n`;
  }

  const agentNotesEnd = findNextHeadingLineIndex(lines, agentNotesIndex + 1, ['## ']);
  const subsectionIndex = findHeadingLineIndex(lines, MELODYSYNC_SECTION_HEADING, agentNotesIndex + 1, agentNotesEnd);

  if (subsectionIndex === -1) {
    const insertAt = agentNotesEnd;
    const block = [MELODYSYNC_SECTION_HEADING, '', ...entryLines];
    const prefix = insertAt > 0 && trimText(lines[insertAt - 1]) !== '' ? [''] : [];
    const suffix = insertAt < lines.length && trimText(lines[insertAt]) !== '' ? [''] : [];
    const nextLines = [
      ...lines.slice(0, insertAt),
      ...prefix,
      ...block,
      ...suffix,
      ...lines.slice(insertAt),
    ];
    return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  const subsectionEnd = findNextHeadingLineIndex(lines, subsectionIndex + 1, ['### ', '## ']);
  const subsectionBody = lines.slice(subsectionIndex + 1, subsectionEnd);
  const nextBody = removeSessionEntryBlock(subsectionBody, sessionId);
  const rebuiltBody = nextBody.length > 0
    ? ['', ...nextBody, '', ...entryLines]
    : ['', ...entryLines];
  const nextLines = [
    ...lines.slice(0, subsectionIndex + 1),
    ...rebuiltBody,
    ...lines.slice(subsectionEnd),
  ];
  return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export async function resolveSessionDeletionJournalPath(now = new Date()) {
  const vaultRoot = await resolveJournalVaultRoot();
  const { year, fileName } = formatLocalDateParts(now);
  return {
    vaultRoot,
    notePath: join(vaultRoot, ...JOURNAL_DIR_SEGMENTS, year, fileName),
  };
}

export async function writeSessionDeletionJournalEntry(payload = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const { vaultRoot, notePath } = await resolveSessionDeletionJournalPath(now);
  const openVault = typeof options.openVault === 'function' ? options.openVault : openObsidianVault;

  if (!await pathExists(notePath)) {
    await openVault(vaultRoot);
    throw createDeleteError(`未找到今日日记文件：${notePath}。已打开 Obsidian，请先创建对应日记后再删除任务。`, 409);
  }

  const noteText = await readFile(notePath, 'utf8');
  const rootSession = payload?.rootSession || null;
  const sessionId = trimText(rootSession?.id);
  if (!sessionId) {
    throw createDeleteError('无法写入删除日记：缺少 session id。', 500);
  }

  const entryLines = buildSessionDeletionJournalEntry({
    ...payload,
    now,
  });
  const nextText = upsertEntryIntoNote(noteText, sessionId, entryLines);
  if (nextText !== noteText.replace(/\r\n/g, '\n')) {
    await writeTextAtomic(notePath, nextText);
  }

  return {
    notePath,
    changed: nextText !== noteText.replace(/\r\n/g, '\n'),
  };
}

export { buildSessionDeletionJournalEntry };
