import { readFile } from 'fs/promises';
import { join } from 'path';

import { MEMORY_DIR, SYSTEM_MEMORY_DIR } from '../../lib/config.mjs';
import { createKeyedTaskQueue, ensureDir, pathExists, writeTextAtomic } from '../fs-utils.mjs';
import { stageWorkbenchMemoryCandidate } from '../workbench/memory-candidate-store.mjs';

const AGENT_PROFILE_MD = join(MEMORY_DIR, 'agent-profile.md');
const CONTEXT_DIGEST_MD = join(MEMORY_DIR, 'context-digest.md');
const PROJECTS_MD = join(MEMORY_DIR, 'projects.md');
const SKILLS_MD = join(MEMORY_DIR, 'skills.md');
const GLOBAL_MD = join(MEMORY_DIR, 'global.md');
const TASKS_DIR = join(MEMORY_DIR, 'tasks');
const WORKLOG_DIR = join(MEMORY_DIR, 'worklog');
const SYSTEM_MD = join(SYSTEM_MEMORY_DIR, 'system.md');

const memoryWriteQueue = createKeyedTaskQueue();

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeTarget(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  const compact = normalized.replace(/[`[\]()]/g, '').replace(/\s+/g, '');
  if (['agent-profile', 'agent-profile.md', 'profile'].includes(compact)) return 'agent-profile';
  if (['context-digest', 'context-digest.md', 'digest', 'context'].includes(compact)) return 'context-digest';
  if (['bootstrap', 'bootstrap.md'].includes(compact)) return 'bootstrap';
  if (['projects', 'projects.md', 'project'].includes(compact)) return 'projects';
  if (['skills', 'skills.md', 'skill'].includes(compact)) return 'skills';
  if (['tasks', 'tasks/', 'task'].includes(compact)) return 'tasks';
  if (['worklog', 'worklog/', 'log'].includes(compact)) return 'worklog';
  if (['global', 'global.md'].includes(compact)) return 'global';
  if (['system', 'system.md'].includes(compact)) return 'system';
  return '';
}

function normalizeCandidateStatus(value, { explicitTarget = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return explicitTarget ? 'active' : 'candidate';
  }
  if (['candidate', 'suggested', 'pending', 'review'].includes(normalized)) return 'candidate';
  if (['approved', 'approve', 'promoted'].includes(normalized)) return 'approved';
  if (['active', 'applied', 'writeback'].includes(normalized)) return 'active';
  if (['rejected', 'reject', 'dismissed'].includes(normalized)) return 'rejected';
  if (['invalidated', 'invalid', 'superseded'].includes(normalized)) return 'invalidated';
  if (['expired', 'stale'].includes(normalized)) return 'expired';
  return explicitTarget ? 'active' : 'candidate';
}

function isPromotableStatus(status) {
  return status === 'approved' || status === 'active';
}

function formatCandidateEntry(candidate = {}, { target = '', text = '', status = '' } = {}) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return '';

  const tags = [];
  const normalizedStatus = normalizeText(status);
  const normalizedTarget = normalizeText(target);
  const normalizedType = normalizeText(candidate.type);
  const normalizedScope = normalizeText(candidate.scope);
  const normalizedSource = normalizeText(candidate.source);
  const normalizedConfidence = typeof candidate.confidence === 'number'
    ? String(candidate.confidence)
    : normalizeText(candidate.confidence);
  const normalizedExpiresAt = normalizeText(candidate.expiresAt);

  if (normalizedStatus) tags.push(`status=${normalizedStatus}`);
  if (normalizedTarget) tags.push(`target=${normalizedTarget}`);
  if (normalizedType) tags.push(`type=${normalizedType}`);
  if (normalizedScope) tags.push(`scope=${normalizedScope}`);
  if (normalizedSource) tags.push(`source=${normalizedSource}`);
  if (normalizedConfidence) tags.push(`confidence=${normalizedConfidence}`);
  if (normalizedExpiresAt) tags.push(`expiresAt=${normalizedExpiresAt}`);

  const reason = normalizeText(candidate.reason);
  const prefix = tags.length > 0 ? `- [${tags.join(' | ')}] ` : '- ';
  return `${prefix}${normalizedText}${reason ? ` — ${reason}` : ''}`;
}

function stripTargetPrefix(text) {
  return normalizeMultilineText(
    String(text || '').replace(
      /^\s*(?:\[(agent-profile|context-digest|bootstrap|projects|skills|tasks|worklog|global|system)\]|(agent-profile|context-digest|bootstrap|projects|skills|tasks|worklog|global|system)\s*:)\s*/i,
      '',
    ),
  );
}

function inferTarget(candidate = {}) {
  const explicit = normalizeTarget(candidate.target || candidate.file || candidate.kind || candidate.memoryFile);
  if (explicit) return explicit;

  const text = normalizeText(candidate.text).toLowerCase();
  const source = normalizeText(candidate.source).toLowerCase();
  const scope = normalizeText(candidate.scope).toLowerCase();

  if (!text) return '';
  if (/\b(system|cross-deployment|shared pattern|platform-wide)\b/.test(text)) return 'system';
  if (/\b(prefers?|preference|default|boundary|style|工作方式|长期偏好|协作边界|默认偏好)\b/.test(text)) return 'agent-profile';
  if (/\b(workflow|sop|reusable|playbook|recipe|步骤|流程|复用)\b/.test(text)) return 'skills';
  if (/\b(checkpoint|next step|next steps|current task|resume|handoff|task note|任务|检查点|续接)\b/.test(text)) return 'tasks';
  if (/\b(worklog|today|today i|completed|changed|timeline|日志|今天|完成了|改了)\b/.test(text)) return 'worklog';
  if (
    /(?:\brepo\b|\brepository\b|\bpath\b|\bfolder\b|\btrigger\b|project pointer|项目入口|仓库路径|触发词)/.test(text)
    || text.includes('~/')
    || text.includes('/users/')
    || text.includes('`~/')
    || text.includes('`/')
  ) return 'projects';
  if (scope === 'project' && /\b(pattern|decision|constraint|conclusion|约定|结论|约束)\b/.test(text)) return 'context-digest';
  if (source === 'agent') return 'context-digest';
  return scope === 'project' ? 'projects' : 'context-digest';
}

function bulletize(text) {
  const normalized = normalizeText(text);
  return normalized ? `- ${normalized}` : '';
}

function appendSection(content, heading, line) {
  const nextLine = normalizeText(line);
  if (!nextLine) return content;
  const normalizedContent = String(content || '').replace(/\r\n/g, '\n');
  const lines = normalizedContent.split('\n');
  const normalizedNeedle = normalizeText(nextLine);
  if (lines.some((entry) => normalizeText(entry) === normalizedNeedle)) {
    return normalizedContent;
  }

  const headingLine = `## ${heading}`;
  const sectionIndex = lines.findIndex((entry) => normalizeText(entry) === normalizeText(headingLine));
  if (sectionIndex === -1) {
    const trimmed = normalizedContent.trimEnd();
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
  return join(WORKLOG_DIR, year, month, `${year}-${month}-${day}.md`);
}

async function writeTaskCandidate({ sessionId, sessionName, text }) {
  const targetPath = buildTaskMemoryPath(sessionId);
  const current = await readText(targetPath);
  const header = current.trim()
    ? current
    : `# Task Memory\n\n- Session ID: \`${normalizeText(sessionId) || 'unknown'}\`\n${sessionName ? `- Session: ${normalizeText(sessionName)}\n` : ''}`;
  const next = appendSection(header, 'Durable Memory', bulletize(text));
  if (next !== current) {
    await writeTextAtomic(targetPath, next);
  }
}

async function writeTaskCandidateEntry({ sessionId, sessionName, heading, line }) {
  const targetPath = buildTaskMemoryPath(sessionId);
  const current = await readText(targetPath);
  const header = current.trim()
    ? current
    : `# Task Memory\n\n- Session ID: \`${normalizeText(sessionId) || 'unknown'}\`\n${sessionName ? `- Session: ${normalizeText(sessionName)}\n` : ''}`;
  const next = appendSection(header, heading, line);
  if (next !== current) {
    await writeTextAtomic(targetPath, next);
  }
}

async function writeWorklogCandidate(text) {
  const targetPath = buildWorklogPath();
  const current = await readText(targetPath);
  const dateLabel = targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Worklog';
  const header = current.trim() ? current : `# ${dateLabel}\n`;
  const next = appendSection(header, 'Auto-captured', bulletize(text));
  if (next !== current) {
    await writeTextAtomic(targetPath, next);
  }
}

export async function applyMemoryCandidateWriteback(candidate, context = {}) {
  const explicitTarget = normalizeTarget(candidate.target || candidate.file || candidate.kind || candidate.memoryFile);
  const target = explicitTarget || inferTarget(candidate);
  const text = stripTargetPrefix(candidate.text);
  const status = normalizeCandidateStatus(candidate.status, { explicitTarget: !!explicitTarget });
  if (!target || !text) return false;

  if (!isPromotableStatus(status)) {
    await ensureDir(TASKS_DIR);
    await writeTaskCandidateEntry({
      sessionId: context.sessionId,
      sessionName: context.sessionName,
      heading: ['rejected', 'invalidated', 'expired'].includes(status)
        ? 'Rejected memory candidates'
        : 'Memory candidates',
      line: formatCandidateEntry(candidate, { target, text, status }),
    });
    await stageWorkbenchMemoryCandidate({
      ...candidate,
      sessionId: context.sessionId,
      sessionName: context.sessionName,
      target,
      text,
      status,
    });
    return true;
  }

  switch (target) {
    case 'agent-profile':
      await appendMarkdownLine(AGENT_PROFILE_MD, 'Auto-captured', bulletize(text));
      return true;
    case 'context-digest':
      await appendMarkdownLine(CONTEXT_DIGEST_MD, 'Auto-captured', bulletize(text), { updateDigestTimestamp: true });
      return true;
    case 'bootstrap':
      await appendMarkdownLine(join(MEMORY_DIR, 'bootstrap.md'), 'Auto-captured', bulletize(text));
      return true;
    case 'projects':
      await appendMarkdownLine(PROJECTS_MD, 'Auto-captured', bulletize(text));
      return true;
    case 'skills':
      await appendMarkdownLine(SKILLS_MD, 'Auto-captured', bulletize(text));
      return true;
    case 'tasks':
      await ensureDir(TASKS_DIR);
      await writeTaskCandidate({
        sessionId: context.sessionId,
        sessionName: context.sessionName,
        text,
      });
      return true;
    case 'worklog':
      await ensureDir(WORKLOG_DIR);
      await writeWorklogCandidate(text);
      return true;
    case 'global':
      await appendMarkdownLine(GLOBAL_MD, 'Auto-captured', bulletize(text));
      return true;
    case 'system':
      await appendMarkdownLine(SYSTEM_MD, 'Auto-captured', bulletize(text));
      return true;
    default:
      return false;
  }
}

export async function memoryWritebackHook({ sessionId, session, manifest, resultEnvelope } = {}) {
  if (manifest?.internalOperation) return;
  const candidates = Array.isArray(resultEnvelope?.memoryCandidates) ? resultEnvelope.memoryCandidates : [];
  if (candidates.length === 0) return;

  await memoryWriteQueue(sessionId || 'memory-writeback', async () => {
    if (!await pathExists(MEMORY_DIR)) return;
    for (const candidate of candidates) {
      try {
        await applyMemoryCandidateWriteback(candidate, {
          sessionId,
          sessionName: session?.name || '',
        });
      } catch (error) {
        console.error(`[memory-writeback] ${sessionId || 'session'}: ${error.message}`);
      }
    }
  });
}
