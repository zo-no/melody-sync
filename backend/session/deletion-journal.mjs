import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { MELODYSYNC_APP_ROOT } from '../../lib/config.mjs';
import { pathExists, writeTextAtomic } from '../fs-utils.mjs';
import { normalizeSessionTaskCard, stripTaskCardFromAssistantContent } from './task-card.mjs';

const JOURNAL_DIR_SEGMENTS = ['02-📓journal', '04-📂日记'];
const AGENT_NOTES_HEADING = '## Agent Notes';
const MELODYSYNC_SECTION_HEADING = '### MelodySync 工作记录';

function createDeleteError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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
    const content = normalizeInlineMarkdown(stripTaskCardFromAssistantContent(event?.content || ''));
    if (!content) continue;
    if (!pushUnique(summaries, content, 3)) break;
    if (summaries.length >= 2) break;
  }
  return summaries;
}

function collectTouchedPaths(rootSession, historiesBySessionId = {}, sessionIds = []) {
  const paths = [];
  if (trimText(rootSession?.folder)) {
    pushUnique(paths, `目录 ${trimText(rootSession.folder)}`, 6);
  }
  for (const sessionId of sessionIds) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      if (event?.type !== 'file_change') continue;
      const filePath = trimText(event?.filePath);
      if (!filePath) continue;
      if (!pushUnique(paths, filePath, 6)) break;
    }
    if (paths.length >= 4) break;
  }
  return paths.slice(0, 4);
}

function formatPathList(paths = []) {
  return paths
    .map((entry) => trimText(entry).replace(/`/g, ''))
    .filter(Boolean)
    .map((entry) => `\`${entry}\``)
    .join('、');
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
  if (workSummaryLines.length === 0 && objective) {
    workSummaryLines.push(`围绕「${objective}」推进并完成本次工作收束。`);
  }

  const touchedPaths = collectTouchedPaths(rootSession, historiesBySessionId, orderedSessionIds);
  const { timeLabel } = formatLocalDateParts(now);
  const startMarker = `<!-- melodysync:session:${rootId}:start -->`;
  const endMarker = `<!-- melodysync:session:${rootId}:end -->`;
  const lines = [
    startMarker,
    `#### ${timeLabel} ${title}`,
    objective && !textEquivalent(objective, title) ? `- 任务目标：${objective}` : '',
    workSummaryLines.length > 0 ? '- 工作总结：' : '',
    ...(workSummaryLines.length > 0 ? workSummaryLines.map((entry) => `  - ${entry}`) : []),
    taskCard.knownConclusions.length > 0 ? '- 关键结论：' : '',
    ...(taskCard.knownConclusions.length > 0 ? taskCard.knownConclusions.map((entry) => `  - ${entry}`) : []),
    touchedPaths.length > 0 ? `- 涉及路径：${formatPathList(touchedPaths)}` : '',
    deletedSessionIds.length > 1 ? `- 关联会话：${deletedSessionIds.length} 条（含 ${deletedSessionIds.length - 1} 条分支）` : '',
    endMarker,
  ].filter(Boolean);

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
