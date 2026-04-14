// ---- Task Type & Bucket Constants ----
// Single source of truth for persistent task kinds and bucket definitions.
// All frontend code should import from here instead of duplicating these mappings.

/**
 * Persistent task kind values.
 * Maps to backend persistent.kind field.
 */
const PERSISTENT_KINDS = Object.freeze({
  RECURRING: "recurring_task",
  SCHEDULED: "scheduled_task",
  WAITING: "waiting_task",
  SKILL: "skill",
});

/**
 * Long-term bucket keys.
 * Maps to taskPoolMembership.longTerm.bucket field.
 */
const BUCKET_KEYS = Object.freeze({
  LONG_TERM: "long_term",
  SHORT_TERM: "short_term",
  WAITING: "waiting",
  INBOX: "inbox",
  SKILL: "skill",
});

/**
 * Kind → display label mapping.
 * Used in task type picker, action buttons, and status display.
 */
const KIND_LABELS = Object.freeze({
  recurring_task: "长期任务",
  scheduled_task: "短期任务",
  waiting_task:   "等待任务",
  skill:          "AI快捷按钮",
});

/**
 * Kind → bucket mapping (default assignment when no explicit bucket set).
 */
const KIND_TO_BUCKET = Object.freeze({
  recurring_task: "long_term",
  scheduled_task: "short_term",
  waiting_task:   "waiting",
  skill:          "skill",
});

/**
 * Kind picker definitions — used in the task type chooser UI.
 */
const KIND_PICKER_DEFS = Object.freeze([
  { kind: "recurring_task", label: "长期任务", description: "按循环节奏持续执行，适合巡检、整理和长期维护。" },
  { kind: "scheduled_task", label: "短期任务", description: "在指定时间执行一次，适合到点处理的任务。" },
  { kind: "waiting_task",   label: "等待任务", description: "主要等待人类处理，但仍可一键触发梳理上下文。" },
  { kind: "skill",          label: "AI快捷按钮", description: "手动点击后触发，由 AI 执行一段可复用动作。" },
]);

/**
 * Bucket definitions in display order.
 * Used for rendering bucket sub-folders in the Projects tab.
 */
const BUCKET_DEFS = Object.freeze([
  { key: "long_term",  label: "长期任务", labelKey: "sidebar.group.longTerm",    order: 0 },
  { key: "short_term", label: "短期任务", labelKey: "sidebar.group.shortTerm",   order: 1 },
  { key: "waiting",    label: "等待任务", labelKey: "sidebar.group.waiting",     order: 2 },
  { key: "inbox",      label: "收集箱",   labelKey: "sidebar.group.inbox",       order: 3 },
  { key: "skill",      label: "快捷按钮", labelKey: "sidebar.group.quickActions", order: 4 },
]);

/**
 * Normalize a raw bucket string to a canonical bucket key.
 * Handles aliases, Chinese labels, and legacy values.
 * Returns "" if the value is not a recognized bucket.
 */
function normalizeBucket(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["long_term", "long_term_iteration", "long", "长期任务", "长期迭代"].includes(normalized)) return "long_term";
  if (["short_term", "short_term_iteration", "short", "iteration", "短期任务", "短期迭代"].includes(normalized)) return "short_term";
  if (["waiting", "waiting_user", "waiting_for", "等待任务", "等待"].includes(normalized)) return "waiting";
  if (["inbox", "collect", "collection", "capture", "收集箱"].includes(normalized)) return "inbox";
  if (["skill", "quick_action", "quick-action", "快捷按钮", "快捷动作"].includes(normalized)) return "skill";
  return "";
}

/**
 * Infer the bucket for a session based on:
 * 1. Explicit taskPoolMembership.longTerm.bucket (highest priority)
 * 2. persistent.kind (kind → bucket mapping)
 * 3. workflowState (waiting_user → waiting)
 * 4. Default: inbox
 */
function inferSessionBucket(session) {
  // 1. Explicit membership bucket wins when the task is already assigned to a project.
  const explicitBucket = normalizeBucket(session?.taskPoolMembership?.longTerm?.bucket || "");
  if (explicitBucket) return explicitBucket;

  // 2. Infer from persistent kind.
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (KIND_TO_BUCKET[kind]) return KIND_TO_BUCKET[kind];

  // 3. No execution type set → inbox.
  if (!kind) return "inbox";

  // 4. Infer from workflow state (fallback for edge cases)
  const workflowState = String(session?.workflowState || "").trim().toLowerCase();
  if (workflowState === "waiting_user") return "waiting";

  // 5. Default
  return "inbox";
}

/**
 * Get the display order for a bucket (for sorting).
 */
function getBucketOrder(bucketKey) {
  const def = BUCKET_DEFS.find((b) => b.key === bucketKey);
  return def ? def.order : 99;
}

// Expose globally so all frontend modules can use without imports
if (typeof globalThis !== "undefined") {
  globalThis.MelodySyncTaskTypeConstants = Object.freeze({
    PERSISTENT_KINDS,
    BUCKET_KEYS,
    KIND_LABELS,
    KIND_TO_BUCKET,
    KIND_PICKER_DEFS,
    BUCKET_DEFS,
    normalizeBucket,
    inferSessionBucket,
    getBucketOrder,
  });
}
