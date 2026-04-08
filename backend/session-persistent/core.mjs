import { normalizeSessionTaskCard } from '../session/task-card.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';

const MAX_DIGEST_TEXT_CHARS = 280;
const MAX_DIGEST_ITEM_CHARS = 140;
const MAX_DIGEST_ITEMS = 6;
const MAX_MESSAGE_PREVIEW_CHARS = 120;

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clipText(value, maxChars) {
  const text = trimText(String(value || '').replace(/\s+/g, ' '));
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeIsoTimestamp(value) {
  const text = trimText(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeList(value, { maxItems = MAX_DIGEST_ITEMS, maxChars = MAX_DIGEST_ITEM_CHARS } = {}) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const items = [];
  const seen = new Set();
  for (const raw of source) {
    const normalized = clipText(String(raw || '').replace(/^[-*•]\s*/, ''), maxChars);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= maxItems) break;
  }
  return items;
}

function normalizePersistentKind(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['skill', 'long_skill', 'persistent_skill'].includes(normalized)) return 'skill';
  if (['recurring_task', 'recurring', 'scheduled_task', 'periodic_task'].includes(normalized)) {
    return 'recurring_task';
  }
  return '';
}

function normalizePersistentState(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['paused', 'pause', 'inactive'].includes(normalized)) return 'paused';
  return 'active';
}

function normalizeRuntimePolicyMode(value, allowedModes = [], fallback = '') {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  return allowedModes.includes(normalized) ? normalized : fallback;
}

function normalizeRuntimeSnapshot(value, fallback = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const requestedTool = trimText(source.tool || '');
  const fallbackTool = trimText(fallbackSource.tool || '');
  const tool = requestedTool || fallbackTool;
  if (!tool) return null;
  const canInheritFallback = !requestedTool || requestedTool === fallbackTool;
  return {
    tool,
    model: clipText(source.model || (canInheritFallback ? fallbackSource.model || '' : ''), 160),
    effort: clipText(source.effort || (canInheritFallback ? fallbackSource.effort || '' : ''), 80),
    thinking: Object.prototype.hasOwnProperty.call(source, 'thinking')
      ? source.thinking === true
      : (canInheritFallback ? fallbackSource.thinking === true : false),
  };
}

function getDefaultRuntimePolicy(kind, defaultRuntime = null) {
  const fallbackRuntime = normalizeRuntimeSnapshot(defaultRuntime);
  const policy = {
    manual: {
      mode: 'follow_current',
    },
  };
  if (kind === 'recurring_task') {
    policy.schedule = {
      mode: fallbackRuntime ? 'pinned' : 'session_default',
      ...(fallbackRuntime ? { runtime: fallbackRuntime } : {}),
    };
  }
  return policy;
}

function normalizeRuntimeRule(
  value,
  {
    allowedModes = [],
    defaultMode = '',
    defaultRuntime = null,
  } = {},
) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = normalizeRuntimePolicyMode(
    source.mode || source.strategy || source.type || '',
    allowedModes,
    defaultMode,
  );
  const normalized = { mode };
  if (mode === 'pinned') {
    const runtime = normalizeRuntimeSnapshot(
      source.runtime || source.pinnedRuntime || source.snapshot || null,
      defaultRuntime,
    );
    if (runtime) {
      normalized.runtime = runtime;
    }
  }
  return normalized;
}

function normalizePersistentRuntimePolicy(value, { kind, defaultRuntime } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackPolicy = getDefaultRuntimePolicy(kind, defaultRuntime);
  const fallbackRuntime = normalizeRuntimeSnapshot(defaultRuntime);

  const manual = normalizeRuntimeRule(
    source.manual || {
      mode: source.manualMode || fallbackPolicy.manual?.mode || 'follow_current',
      runtime: source.manualRuntime || source.runtime || source.pinnedRuntime || null,
    },
    {
      allowedModes: ['follow_current', 'session_default', 'pinned'],
      defaultMode: fallbackPolicy.manual?.mode || 'follow_current',
      defaultRuntime: fallbackRuntime,
    },
  );

  const normalized = {
    manual: manual.mode === 'pinned' && !manual.runtime
      ? { mode: fallbackPolicy.manual?.mode || 'follow_current' }
      : manual,
  };

  if (kind === 'recurring_task') {
    const scheduleFallbackMode = fallbackPolicy.schedule?.mode || 'session_default';
    const scheduleFallbackRuntime = fallbackPolicy.schedule?.runtime || fallbackRuntime;
    const schedule = normalizeRuntimeRule(
      source.schedule || {
        mode: source.scheduleMode || scheduleFallbackMode,
        runtime: source.scheduleRuntime || source.runtime || source.pinnedRuntime || null,
      },
      {
        allowedModes: ['session_default', 'pinned'],
        defaultMode: scheduleFallbackMode,
        defaultRuntime: scheduleFallbackRuntime,
      },
    );
    normalized.schedule = schedule.mode === 'pinned' && !schedule.runtime
      ? { mode: 'session_default' }
      : schedule;
  }

  return normalized;
}

function normalizeRecurringCadence(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'weekly') return 'weekly';
  return 'daily';
}

function normalizeTimeOfDay(value) {
  const text = trimText(value);
  if (!text) return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeWeekdays(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'number' ? [value] : []);
  const normalized = [];
  const seen = new Set();
  for (const raw of source) {
    const weekday = typeof raw === 'number'
      ? raw
      : Number.parseInt(String(raw || '').trim(), 10);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) continue;
    seen.add(weekday);
    normalized.push(weekday);
  }
  normalized.sort((a, b) => a - b);
  return normalized;
}

function parseTimeOfDay(timeOfDay) {
  const normalized = normalizeTimeOfDay(timeOfDay);
  if (!normalized) return null;
  const [hourText, minuteText] = normalized.split(':');
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10),
    normalized,
  };
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function buildDateAtLocalTime(baseDate, hour, minute) {
  const next = new Date(baseDate.getTime());
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function computeNextRecurringRunAt(recurring = {}, fromValue = new Date()) {
  const parsedFrom = parseDate(fromValue);
  if (!parsedFrom) return '';
  const cadence = normalizeRecurringCadence(recurring?.cadence || recurring?.type || '');
  const time = parseTimeOfDay(recurring?.timeOfDay || recurring?.time || '');
  if (!time) return '';

  if (cadence === 'weekly') {
    const weekdays = normalizeWeekdays(recurring?.weekdays);
    const targetDays = weekdays.length > 0 ? weekdays : [parsedFrom.getDay()];
    for (let offset = 0; offset < 14; offset += 1) {
      const candidateDate = new Date(parsedFrom.getTime());
      candidateDate.setDate(candidateDate.getDate() + offset);
      if (!targetDays.includes(candidateDate.getDay())) continue;
      const candidate = buildDateAtLocalTime(candidateDate, time.hour, time.minute);
      if (candidate.getTime() > parsedFrom.getTime()) {
        return candidate.toISOString();
      }
    }
    return '';
  }

  const sameDay = buildDateAtLocalTime(parsedFrom, time.hour, time.minute);
  if (sameDay.getTime() > parsedFrom.getTime()) {
    return sameDay.toISOString();
  }
  const nextDay = new Date(parsedFrom.getTime());
  nextDay.setDate(nextDay.getDate() + 1);
  return buildDateAtLocalTime(nextDay, time.hour, time.minute).toISOString();
}

function defaultRunPrompt(kind, digest = {}) {
  const title = clipText(digest?.title || digest?.goal || '当前长期项', 80);
  const summary = clipText(digest?.summary || '', 160);
  if (kind === 'recurring_task') {
    return clipText(
      `请按这个长期任务的沉淀定义执行本轮产出。先回忆沉淀摘要，再给出当前这一轮的结果。${title ? ` 任务：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
      240,
    );
  }
  return clipText(
    `请按这个快捷按钮的沉淀定义执行当前触发。先回忆摘要，再完成这次执行。${title ? ` 名称：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
    240,
  );
}

function normalizePersistentDigest(value, fallback = {}) {
  const digest = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  return {
    title: clipText(digest.title || fallback.title || '', 120),
    summary: clipText(digest.summary || fallback.summary || '', MAX_DIGEST_TEXT_CHARS),
    goal: clipText(digest.goal || fallback.goal || '', 180),
    keyPoints: normalizeList(digest.keyPoints || fallback.keyPoints),
    recipe: normalizeList(digest.recipe || fallback.recipe),
  };
}

function normalizePersistentExecution(value, { kind, digest } = {}) {
  const execution = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const mode = trimText(execution.mode).toLowerCase() === 'spawn_session'
    ? 'spawn_session'
    : 'in_place';
  return {
    mode,
    runPrompt: clipText(execution.runPrompt || defaultRunPrompt(kind, digest), 240),
    lastTriggerAt: normalizeIsoTimestamp(execution.lastTriggerAt),
    lastTriggerKind: trimText(execution.lastTriggerKind).toLowerCase() === 'schedule'
      ? 'schedule'
      : (trimText(execution.lastTriggerKind).toLowerCase() === 'manual' ? 'manual' : ''),
  };
}

function normalizePersistentRecurring(value, options = {}) {
  const recurring = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const cadence = normalizeRecurringCadence(recurring.cadence || recurring.type || '');
  const timeOfDay = normalizeTimeOfDay(recurring.timeOfDay || recurring.time || '');
  if (!timeOfDay) return null;
  const normalized = {
    cadence,
    timeOfDay,
    weekdays: cadence === 'weekly' ? normalizeWeekdays(recurring.weekdays) : [],
    timezone: clipText(recurring.timezone || options.defaultTimezone || '', 80),
    nextRunAt: normalizeIsoTimestamp(recurring.nextRunAt),
    lastRunAt: normalizeIsoTimestamp(recurring.lastRunAt),
  };
  if (options.recomputeNextRunAt || !normalized.nextRunAt) {
    normalized.nextRunAt = computeNextRecurringRunAt(normalized, options.referenceTime || new Date());
  }
  return normalized;
}

export function normalizeSessionPersistent(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = normalizePersistentKind(value.kind || value.type || '');
  if (!kind) return null;

  const digest = normalizePersistentDigest(value.digest, options.defaultDigest || {});
  const defaultRuntime = normalizeRuntimeSnapshot(
    options.defaultRuntime || value.runtime || value.execution?.runtime || null,
  );
  const normalized = {
    version: 1,
    kind,
    state: normalizePersistentState(value.state),
    promotedAt: normalizeIsoTimestamp(value.promotedAt || options.now),
    updatedAt: normalizeIsoTimestamp(value.updatedAt || options.now),
    digest,
    execution: normalizePersistentExecution(value.execution, { kind, digest }),
    runtimePolicy: normalizePersistentRuntimePolicy(value.runtimePolicy, {
      kind,
      defaultRuntime,
    }),
  };

  if (kind === 'recurring_task') {
    const recurring = normalizePersistentRecurring(value.recurring || value.schedule, options);
    if (!recurring) return null;
    normalized.recurring = recurring;
  } else {
    const skill = value.skill && typeof value.skill === 'object' && !Array.isArray(value.skill)
      ? value.skill
      : {};
    const lastUsedAt = normalizeIsoTimestamp(skill.lastUsedAt || value.lastUsedAt);
    if (lastUsedAt) {
      normalized.skill = { lastUsedAt };
    }
  }

  return normalized;
}

function extractUserMessagePreviews(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((event) => event?.type === 'message' && event?.role === 'user')
    .map((event) => clipText(event?.content || '', MAX_MESSAGE_PREVIEW_CHARS))
    .filter(Boolean);
}

export function buildPersistentDigest(session = {}, history = []) {
  const taskCard = normalizeSessionTaskCard(session?.taskCard || {}) || {};
  const sessionState = resolveSessionStateFromSession(session) || {};
  const explicitSessionState = session?.sessionState && typeof session.sessionState === 'object' && !Array.isArray(session.sessionState)
    ? session.sessionState
    : {};
  const userMessagePreviews = extractUserMessagePreviews(history);
  const stateMainGoal = clipText(sessionState.mainGoal || '', 120);
  const stateGoal = clipText(sessionState.goal || '', 180);
  const stateCheckpoint = clipText(sessionState.checkpoint || '', MAX_DIGEST_TEXT_CHARS);
  const explicitStateCheckpoint = clipText(explicitSessionState.checkpoint || '', MAX_DIGEST_TEXT_CHARS);
  const title = clipText(
    session?.name
      || stateMainGoal
      || taskCard.mainGoal
      || stateGoal
      || taskCard.goal
      || '',
    120,
  );
  const goal = clipText(
    stateGoal
      || stateMainGoal
      || taskCard.goal
      || taskCard.mainGoal
      || title,
    180,
  );
  const summary = clipText(
    stateCheckpoint
      || taskCard.checkpoint
      || taskCard.goal
      || taskCard.mainGoal
      || session?.description
      || userMessagePreviews.at(-1)
      || title,
    MAX_DIGEST_TEXT_CHARS,
  );
  const keyPoints = normalizeList([
    ...(Array.isArray(taskCard?.knownConclusions) ? taskCard.knownConclusions : []),
    ...(Array.isArray(taskCard?.memory) ? taskCard.memory : []),
    ...(userMessagePreviews.length > 0 && !(taskCard?.knownConclusions || []).length && !(taskCard?.memory || []).length
      ? userMessagePreviews.slice(-3)
      : []),
  ]);
  const recipe = normalizeList([
    ...(Array.isArray(taskCard?.nextSteps) ? taskCard.nextSteps : []),
    ...((taskCard?.checkpoint || explicitStateCheckpoint) ? [taskCard.checkpoint || explicitStateCheckpoint] : []),
  ]);
  return {
    title,
    summary,
    goal,
    keyPoints,
    recipe,
  };
}

export function isPersistentRecurringDue(persistent, nowValue = new Date()) {
  if (!persistent || persistent.kind !== 'recurring_task' || persistent.state !== 'active') return false;
  const nextRunAt = normalizeIsoTimestamp(persistent?.recurring?.nextRunAt);
  if (!nextRunAt) return false;
  const now = parseDate(nowValue);
  const dueAt = parseDate(nextRunAt);
  if (!now || !dueAt) return false;
  return dueAt.getTime() <= now.getTime();
}

export function buildPersistentRunMessage(session = {}, persistent = {}, options = {}) {
  const digest = normalizePersistentDigest(persistent?.digest, buildPersistentDigest(session));
  const runPrompt = clipText(
    options.runPrompt
      || persistent?.execution?.runPrompt
      || defaultRunPrompt(persistent?.kind, digest),
    240,
  );
  const triggerKind = trimText(options.triggerKind).toLowerCase() === 'schedule' ? '定时触发' : '手动触发';
  const lines = [
    persistent?.kind === 'recurring_task' ? '[长期任务执行]' : '[快捷按钮触发]',
    `名称：${digest.title || session?.name || '未命名长期项'}`,
    digest.summary ? `摘要：${digest.summary}` : '',
    digest.goal ? `目标：${digest.goal}` : '',
    digest.keyPoints.length > 0 ? `核心记录：\n- ${digest.keyPoints.join('\n- ')}` : '',
    digest.recipe.length > 0 ? `执行提示：\n- ${digest.recipe.join('\n- ')}` : '',
    `触发方式：${triggerKind}`,
    runPrompt,
  ].filter(Boolean);
  return lines.join('\n\n');
}

export function resolvePersistentRunRuntime(session = {}, persistent = {}, options = {}) {
  const sessionRuntime = normalizeRuntimeSnapshot(session);
  const normalizedPersistent = normalizeSessionPersistent(persistent, {
    defaultDigest: buildPersistentDigest(session),
    defaultRuntime: sessionRuntime,
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  });
  if (!normalizedPersistent) {
    return sessionRuntime;
  }
  const triggerKind = trimText(options.triggerKind).toLowerCase() === 'schedule' ? 'schedule' : 'manual';
  const requestedRuntime = normalizeRuntimeSnapshot(options.runtime, sessionRuntime);
  const runtimeRule = triggerKind === 'schedule'
    ? normalizedPersistent?.runtimePolicy?.schedule || { mode: 'session_default' }
    : normalizedPersistent?.runtimePolicy?.manual || { mode: 'follow_current' };
  if (triggerKind === 'manual' && runtimeRule.mode === 'follow_current') {
    return requestedRuntime || sessionRuntime;
  }
  if (runtimeRule.mode === 'pinned') {
    return normalizeRuntimeSnapshot(runtimeRule.runtime, sessionRuntime) || sessionRuntime;
  }
  return sessionRuntime;
}
