"use strict";

(function attachMelodySyncSessionListContract(root) {
  const TASK_LIST_GROUP_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "inbox",
      key: "group:inbox",
      storageValue: "收集箱",
      labelKey: "sidebar.group.inbox",
      aliases: ["收集箱", "收件箱", "capture", "inbox"],
      order: 0,
      gtdBucket: "capture",
    }),
    Object.freeze({
      id: "long_term",
      key: "group:long-term",
      storageValue: "长期任务",
      labelKey: "sidebar.group.longTerm",
      aliases: ["长期任务", "long-term", "long term"],
      order: 1,
      gtdBucket: "projects",
    }),
    Object.freeze({
      id: "quick_actions",
      key: "group:quick-actions",
      storageValue: "快捷按钮",
      labelKey: "sidebar.group.quickActions",
      aliases: ["快捷按钮", "快捷动作", "quick-actions", "quick actions"],
      order: 2,
      gtdBucket: "tools",
    }),
    Object.freeze({
      id: "short_term",
      key: "group:short-term",
      storageValue: "短期任务",
      labelKey: "sidebar.group.shortTerm",
      aliases: ["短期任务", "short-term", "short term"],
      order: 3,
      gtdBucket: "next_actions",
    }),
    Object.freeze({
      id: "knowledge_base",
      key: "group:knowledge-base",
      storageValue: "知识库内容",
      labelKey: "sidebar.group.knowledgeBase",
      aliases: ["知识库内容", "knowledge-base", "knowledge base"],
      order: 4,
      gtdBucket: "reference",
    }),
    Object.freeze({
      id: "waiting",
      key: "group:waiting",
      storageValue: "等待任务",
      labelKey: "sidebar.group.waiting",
      aliases: ["等待任务", "waiting"],
      order: 5,
      gtdBucket: "waiting_for",
    }),
  ]);

  const SESSION_LIST_AI_MUTABLE_FIELD_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "name",
      label: "Task Name",
      description: "Visible task title shown in the GTD task list.",
    }),
    Object.freeze({
      id: "group",
      label: "Task Folder",
      description: "GTD folder/category shown in the task list.",
    }),
    Object.freeze({
      id: "sidebarOrder",
      label: "Task Order",
      description: "Positive integer used for stable ordering inside the GTD list.",
    }),
  ]);

  const SESSION_LIST_READONLY_SNAPSHOT_FIELD_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "title",
      description: "Current visible task title snapshot. Read-only context for AI.",
    }),
    Object.freeze({
      id: "brief",
      description: "Current brief summary snapshot. Read-only context for AI.",
    }),
    Object.freeze({
      id: "existingGroup",
      description: "Current durable GTD folder snapshot. Read-only context for AI.",
    }),
    Object.freeze({
      id: "existingSidebarOrder",
      description: "Current durable order snapshot. Read-only context for AI.",
    }),
  ]);

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeKey(value) {
    return trimText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function cloneDefinition(definition) {
    return definition ? { ...definition } : null;
  }

  function listTaskListGroups() {
    return TASK_LIST_GROUP_DEFINITIONS.map(cloneDefinition);
  }

  function resolveTaskListGroup(groupValue = "") {
    const normalized = normalizeKey(groupValue);
    return cloneDefinition(
      TASK_LIST_GROUP_DEFINITIONS.find((entry) => entry.aliases.includes(normalized))
      || TASK_LIST_GROUP_DEFINITIONS[0],
    );
  }

  function listTaskListOrganizerMutableFields() {
    return SESSION_LIST_AI_MUTABLE_FIELD_DEFINITIONS.map(cloneDefinition);
  }

  function listTaskListReadonlySnapshotFields() {
    return SESSION_LIST_READONLY_SNAPSHOT_FIELD_DEFINITIONS.map(cloneDefinition);
  }

  function formatBacktickedFieldList(definitions = []) {
    const fields = definitions
      .map((definition) => trimText(definition?.id))
      .filter(Boolean)
      .map((field) => `\`${field}\``);
    if (fields.length === 0) return "";
    if (fields.length === 1) return fields[0];
    if (fields.length === 2) return `${fields[0]} and ${fields[1]}`;
    return `${fields.slice(0, -1).join(", ")}, and ${fields[fields.length - 1]}`;
  }

  function buildTaskListOrganizerWritableFieldsText() {
    return formatBacktickedFieldList(SESSION_LIST_AI_MUTABLE_FIELD_DEFINITIONS);
  }

  function buildTaskListOrganizerReadonlyFieldsText() {
    return formatBacktickedFieldList(SESSION_LIST_READONLY_SNAPSHOT_FIELD_DEFINITIONS);
  }

  function buildTaskListGroupStorageValuesText() {
    return TASK_LIST_GROUP_DEFINITIONS.map((definition) => definition.storageValue).join(", ");
  }

  root.MelodySyncSessionListContract = {
    TASK_LIST_GROUP_DEFINITIONS,
    SESSION_LIST_AI_MUTABLE_FIELD_DEFINITIONS,
    SESSION_LIST_READONLY_SNAPSHOT_FIELD_DEFINITIONS,
    listTaskListGroups,
    resolveTaskListGroup,
    listTaskListOrganizerMutableFields,
    listTaskListReadonlySnapshotFields,
    buildTaskListOrganizerWritableFieldsText,
    buildTaskListOrganizerReadonlyFieldsText,
    buildTaskListGroupStorageValuesText,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
