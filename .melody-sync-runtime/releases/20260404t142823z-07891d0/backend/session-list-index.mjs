function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeInline(value) {
  return String(value || '').replace(/\r?\n+/g, ' ').trim();
}

function formatTimestamp(value) {
  const text = trimText(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toISOString();
}

function getSortTime(entry) {
  const text = trimText(entry?.updatedAt || entry?.created || '');
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSessionLine(entry) {
  const parts = [
    `\`${escapeInline(entry?.id || '')}\``,
    escapeInline(entry?.name || '未命名会话'),
  ];
  const updatedAt = formatTimestamp(entry?.updatedAt || entry?.created || '');
  if (updatedAt) parts.push(`更新于 ${updatedAt}`);
  const group = trimText(entry?.group);
  if (group) parts.push(`分组：${escapeInline(group)}`);
  const tool = trimText(entry?.tool);
  if (tool) parts.push(`工具：${escapeInline(tool)}`);
  const internalRole = trimText(entry?.internalRole);
  if (internalRole) parts.push(`internalRole: \`${escapeInline(internalRole)}\``);
  return `- ${parts.join(' · ')}`;
}

function buildSection(title, entries, emptyText) {
  const lines = [`## ${title}`, ''];
  if (!entries.length) {
    lines.push(emptyText, '');
    return lines;
  }
  for (const entry of entries) {
    lines.push(buildSessionLine(entry));
  }
  lines.push('');
  return lines;
}

export function buildSessionsIndexMarkdown(list = []) {
  const entries = Array.isArray(list) ? list.filter((entry) => entry && typeof entry === 'object') : [];
  const sorted = [...entries].sort((a, b) => getSortTime(b) - getSortTime(a));
  const visibleSessions = sorted.filter((entry) => !trimText(entry?.internalRole) && entry?.archived !== true);
  const archivedSessions = sorted.filter((entry) => !trimText(entry?.internalRole) && entry?.archived === true);
  const internalSessions = sorted.filter((entry) => !!trimText(entry?.internalRole));

  const lines = [
    '# Sessions',
    '',
    '这是 MelodySync 当前应用目录里的会话索引。',
    '',
    '- 源真值：`sessions/chat-sessions.json`',
    '- 网页会话列表默认只显示“用户会话”，不会显示内部会话',
    `- 生成时间：${new Date().toISOString()}`,
    '',
    ...buildSection('用户会话', visibleSessions, '- 当前没有可见会话'),
    ...buildSection('归档会话', archivedSessions, '- 当前没有归档会话'),
    ...buildSection('内部会话', internalSessions, '- 当前没有内部会话'),
  ];

  return `${lines.join('\n').trimEnd()}\n`;
}
