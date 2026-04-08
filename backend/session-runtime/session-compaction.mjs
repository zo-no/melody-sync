import { buildTemplateFreshnessNotice } from '../session/continuation.mjs';
import { formatAttachmentContextLine } from '../attachment-utils.mjs';

export function clipCompactionSection(value, maxChars = 12000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by MelodySync ...]\n${text.slice(-tailChars).trimStart()}`;
}

function extractTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'i'));
  return (match ? match[1] : '').trim();
}

export function parseCompactionWorkerOutput(content) {
  return {
    summary: extractTaggedBlock(content, 'summary'),
    handoff: extractTaggedBlock(content, 'handoff'),
  };
}

export function buildFallbackCompactionHandoff(summary, toolIndex) {
  const parts = [
    '# Auto Compress',
    '',
    '## Kept in live context',
    '- MelodySync carried forward a compressed continuation summary for the task.',
  ];

  const trimmedSummary = clipCompactionSection(summary, 3000);
  if (trimmedSummary) {
    parts.push('', trimmedSummary);
  }

  parts.push('', '## Left out of live context', '- Older messages above the marker are no longer loaded into the model\'s live context.');
  if (toolIndex) {
    parts.push('- Earlier tool activity remains in session history and is summarized as compact retrieval hints.');
  }
  parts.push('', '## Continue from here', '- Use the carried-forward summary plus the new messages below this marker.');
  return parts.join('\n');
}

export function buildContextCompactionPrompt({ session, existingSummary, existingHandoff, conversationBody, toolIndex, automatic = false }) {
  const sessionInstructions = clipCompactionSection(session?.systemPrompt || '', 6000);
  const priorSummary = clipCompactionSection(existingSummary || '', 12000);
  const priorHandoff = clipCompactionSection(existingHandoff || '', 12000);
  const conversationSlice = clipCompactionSection(conversationBody || '', 18000);
  const toolActivity = clipCompactionSection(toolIndex || '', 10000);

  return [
    'Please compress this entire session into a continuation summary for the same AI worker.',
    '',
    'You are operating inside MelodySync\'s hidden compaction worker for a parent session.',
    `Compaction trigger: ${automatic ? 'automatic auto-compress' : 'manual compact request'}`,
    '',
    'Goal:',
    '- Replace older live context with a fresh continuation package.',
    '- Preserve only what the next worker turn truly needs.',
    '- Treat older tool activity as retrievable hints, not as live prompt material.',
    '',
    'Rules:',
    '- Use only the supplied session material; do not rely on prior thread state.',
    '- Do not call tools unless absolutely necessary.',
    '- Do not include full raw tool output.',
    '- Mark uncertainty clearly.',
    '- When a previous handoff is present, treat it as the primary carry-forward context and use the prior summary only as fallback.',
    '- The user-visible handoff must explicitly say that older messages above the marker are no longer in live context.',
    '',
    'Return exactly two tagged blocks:',
    '<summary>',
    'Dense operational continuation state for the next worker turn.',
    'Include the main objective, confirmed constraints, completed work, current code/system state, open questions, next steps, and critical references.',
    '</summary>',
    '',
    '<handoff>',
    '# Auto Compress',
    '## Kept in live context',
    '- ...',
    '## Left out of live context',
    '- ...',
    '## Continue from here',
    '- ...',
    '</handoff>',
    '',
    'Parent session instructions:',
    sessionInstructions || '[none]',
    '',
    'Previously carried handoff:',
    priorHandoff || '[none]',
    '',
    'Previously carried summary:',
    priorSummary || '[none]',
    '',
    'New conversation slice since the last compaction:',
    conversationSlice || '[no new conversation messages]',
    '',
    'Earlier tool activity index:',
    toolActivity || '[no earlier tool activity recorded]',
  ].join('\n');
}

function normalizeCompactionText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function clipCompactionEventText(value, maxChars = 4000) {
  const text = normalizeCompactionText(value);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by MelodySync ...]\n${text.slice(-tailChars).trimStart()}`;
}

function formatCompactionAttachments(images) {
  return formatAttachmentContextLine(images);
}

function formatCompactionMessage(evt) {
  const label = evt.role === 'user' ? 'User' : 'Assistant';
  const parts = [];
  const imageLine = formatCompactionAttachments(evt.images);
  if (imageLine) parts.push(imageLine);
  const content = clipCompactionEventText(evt.content);
  if (content) parts.push(content);
  if (parts.length === 0) return '';
  return `[${label}]\n${parts.join('\n')}`;
}

function formatCompactionTemplateContext(evt) {
  const content = normalizeCompactionText(evt.content);
  if (!content) return '';
  const name = normalizeCompactionText(evt.templateName) || 'template';
  const freshnessNotice = buildTemplateFreshnessNotice(evt);
  return freshnessNotice
    ? `[Applied template context: ${name}]\n${freshnessNotice}\n\n${content}`
    : `[Applied template context: ${name}]\n${content}`;
}

function formatCompactionStatus(evt) {
  const content = clipCompactionEventText(evt.content, 1000);
  if (!content) return '';
  if (!/^error:/i.test(content) && !/interrupted/i.test(content)) return '';
  return `[System status]\n${content}`;
}

export function prepareConversationOnlyContinuationBody(events) {
  const segments = (events || [])
    .map((evt) => {
      if (!evt || !evt.type) return '';
      if (evt.type === 'message') return formatCompactionMessage(evt);
      if (evt.type === 'template_context') return formatCompactionTemplateContext(evt);
      if (evt.type === 'status') return formatCompactionStatus(evt);
      return '';
    })
    .filter(Boolean);

  if (segments.length === 0) return '';
  return clipCompactionSection(segments.join('\n\n'), 24000);
}

export function buildToolActivityIndex(events) {
  const toolCounts = new Map();
  const recentCommands = [];
  const touchedFiles = [];
  const notableFailures = [];

  const pushRecentUnique = (entries, key, value, maxEntries) => {
    if (!key || !value) return;
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }
    entries.push({ key, value });
    if (entries.length > maxEntries) {
      entries.shift();
    }
  };

  for (const evt of events || []) {
    if (!evt || !evt.type) continue;
    if (evt.type === 'tool_use') {
      const toolName = normalizeCompactionText(evt.toolName) || 'tool';
      toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
      const toolInput = clipCompactionEventText(evt.toolInput, 240);
      if (toolInput) {
        pushRecentUnique(recentCommands, `${toolName}:${toolInput}`, `- ${toolName}: ${toolInput.replace(/\n/g, ' ↵ ')}`, 8);
      }
      continue;
    }
    if (evt.type === 'file_change') {
      const filePath = normalizeCompactionText(evt.filePath);
      if (!filePath) continue;
      const changeType = normalizeCompactionText(evt.changeType) || 'updated';
      pushRecentUnique(touchedFiles, `${changeType}:${filePath}`, `- ${filePath} (${changeType})`, 12);
      continue;
    }
    if (evt.type === 'tool_result') {
      const exitCode = evt.exitCode;
      if (exitCode === undefined || exitCode === 0) continue;
      const toolName = normalizeCompactionText(evt.toolName) || 'tool';
      const output = clipCompactionEventText(evt.output, 320);
      pushRecentUnique(notableFailures, `${toolName}:${exitCode}:${output}`, `- ${toolName} exit ${exitCode}: ${output.replace(/\n/g, ' ↵ ')}`, 6);
    }
  }

  const toolSummary = [...toolCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([toolName, count]) => `${toolName} ×${count}`)
    .join(', ');

  const lines = [];
  if (toolSummary) lines.push(`Tools used: ${toolSummary}`);
  if (recentCommands.length > 0) {
    lines.push('Recent tool calls:');
    lines.push(...recentCommands.map((entry) => entry.value));
  }
  if (touchedFiles.length > 0) {
    lines.push('Touched files:');
    lines.push(...touchedFiles.map((entry) => entry.value));
  }
  if (notableFailures.length > 0) {
    lines.push('Notable tool failures:');
    lines.push(...notableFailures.map((entry) => entry.value));
  }

  if (lines.length === 0) return '';
  return clipCompactionSection(lines.join('\n'), 12000);
}
