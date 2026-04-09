const GRAPH_OPS_TAG = 'graph_ops';
const MAX_GRAPH_OPS = 8;
const MAX_GRAPH_REF_CHARS = 160;
const MAX_GRAPH_REASON_CHARS = 240;

function clipText(value, maxChars) {
  const text = typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
    : '';
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function extractTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<(?:\\\\/|/)${tagName}>`, 'i'));
  return (match ? match[1] : '').trim();
}

function parseJsonObjectText(modelText) {
  const text = typeof modelText === 'string' ? modelText.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function cleanupGraphOpsGapText(value) {
  return String(value || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeGraphOpType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if ([
    'attach',
    'reparent',
    'move_under',
    'attach_under',
    '挂到',
    '挂载',
    '改挂载',
    '改挂到',
  ].includes(normalized)) {
    return 'attach';
  }
  if ([
    'promote_main',
    'promote',
    'detach',
    'main',
    'root',
    '移出主线',
    '提升为主线',
  ].includes(normalized)) {
    return 'promote_main';
  }
  if ([
    'archive',
    'delete',
    'remove',
    'discard',
    'dedupe',
    'merge_delete',
    '归档',
    '删除',
    '移除',
    '融合删除',
  ].includes(normalized)) {
    return 'archive';
  }
  return '';
}

function normalizeGraphSessionRef(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const ref = clipText(value, MAX_GRAPH_REF_CHARS);
    return ref ? { ref } : null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const sessionId = clipText(
    value.sessionId
      || value.id
      || '',
    MAX_GRAPH_REF_CHARS,
  );
  const title = clipText(
    value.title
      || value.name
      || value.goal
      || '',
    MAX_GRAPH_REF_CHARS,
  );
  const ref = clipText(
    value.ref
      || title
      || sessionId
      || '',
    MAX_GRAPH_REF_CHARS,
  );
  if (!ref && !sessionId && !title) return null;
  return {
    ...(ref ? { ref } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(title ? { title } : {}),
  };
}

function normalizeGraphOperation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = normalizeGraphOpType(value.type || value.action || value.op || value.kind);
  if (!type) return null;

  const source = normalizeGraphSessionRef(
    value.source
      || value.session
      || value.sessionRef
      || value.sourceSession
      || value.sourceRef
      || value.from
      || (value.sessionId || value.id ? { sessionId: value.sessionId || value.id } : null),
  );
  if (!source) return null;

  const target = normalizeGraphSessionRef(
    value.target
      || value.targetSession
      || value.targetRef
      || value.parent
      || value.parentSession
      || value.parentRef
      || value.to,
  );
  if (type === 'attach' && !target) return null;

  return {
    type,
    source,
    ...(target ? { target } : {}),
    ...(clipText(value.reason || value.branchReason || value.note || value.summary || '', MAX_GRAPH_REASON_CHARS)
      ? { reason: clipText(value.reason || value.branchReason || value.note || value.summary || '', MAX_GRAPH_REASON_CHARS) }
      : {}),
  };
}

export function normalizeAssistantGraphOps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawOperations = Array.isArray(value.operations)
    ? value.operations
    : (Array.isArray(value.ops)
      ? value.ops
      : (value.operation ? [value.operation] : []));

  const operations = [];
  for (const rawOperation of rawOperations) {
    const normalized = normalizeGraphOperation(rawOperation);
    if (!normalized) continue;
    operations.push(normalized);
    if (operations.length >= MAX_GRAPH_OPS) break;
  }

  if (operations.length === 0) return null;
  return {
    version: 1,
    operations,
  };
}

export function parseGraphOpsFromAssistantContent(content) {
  const block = extractTaggedBlock(content, GRAPH_OPS_TAG);
  if (!block) return null;
  return normalizeAssistantGraphOps(parseJsonObjectText(block));
}

export function stripGraphOpsFromAssistantContent(content) {
  let text = typeof content === 'string' ? content : '';
  if (!text) return '';

  text = text
    .replace(
      /<private>\s*<graph_ops>[\s\S]*?<(?:\\\/|\/)graph_ops>\s*<(?:\\\/|\/)private>/gi,
      '',
    )
    .replace(/<graph_ops>[\s\S]*?<(?:\\\/|\/)graph_ops>/gi, '')
    .replace(/<private>\s*<(?:\\\/|\/)private>/gi, '');

  return cleanupGraphOpsGapText(text);
}

export { GRAPH_OPS_TAG };
