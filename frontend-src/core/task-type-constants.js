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
 * Bucket definitions in display order.
 * Used for rendering bucket sub-folders in the Projects tab.
 */
const BUCKET_DEFS = Object.freeze([
  { key: "long_term",  label: "长期任务", order: 0 },
  { key: "short_term", label: "短期任务", order: 1 },
  { key: "waiting",    label: "等待任务", order: 2 },
  { key: "inbox",      label: "收集箱",   order: 3 },
  { key: "skill",      label: "快捷按钮", order: 4 },
]);

/**
 * Normalize a raw bucket string to a canonical bucket key.
 * Handles aliases, Chinese labels, and legacy values.
 * Returns "" if the value is not a recognized bucket.
 */
function normalizeBucket(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["long_term", "long_term_iteration", "长期任务", "长期迭代"].includes(normalized)) return "long_term";
  if (["short_term", "short_term_iteration", "短期任务", "短期迭代"].includes(normalized)) return "short_term";
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
  // 1. Explicit membership bucket
  const rawBucket = session?.taskPoolMembership?.longTerm?.bucket || "";
  const explicitBucket = normalizeBucket(rawBucket);
  if (explicitBucket) return explicitBucket;

  // 2. Infer from persistent kind
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (kind === "recurring_task") return "long_term";
  if (kind === "scheduled_task") return "short_term";
  if (kind === "waiting_task") return "waiting";
  if (kind === "skill") return "skill";

  // 3. Infer from workflow state
  const workflowState = String(session?.workflowState || "").trim().toLowerCase();
  if (workflowState === "waiting_user") return "waiting";

  // 4. Default
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
    BUCKET_DEFS,
    normalizeBucket,
    inferSessionBucket,
    getBucketOrder,
  });
}
