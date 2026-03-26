"use strict";

(function initRemoteLabScheduleUi() {
  const DAILY_REPORT_PROMPT = `请生成今天的 RemoteLab 每日日报，并直接写成 markdown 文件归档到桌面。

这份日报的目的不是单纯记账，而是复盘我今天整天在 RemoteLab 里的工作，包括我与 RemoteLab 的多个会话、今天产出的文档、代码修改、系统能力变化，以及哪些事情真正有价值、哪些地方在偏航或低效。

要求：
1. 这是“整个 RemoteLab 的今日复盘”，不是当前单个会话总结。
2. 优先基于今天可见的全部证据来总结：
   - 今天相关的多个会话与可见上下文
   - 今天的代码改动
   - 今天新增或修改的文档、notes、日报
   - 今天生成的产物文件
   - 其他今天和 RemoteLab 相关的实际操作痕迹
3. 不要编造没有发生的事情；如果某部分证据不足，要明确写“基于可见证据判断”。
4. 日报结构必须包含：
   - 今日核心主题
   - 今天真正推进了什么
   - 今天产出了什么
   - 关键认知或产品判断变化
   - 偏航或低效点
   - 未完成但值得明天继续的事
   - 一句话总结今天
5. 重点不是流水账，而是回答：
   - 我今天到底做成了什么？
   - 哪些事情是有效推进？
   - 哪些只是看起来忙？
   - 明天最应该接着做什么？
6. 直接写到：
   /Users/kual/Desktop/RemoteLab-Daily-Reports/YYYY/MM/YYYY-MM-DD-remotelab-daily-summary.md
   用今天本地日期创建年月目录；如已存在则覆盖。
7. 写完后只回复：
   - 文件路径
   - 今日一句话总结

请实际创建或覆盖文件，不要只在聊天里输出。`;

  const MORNING_PLAN_PROMPT = `请给我一个今天的启动简报，帮助我快速进入工作。

要求：
1. 不要只总结当前会话，要尽量基于今天与昨天在 RemoteLab 中可见的工作上下文来判断。
2. 输出必须包含：
   - 昨日最关键的推进
   - 现在仍在推进的主线
   - 今天最值得优先做的 3 件事
   - 第一件事现在就能开始的最小动作
3. 重点是帮助我开工，不要写成长篇复盘。`;

  const PRESET_DEFINITIONS = {
    custom: {
      id: "custom",
      label: "Custom",
      description: "Write your own task content. Best when you need something special.",
      defaults: {
        label: "",
        recurrenceType: "daily",
        timeOfDay: "09:00",
        intervalMinutes: 60,
        prompt: "",
      },
    },
    daily_report: {
      id: "daily_report",
      label: "Daily report",
      description: "Review the whole RemoteLab workday and archive a markdown report automatically.",
      defaults: {
        label: "Daily report",
        recurrenceType: "daily",
        timeOfDay: "22:30",
        intervalMinutes: 60,
        prompt: DAILY_REPORT_PROMPT,
      },
    },
    morning_plan: {
      id: "morning_plan",
      label: "Morning plan",
      description: "Start the day with a short briefing and the next 3 priorities.",
      defaults: {
        label: "Morning plan",
        recurrenceType: "daily",
        timeOfDay: "08:30",
        intervalMinutes: 60,
        prompt: MORNING_PLAN_PROMPT,
      },
    },
  };

  const scheduleRoot = document.getElementById("headerSchedule");
  const toggleBtn = document.getElementById("scheduleToggleBtn");
  const chipLabel = document.getElementById("scheduleChipLabel");
  const chipMeta = document.getElementById("scheduleChipMeta");
  const panel = document.getElementById("schedulePanel");
  const currentTabBtn = document.getElementById("scheduleCurrentTabBtn");
  const allTasksTabBtn = document.getElementById("scheduleAllTasksTabBtn");
  const currentView = document.getElementById("scheduleCurrentView");
  const allTasksView = document.getElementById("scheduleAllTasksView");
  const panelState = document.getElementById("schedulePanelState");
  const statusText = document.getElementById("scheduleStatusText");
  const listSummary = document.getElementById("scheduleListSummary");
  const listEl = document.getElementById("scheduleList");
  const emptyState = document.getElementById("scheduleEmptyState");
  const resultCard = document.getElementById("scheduleResultCard");
  const resultBadge = document.getElementById("scheduleResultBadge");
  const resultMeta = document.getElementById("scheduleResultMeta");
  const resultDetail = document.getElementById("scheduleResultDetail");
  const resultError = document.getElementById("scheduleResultError");
  const addBtn = document.getElementById("addScheduleBtn");
  const presetSelect = document.getElementById("schedulePresetSelect");
  const presetNote = document.getElementById("schedulePresetNote");
  const enabledInput = document.getElementById("scheduleEnabledInput");
  const recurrenceSelect = document.getElementById("scheduleRecurrenceSelect");
  const timeField = document.getElementById("scheduleTimeInput")?.closest(".header-schedule-field");
  const timeInput = document.getElementById("scheduleTimeInput");
  const intervalField = document.getElementById("scheduleIntervalField");
  const intervalInput = document.getElementById("scheduleIntervalInput");
  const advancedEl = document.getElementById("scheduleAdvanced");
  const labelInput = document.getElementById("scheduleLabelInput");
  const modelSelect = document.getElementById("scheduleModelSelect");
  const contentInput = document.getElementById("scheduleContentInput");
  const saveBtn = document.getElementById("saveScheduleBtn");
  const runBtn = document.getElementById("runScheduleBtn");
  const clearBtn = document.getElementById("clearScheduleBtn");
  const timezoneNote = document.getElementById("scheduleTimezoneNote");
  const allSchedulesSummary = document.getElementById("allSchedulesSummary");
  const allSchedulesEmpty = document.getElementById("allSchedulesEmpty");
  const allSchedulesList = document.getElementById("allSchedulesList");

  if (
    !scheduleRoot
    || !toggleBtn
    || !chipLabel
    || !chipMeta
    || !panel
    || !currentTabBtn
    || !allTasksTabBtn
    || !currentView
    || !allTasksView
    || !panelState
    || !statusText
    || !listSummary
    || !listEl
    || !emptyState
    || !resultCard
    || !resultBadge
    || !resultMeta
    || !resultDetail
    || !resultError
    || !addBtn
    || !presetSelect
    || !presetNote
    || !enabledInput
    || !recurrenceSelect
    || !timeField
    || !timeInput
    || !intervalField
    || !intervalInput
    || !advancedEl
    || !labelInput
    || !modelSelect
    || !contentInput
    || !saveBtn
    || !runBtn
    || !clearBtn
    || !timezoneNote
    || !allSchedulesSummary
    || !allSchedulesEmpty
    || !allSchedulesList
  ) {
    return;
  }

  const browserTimezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();
  const DRAFT_TRIGGER_ID = "__draft__";
  const modelOptionsCache = new Map();

  let panelOpen = false;
  let activeTab = "current";
  let selectedTriggerId = DRAFT_TRIGGER_ID;
  let modelRequestToken = 0;

  function getPresetDefinition(presetId = "custom") {
    return PRESET_DEFINITIONS[presetId] || PRESET_DEFINITIONS.custom;
  }

  function normalizePresetId(value) {
    return PRESET_DEFINITIONS[value] ? value : "custom";
  }

  function getAttachedSession() {
    if (!currentSessionId || !Array.isArray(sessions)) return null;
    return sessions.find((entry) => entry.id === currentSessionId) || null;
  }

  function createClientTriggerId() {
    if (window.crypto?.randomUUID) {
      return `st_${window.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    }
    return `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeIntervalMinutes(value) {
    const numeric = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isFinite(numeric) || numeric < 1) return 0;
    return Math.min(numeric, 10080);
  }

  function getSessionTriggers(session) {
    if (Array.isArray(session?.scheduledTriggers)) return session.scheduledTriggers.slice();
    if (session?.scheduledTrigger && typeof session.scheduledTrigger === "object") {
      return [session.scheduledTrigger];
    }
    return [];
  }

  function getPrimaryTrigger(triggers) {
    if (!triggers.length) return null;
    const pool = triggers.filter((trigger) => trigger?.enabled !== false);
    return (pool.length ? pool : triggers)
      .map((trigger, index) => ({
        trigger,
        index,
        nextRunAtMs: Date.parse(trigger?.nextRunAt || ""),
      }))
      .sort((left, right) => {
        const leftFinite = Number.isFinite(left.nextRunAtMs);
        const rightFinite = Number.isFinite(right.nextRunAtMs);
        if (leftFinite && rightFinite && left.nextRunAtMs !== right.nextRunAtMs) {
          return left.nextRunAtMs - right.nextRunAtMs;
        }
        if (leftFinite !== rightFinite) {
          return leftFinite ? -1 : 1;
        }
        return left.index - right.index;
      })[0]?.trigger || null;
  }

  function sortTriggers(triggers) {
    return triggers.slice().sort((left, right) => {
      if ((left?.enabled !== false) !== (right?.enabled !== false)) {
        return left?.enabled === false ? 1 : -1;
      }
      const leftNextRunAt = Date.parse(left?.nextRunAt || "");
      const rightNextRunAt = Date.parse(right?.nextRunAt || "");
      const leftFinite = Number.isFinite(leftNextRunAt);
      const rightFinite = Number.isFinite(rightNextRunAt);
      if (leftFinite && rightFinite && leftNextRunAt !== rightNextRunAt) {
        return leftNextRunAt - rightNextRunAt;
      }
      if (leftFinite !== rightFinite) {
        return leftFinite ? -1 : 1;
      }
      return String(left?.label || left?.timeOfDay || "").localeCompare(String(right?.label || right?.timeOfDay || ""));
    });
  }

  function sortScheduledTaskEntries(entries) {
    return entries.slice().sort((left, right) => {
      if ((left.trigger?.enabled !== false) !== (right.trigger?.enabled !== false)) {
        return left.trigger?.enabled === false ? 1 : -1;
      }
      const leftNextRunAt = Date.parse(left.trigger?.nextRunAt || "");
      const rightNextRunAt = Date.parse(right.trigger?.nextRunAt || "");
      const leftFinite = Number.isFinite(leftNextRunAt);
      const rightFinite = Number.isFinite(rightNextRunAt);
      if (leftFinite && rightFinite && leftNextRunAt !== rightNextRunAt) {
        return leftNextRunAt - rightNextRunAt;
      }
      if (leftFinite !== rightFinite) {
        return leftFinite ? -1 : 1;
      }
      const leftLabel = `${left.session?.name || ""} ${left.trigger?.label || ""}`;
      const rightLabel = `${right.session?.name || ""} ${right.trigger?.label || ""}`;
      return leftLabel.localeCompare(rightLabel);
    });
  }

  function formatRelative(targetIso) {
    const targetMs = Date.parse(targetIso || "");
    if (!Number.isFinite(targetMs)) return "";
    const diffMs = targetMs - Date.now();
    const absMinutes = Math.round(Math.abs(diffMs) / 60000);
    if (absMinutes < 1) return diffMs >= 0 ? "soon" : "just now";
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 && hours < 24) parts.push(`${minutes}m`);
    const text = parts.join(" ") || `${absMinutes}m`;
    return diffMs >= 0 ? `in ${text}` : `${text} ago`;
  }

  function formatInterval(minutes) {
    const normalized = normalizeIntervalMinutes(minutes);
    if (!normalized) return "Every --";
    if (normalized % (24 * 60) === 0) return `Every ${normalized / (24 * 60)}d`;
    if (normalized % 60 === 0) return `Every ${normalized / 60}h`;
    if (normalized > 60) {
      const hours = Math.floor(normalized / 60);
      const mins = normalized % 60;
      return `Every ${hours}h ${mins}m`;
    }
    return `Every ${normalized}m`;
  }

  function describeRecurrence(trigger) {
    if (!trigger) return "New schedule";
    return trigger.recurrenceType === "interval"
      ? formatInterval(trigger.intervalMinutes)
      : `Daily ${trigger.timeOfDay || "--:--"}`;
  }

  function describeTrigger(trigger) {
    if (!trigger) return "New schedule";
    const preset = getPresetDefinition(normalizePresetId(trigger.presetId));
    const label = typeof trigger.label === "string" ? trigger.label.trim() : "";
    if (label) return label;
    if (preset.id !== "custom") return preset.label;
    return describeRecurrence(trigger);
  }

  function getTriggerExecutionTone(trigger) {
    if (!trigger) return "draft";
    const status = typeof trigger.lastRunStatus === "string"
      ? trigger.lastRunStatus.trim().toLowerCase()
      : "";
    if (status === "failed") return "failed";
    if (status === "completed") return "completed";
    if (status === "started" || status === "dispatching") return "running";
    if (status === "queued") return "queued";
    if (status === "cancelled") return "cancelled";
    if (trigger.enabled === false) return "paused";
    if (trigger.nextRunAt) return "scheduled";
    return "draft";
  }

  function getTriggerExecutionBadge(trigger) {
    switch (getTriggerExecutionTone(trigger)) {
      case "failed":
        return "Failed";
      case "completed":
        return "Completed";
      case "running":
        return "Running";
      case "queued":
        return "Queued";
      case "cancelled":
        return "Cancelled";
      case "paused":
        return "Paused";
      case "scheduled":
        return "Scheduled";
      default:
        return "Draft";
    }
  }

  function describeExecutionInline(trigger) {
    const tone = getTriggerExecutionTone(trigger);
    if (tone === "failed") {
      return `Failed ${trigger?.lastRunAt ? formatRelative(trigger.lastRunAt) : "recently"}`;
    }
    if (tone === "completed") {
      return `Completed ${trigger?.lastRunAt ? formatRelative(trigger.lastRunAt) : "recently"}`;
    }
    if (tone === "running") {
      return trigger?.lastRunAt ? `Running since ${formatRelative(trigger.lastRunAt)}` : "Running now";
    }
    if (tone === "queued") {
      return trigger?.lastRunAt ? `Queued ${formatRelative(trigger.lastRunAt)}` : "Queued";
    }
    if (tone === "cancelled") {
      return trigger?.lastRunAt ? `Cancelled ${formatRelative(trigger.lastRunAt)}` : "Cancelled";
    }
    if (tone === "paused") {
      return "Paused";
    }
    if (trigger?.nextRunAt) {
      return `Next ${formatRelative(trigger.nextRunAt)}`;
    }
    return "Saved";
  }

  function buildTriggerExecutionSummary(trigger) {
    if (!trigger) {
      return {
        tone: "draft",
        badge: "Draft",
        meta: "Save a task to start tracking scheduled runs.",
        detail: "RemoteLab will show the latest execution result here once a task has been created.",
        errorText: "",
      };
    }

    const tone = getTriggerExecutionTone(trigger);
    const recurrence = describeRecurrence(trigger);
    const nextText = trigger.nextRunAt ? `Next run ${formatRelative(trigger.nextRunAt)}.` : "No next run scheduled yet.";
    switch (tone) {
      case "failed":
        return {
          tone,
          badge: "Failed",
          meta: trigger.lastRunAt ? `Last attempt ${formatRelative(trigger.lastRunAt)} failed.` : "The latest attempt failed.",
          detail: `${recurrence}. ${trigger.enabled === false ? "It is currently paused." : nextText}`,
          errorText: trigger.lastError || "RemoteLab could not finish this scheduled run.",
        };
      case "completed":
        return {
          tone,
          badge: "Completed",
          meta: trigger.lastRunAt ? `Last attempt ${formatRelative(trigger.lastRunAt)} completed.` : "The latest attempt completed.",
          detail: `${recurrence}. ${trigger.enabled === false ? "It is currently paused." : nextText}`,
          errorText: "",
        };
      case "running":
        return {
          tone,
          badge: "Running",
          meta: trigger.lastRunAt ? `Started ${formatRelative(trigger.lastRunAt)} and is still running.` : "This task is running now.",
          detail: `${recurrence}. ${nextText}`,
          errorText: "",
        };
      case "queued":
        return {
          tone,
          badge: "Queued",
          meta: trigger.lastRunAt ? `Queued ${formatRelative(trigger.lastRunAt)}.` : "This task has been queued.",
          detail: `${recurrence}. It will run after the current work finishes.`,
          errorText: "",
        };
      case "cancelled":
        return {
          tone,
          badge: "Cancelled",
          meta: trigger.lastRunAt ? `Last attempt ${formatRelative(trigger.lastRunAt)} was cancelled.` : "The latest attempt was cancelled.",
          detail: `${recurrence}. ${trigger.enabled === false ? "It is currently paused." : nextText}`,
          errorText: "",
        };
      case "paused":
        return {
          tone,
          badge: "Paused",
          meta: "This task is paused and will not run automatically.",
          detail: `${recurrence}. ${trigger.lastRunAt ? `Last attempt ${formatRelative(trigger.lastRunAt)}.` : "Re-enable it when you want RemoteLab to resume."}`,
          errorText: trigger.lastError || "",
        };
      case "scheduled":
        return {
          tone,
          badge: "Scheduled",
          meta: nextText,
          detail: `${recurrence}. ${trigger.lastRunAt ? `Last attempt ${formatRelative(trigger.lastRunAt)}.` : "RemoteLab has not run this task yet."}`,
          errorText: "",
        };
      default:
        return {
          tone,
          badge: "Draft",
          meta: "This task is saved but has no result yet.",
          detail: `${recurrence}. ${nextText}`,
          errorText: "",
        };
    }
  }

  function buildStatusLines(trigger, triggers) {
    if (!triggers.length) {
      return "Pick a task type, choose when it should run, then save. Advanced fields stay optional.";
    }
    if (!trigger || trigger.id === DRAFT_TRIGGER_ID) {
      return "Add a task type first. For common jobs like daily reports or morning planning, you should not need to write the prompt from scratch.";
    }
    const lines = [`${describeTrigger(trigger)} · ${describeRecurrence(trigger)}`];
    if (trigger.model) {
      lines.push(`Model ${trigger.model}.`);
    }
    if (trigger.enabled !== false && trigger.nextRunAt) {
      lines.push(`Next run ${formatRelative(trigger.nextRunAt)}.`);
    } else if (trigger.enabled === false) {
      lines.push("Paused.");
    }
    if (trigger.lastRunAt) {
      const suffix = trigger.lastRunStatus ? ` (${trigger.lastRunStatus})` : "";
      lines.push(`Last run ${formatRelative(trigger.lastRunAt)}${suffix}.`);
    }
    if (trigger.lastError) {
      lines.push(`Last error: ${trigger.lastError}`);
    }
    return lines.join("\n");
  }

  function buildListSummary(triggers) {
    if (!triggers.length) return "No tasks yet";
    const enabledCount = triggers.filter((trigger) => trigger.enabled !== false).length;
    const nextTrigger = getPrimaryTrigger(triggers);
    const nextText = nextTrigger?.nextRunAt ? `Next ${formatRelative(nextTrigger.nextRunAt)}` : "No next run";
    return `${triggers.length} task${triggers.length === 1 ? "" : "s"} · ${enabledCount} enabled · ${nextText}`;
  }

  function getAllScheduledTaskEntries() {
    if (!Array.isArray(sessions)) return [];
    const entries = [];
    for (const session of sessions) {
      for (const trigger of getSessionTriggers(session)) {
        entries.push({ session, trigger });
      }
    }
    return sortScheduledTaskEntries(entries);
  }

  function buildAllTasksSummary(entries) {
    if (!entries.length) {
      return "No scheduled tasks yet. Create one from any session, then manage everything here.";
    }
    const enabledCount = entries.filter((entry) => entry.trigger?.enabled !== false).length;
    const nextEntry = entries.find((entry) => entry.trigger?.enabled !== false && entry.trigger?.nextRunAt)
      || entries.find((entry) => entry.trigger?.nextRunAt)
      || null;
    const nextText = nextEntry?.trigger?.nextRunAt
      ? `Next ${formatRelative(nextEntry.trigger.nextRunAt)} in ${nextEntry.session?.name || "session"}`
      : "No next run yet";
    return `${entries.length} task${entries.length === 1 ? "" : "s"} across ${new Set(entries.map((entry) => entry.session?.id)).size} session${new Set(entries.map((entry) => entry.session?.id)).size === 1 ? "" : "s"} · ${enabledCount} enabled · ${nextText}`;
  }

  function getSelectedTrigger(triggers) {
    if (!triggers.length && selectedTriggerId !== DRAFT_TRIGGER_ID) {
      selectedTriggerId = DRAFT_TRIGGER_ID;
    }
    if (selectedTriggerId !== DRAFT_TRIGGER_ID) {
      const match = triggers.find((trigger) => trigger.id === selectedTriggerId);
      if (match) return match;
    }
    if (selectedTriggerId === DRAFT_TRIGGER_ID) return null;
    const fallback = sortTriggers(triggers)[0] || null;
    selectedTriggerId = fallback?.id || DRAFT_TRIGGER_ID;
    return fallback;
  }

  function syncRecurrenceControls(trigger) {
    const recurrenceType = trigger?.recurrenceType === "interval" ? "interval" : recurrenceSelect.value;
    recurrenceSelect.value = recurrenceType;
    timeField.hidden = recurrenceType !== "daily";
    intervalField.hidden = recurrenceType !== "interval";
  }

  function updatePresetNote(presetId) {
    presetNote.textContent = getPresetDefinition(presetId).description;
  }

  function shouldOpenAdvanced(session, trigger = null) {
    if (trigger?.model || modelSelect.value) return true;
    if (session?.model && modelSelect.value) return true;
    return false;
  }

  function updateFooterNote(session, trigger = null) {
    const toolId = session?.tool || "";
    const modelText = trigger?.model || modelSelect.value
      ? `Uses model ${trigger?.model || modelSelect.value}.`
      : (session?.model ? `Uses the session default model (${session.model}).` : "Uses the session default model.");
    if (!session) {
      timezoneNote.textContent = "Choose a session first.";
      return;
    }
    if ((trigger?.recurrenceType || recurrenceSelect.value) === "interval") {
      timezoneNote.textContent = `Interval schedules wait the chosen number of minutes between runs. ${toolId ? `Tool ${toolId}. ` : ""}${modelText}`;
      return;
    }
    timezoneNote.textContent = `Daily schedules run in ${trigger?.timezone || browserTimezone}. ${toolId ? `Tool ${toolId}. ` : ""}${modelText}`;
  }

  function syncTabs() {
    currentTabBtn.classList.toggle("active", activeTab === "current");
    allTasksTabBtn.classList.toggle("active", activeTab === "all");
    currentView.hidden = activeTab !== "current";
    allTasksView.hidden = activeTab !== "all";
  }

  function syncResultCard(trigger) {
    const summary = buildTriggerExecutionSummary(trigger);
    resultCard.hidden = false;
    resultBadge.textContent = summary.badge;
    resultBadge.className = `header-schedule-result-badge ${summary.tone}`;
    resultMeta.textContent = summary.meta;
    resultDetail.textContent = summary.detail;
    if (summary.errorText) {
      resultError.hidden = false;
      resultError.textContent = summary.errorText;
    } else {
      resultError.hidden = true;
      resultError.textContent = "";
    }
  }

  function renderModelOptions(session, trigger = null, modelResult = null) {
    const models = Array.isArray(modelResult?.models) ? modelResult.models : [];
    const preferredModel = trigger?.model || "";
    const defaultLabel = session?.model
      ? `Session default (${session.model})`
      : "Session default";
    modelSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = defaultLabel;
    modelSelect.append(defaultOption);
    let hasSelectedModel = preferredModel === "";
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label || model.id;
      if (model.id === preferredModel) hasSelectedModel = true;
      modelSelect.append(option);
    }
    if (preferredModel && !hasSelectedModel) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = preferredModel;
      fallbackOption.textContent = `${preferredModel} (saved)`;
      modelSelect.append(fallbackOption);
    }
    modelSelect.value = preferredModel;
    modelSelect.disabled = false;
    updateFooterNote(session, trigger);
  }

  async function syncModelSelect(session, trigger = null) {
    const toolId = session?.tool || "";
    const requestToken = ++modelRequestToken;
    modelSelect.disabled = true;
    renderModelOptions(session, trigger, null);
    if (!toolId) {
      if (requestToken !== modelRequestToken) return;
      modelSelect.disabled = false;
      return;
    }
    if (!modelOptionsCache.has(toolId)) {
      modelOptionsCache.set(
        toolId,
        fetchJsonOrRedirect(`/api/models?tool=${encodeURIComponent(toolId)}`).catch((error) => {
          modelOptionsCache.delete(toolId);
          throw error;
        }),
      );
    }
    try {
      const result = await modelOptionsCache.get(toolId);
      if (requestToken !== modelRequestToken) return;
      renderModelOptions(session, trigger, result);
    } catch (error) {
      if (requestToken !== modelRequestToken) return;
      modelSelect.innerHTML = "";
      const fallbackOption = document.createElement("option");
      fallbackOption.value = trigger?.model || "";
      fallbackOption.textContent = trigger?.model || "Session default";
      modelSelect.append(fallbackOption);
      modelSelect.value = trigger?.model || "";
      modelSelect.disabled = false;
      timezoneNote.textContent = error?.message || "Failed to load model options.";
    }
  }

  function applyPresetDefaults(presetId, { force = false } = {}) {
    const normalizedPresetId = normalizePresetId(presetId);
    const preset = getPresetDefinition(normalizedPresetId);
    presetSelect.value = normalizedPresetId;
    updatePresetNote(normalizedPresetId);
    if (normalizedPresetId === "custom" && !force) {
      advancedEl.open = true;
      return;
    }
    const shouldOverwriteContent = force
      || !contentInput.value.trim()
      || Object.values(PRESET_DEFINITIONS).some((candidate) => candidate.defaults.prompt === contentInput.value);
    const shouldOverwriteLabel = force
      || !labelInput.value.trim()
      || Object.values(PRESET_DEFINITIONS).some((candidate) => candidate.defaults.label === labelInput.value);
    if (shouldOverwriteContent) {
      contentInput.value = preset.defaults.prompt;
    }
    if (shouldOverwriteLabel) {
      labelInput.value = preset.defaults.label;
    }
    recurrenceSelect.value = preset.defaults.recurrenceType;
    timeInput.value = preset.defaults.timeOfDay;
    intervalInput.value = String(preset.defaults.intervalMinutes);
    syncRecurrenceControls({ recurrenceType: preset.defaults.recurrenceType });
    advancedEl.open = normalizedPresetId === "custom";
  }

  function syncEditor(session, trigger) {
    const presetId = normalizePresetId(trigger?.presetId || "custom");
    presetSelect.value = presetId;
    updatePresetNote(presetId);
    if (trigger) {
      enabledInput.checked = trigger.enabled !== false;
      recurrenceSelect.value = trigger.recurrenceType === "interval" ? "interval" : "daily";
      timeInput.value = trigger.timeOfDay || getPresetDefinition(presetId).defaults.timeOfDay || "09:00";
      intervalInput.value = String(normalizeIntervalMinutes(trigger.intervalMinutes) || getPresetDefinition(presetId).defaults.intervalMinutes || 60);
      labelInput.value = trigger.label || "";
      contentInput.value = trigger.prompt || trigger.content || "";
      clearBtn.textContent = "Delete";
    } else {
      enabledInput.checked = true;
      labelInput.value = "";
      contentInput.value = "";
      clearBtn.textContent = "Reset";
      applyPresetDefaults(presetId, { force: true });
    }
    syncRecurrenceControls(trigger || { recurrenceType: recurrenceSelect.value });
    advancedEl.open = shouldOpenAdvanced(session, trigger);
    runBtn.disabled = !trigger;
    void syncModelSelect(session, trigger);
  }

  function renderTriggerList(triggers) {
    const ordered = sortTriggers(triggers);
    listEl.innerHTML = "";
    listEl.hidden = ordered.length === 0;
    emptyState.hidden = ordered.length > 0;
    for (const trigger of ordered) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "header-schedule-item";
      if (getTriggerExecutionTone(trigger) === "failed") item.classList.add("issue");
      if (trigger.id === selectedTriggerId) item.classList.add("active");
      item.dataset.triggerId = trigger.id || "";

      const titleRow = document.createElement("div");
      titleRow.className = "header-schedule-item-title-row";

      const title = document.createElement("div");
      title.className = "header-schedule-item-title";
      title.textContent = describeTrigger(trigger);

      const badge = document.createElement("div");
      badge.className = `header-schedule-item-badge ${trigger.enabled === false ? "paused" : "enabled"}`;
      badge.textContent = trigger.enabled === false ? "Paused" : describeRecurrence(trigger);

      const stateBadge = document.createElement("div");
      const stateTone = getTriggerExecutionTone(trigger);
      stateBadge.className = `header-schedule-state-badge ${stateTone}`;
      stateBadge.textContent = getTriggerExecutionBadge(trigger);

      const badges = document.createElement("div");
      badges.className = "header-schedule-item-badges";
      badges.append(badge, stateBadge);

      const meta = document.createElement("div");
      meta.className = "header-schedule-item-meta";
      const metaParts = [];
      const preset = getPresetDefinition(normalizePresetId(trigger.presetId));
      if (preset.id !== "custom") metaParts.push(preset.label);
      if (trigger.model) metaParts.push(`Model ${trigger.model}`);
      metaParts.push(describeExecutionInline(trigger));
      meta.textContent = metaParts.join(" · ") || "Saved";

      titleRow.append(title, badges);
      item.append(titleRow, meta);
      if (trigger.lastError) {
        const alert = document.createElement("div");
        alert.className = "header-schedule-item-alert";
        alert.textContent = trigger.lastError;
        item.append(alert);
      }
      listEl.append(item);
    }
  }

  function renderAllSchedulesModal() {
    const entries = getAllScheduledTaskEntries();
    allSchedulesSummary.textContent = buildAllTasksSummary(entries);
    allSchedulesList.innerHTML = "";
    allSchedulesList.hidden = entries.length === 0;
    allSchedulesEmpty.hidden = entries.length > 0;

    for (const entry of entries) {
      const item = document.createElement("section");
      item.className = "tasks-modal-item";
      if (getTriggerExecutionTone(entry.trigger) === "failed") item.classList.add("issue");

      const header = document.createElement("div");
      header.className = "tasks-modal-item-header";

      const titleBlock = document.createElement("div");
      titleBlock.className = "tasks-modal-item-title-block";

      const title = document.createElement("div");
      title.className = "tasks-modal-item-title";
      title.textContent = describeTrigger(entry.trigger);

      const sessionLine = document.createElement("div");
      sessionLine.className = "tasks-modal-item-session";
      sessionLine.textContent = entry.session?.name || "Unnamed session";

      const badge = document.createElement("div");
      badge.className = `header-schedule-item-badge ${entry.trigger?.enabled === false ? "paused" : "enabled"}`;
      badge.textContent = entry.trigger?.enabled === false ? "Paused" : describeRecurrence(entry.trigger);

      const stateBadge = document.createElement("div");
      const stateTone = getTriggerExecutionTone(entry.trigger);
      stateBadge.className = `header-schedule-state-badge ${stateTone}`;
      stateBadge.textContent = getTriggerExecutionBadge(entry.trigger);

      const badges = document.createElement("div");
      badges.className = "tasks-modal-item-badges";
      badges.append(badge, stateBadge);

      titleBlock.append(title, sessionLine);
      header.append(titleBlock, badges);

      const meta = document.createElement("div");
      meta.className = "tasks-modal-item-meta";
      const metaParts = [];
      const preset = getPresetDefinition(normalizePresetId(entry.trigger?.presetId));
      if (preset.id !== "custom") metaParts.push(preset.label);
      if (entry.trigger?.model) metaParts.push(`Model ${entry.trigger.model}`);
      metaParts.push(describeExecutionInline(entry.trigger));
      meta.textContent = metaParts.join(" · ") || "Saved";

      const actions = document.createElement("div");
      actions.className = "tasks-modal-item-actions";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "modal-btn";
      openBtn.textContent = "Open session";
      openBtn.dataset.sessionId = entry.session?.id || "";
      openBtn.dataset.triggerId = entry.trigger?.id || "";

      const runBtnEl = document.createElement("button");
      runBtnEl.type = "button";
      runBtnEl.className = "modal-btn primary";
      runBtnEl.textContent = "Run now";
      runBtnEl.dataset.runSessionId = entry.session?.id || "";
      runBtnEl.dataset.runTriggerId = entry.trigger?.id || "";

      actions.append(openBtn, runBtnEl);
      item.append(header, meta);
      if (entry.trigger?.lastError) {
        const alert = document.createElement("div");
        alert.className = "tasks-modal-item-alert";
        alert.textContent = entry.trigger.lastError;
        item.append(alert);
      }
      item.append(actions);
      allSchedulesList.append(item);
    }
  }

  function syncPanelFromSession(session) {
    const triggers = getSessionTriggers(session);
    const selectedTrigger = getSelectedTrigger(triggers);
    const resultTrigger = selectedTrigger || getPrimaryTrigger(triggers);
    listSummary.textContent = buildListSummary(triggers);
    renderTriggerList(triggers);
    syncEditor(session, selectedTrigger);
    statusText.textContent = buildStatusLines(selectedTrigger, triggers);
    syncResultCard(resultTrigger);
    panelState.textContent = !triggers.length
      ? "No schedule"
      : `${triggers.filter((trigger) => trigger.enabled !== false).length}/${triggers.length} enabled`;
  }

  function syncChip(session = getAttachedSession()) {
    const triggers = getSessionTriggers(session);
    const primaryTrigger = getPrimaryTrigger(triggers);
    const enabledCount = triggers.filter((trigger) => trigger.enabled !== false).length;

    toggleBtn.disabled = !session;
    toggleBtn.classList.toggle("active", enabledCount > 0);
    toggleBtn.classList.toggle("paused", triggers.length > 0 && enabledCount === 0);
    chipLabel.textContent = !session
      ? "Schedule"
      : (triggers.length === 0
        ? "Schedule"
        : `${triggers.length} task${triggers.length === 1 ? "" : "s"}`);
    chipMeta.textContent = !session
      ? "No session"
      : (primaryTrigger?.nextRunAt
        ? `Next ${formatRelative(primaryTrigger.nextRunAt)}`
        : (triggers.length ? `${enabledCount} enabled` : "Not set"));
    toggleBtn.setAttribute("aria-expanded", panelOpen ? "true" : "false");
    panel.hidden = !panelOpen;

    if (session) {
      syncPanelFromSession(session);
    } else {
      selectedTriggerId = DRAFT_TRIGGER_ID;
      listEl.innerHTML = "";
      listEl.hidden = true;
      emptyState.hidden = false;
      listSummary.textContent = "No session";
      panelState.textContent = "No session";
      statusText.textContent = "Choose a session first.";
      syncResultCard(null);
      syncEditor(null, null);
    }
    renderAllSchedulesModal();
    syncTabs();
    window.RemoteLabSettingsWorkspace?.syncOverview?.();
  }

  async function saveSchedule() {
    const session = getAttachedSession();
    if (!session) return;

    const presetId = normalizePresetId(presetSelect.value);
    const preset = getPresetDefinition(presetId);
    const prompt = contentInput.value.trim() || preset.defaults.prompt;
    if (!prompt) {
      statusText.textContent = "Content is required.";
      advancedEl.open = true;
      return;
    }

    const recurrenceType = recurrenceSelect.value === "interval" ? "interval" : "daily";
    const intervalMinutes = normalizeIntervalMinutes(intervalInput.value);
    if (recurrenceType === "interval" && !intervalMinutes) {
      statusText.textContent = "Interval minutes are required.";
      return;
    }

    const nextTrigger = {
      id: selectedTriggerId !== DRAFT_TRIGGER_ID ? selectedTriggerId : createClientTriggerId(),
      presetId,
      label: labelInput.value.trim() || preset.defaults.label,
      enabled: enabledInput.checked,
      recurrenceType,
      timezone: browserTimezone,
      prompt,
      ...(modelSelect.value ? { model: modelSelect.value } : {}),
      ...(recurrenceType === "interval"
        ? { intervalMinutes }
        : { timeOfDay: timeInput.value || preset.defaults.timeOfDay || "09:00" }),
    };

    const sessionTriggers = getSessionTriggers(session);
    const existingIndex = sessionTriggers.findIndex((trigger) => trigger.id === nextTrigger.id);
    const nextTriggers = sessionTriggers.slice();
    if (existingIndex >= 0) {
      nextTriggers[existingIndex] = nextTrigger;
    } else {
      nextTriggers.push(nextTrigger);
    }

    saveBtn.disabled = true;
    try {
      const response = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledTriggers: nextTriggers }),
      });
      const normalized = upsertSession(response.session);
      selectedTriggerId = nextTrigger.id;
      if (normalized && currentSessionId === normalized.id) {
        syncChip(normalized);
      } else {
        syncChip();
      }
      renderSessionList();
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function clearSchedule() {
    const session = getAttachedSession();
    if (!session) return;

    if (selectedTriggerId === DRAFT_TRIGGER_ID) {
      syncEditor(session, null);
      statusText.textContent = buildStatusLines(null, getSessionTriggers(session));
      return;
    }

    const triggers = getSessionTriggers(session);
    const nextTriggers = triggers.filter((trigger) => trigger.id !== selectedTriggerId);

    clearBtn.disabled = true;
    try {
      const response = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledTriggers: nextTriggers.length > 0 ? nextTriggers : null,
        }),
      });
      const normalized = upsertSession(response.session);
      selectedTriggerId = getPrimaryTrigger(nextTriggers)?.id || DRAFT_TRIGGER_ID;
      if (normalized && currentSessionId === normalized.id) {
        syncChip(normalized);
      } else {
        syncChip();
      }
      renderSessionList();
    } finally {
      clearBtn.disabled = false;
    }
  }

  async function runSelectedScheduleNow() {
    const session = getAttachedSession();
    if (!session || selectedTriggerId === DRAFT_TRIGGER_ID) return;
    runBtn.disabled = true;
    try {
      const response = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}/run-scheduled-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerId: selectedTriggerId }),
      });
      const normalized = upsertSession(response.session);
      statusText.textContent = "Task queued. RemoteLab started running it now.";
      if (normalized && currentSessionId === normalized.id) {
        syncChip(normalized);
      } else {
        syncChip();
      }
      renderSessionList();
    } finally {
      runBtn.disabled = false;
    }
  }

  async function runScheduleNow(sessionId, triggerId) {
    const response = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(sessionId)}/run-scheduled-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerId }),
    });
    const normalized = upsertSession(response.session);
    renderSessionList();
    if (normalized && currentSessionId === normalized.id) {
      syncChip(normalized);
    } else {
      syncChip();
    }
  }

  function startDraft() {
    selectedTriggerId = DRAFT_TRIGGER_ID;
    presetSelect.value = "custom";
    syncChip();
    labelInput.focus();
  }

  presetSelect.addEventListener("change", () => {
    applyPresetDefaults(presetSelect.value, { force: true });
    updateFooterNote(getAttachedSession(), {
      recurrenceType: recurrenceSelect.value,
      timezone: browserTimezone,
      model: modelSelect.value,
    });
  });

  recurrenceSelect.addEventListener("change", () => {
    syncRecurrenceControls({ recurrenceType: recurrenceSelect.value });
    updateFooterNote(getAttachedSession(), {
      recurrenceType: recurrenceSelect.value,
      timezone: browserTimezone,
      model: modelSelect.value,
    });
  });

  modelSelect.addEventListener("change", () => {
    updateFooterNote(getAttachedSession(), {
      recurrenceType: recurrenceSelect.value,
      timezone: browserTimezone,
      model: modelSelect.value,
    });
  });

  toggleBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (toggleBtn.disabled) return;
    panelOpen = !panelOpen;
    syncChip();
  });

  addBtn.addEventListener("click", () => {
    activeTab = "current";
    startDraft();
  });

  currentTabBtn.addEventListener("click", () => {
    activeTab = "current";
    syncTabs();
  });

  allTasksTabBtn.addEventListener("click", () => {
    activeTab = "all";
    renderAllSchedulesModal();
    syncTabs();
  });

  listEl.addEventListener("click", (event) => {
    const item = event.target.closest("[data-trigger-id]");
    if (!item) return;
    selectedTriggerId = item.dataset.triggerId || DRAFT_TRIGGER_ID;
    syncChip();
  });

  saveBtn.addEventListener("click", () => {
    saveSchedule().catch((error) => {
      statusText.textContent = error?.message || "Failed to save schedule.";
    });
  });

  clearBtn.addEventListener("click", () => {
    clearSchedule().catch((error) => {
      statusText.textContent = error?.message || "Failed to update schedule.";
    });
  });

  runBtn.addEventListener("click", () => {
    runSelectedScheduleNow().catch((error) => {
      statusText.textContent = error?.message || "Failed to run task.";
    });
  });

  allSchedulesList.addEventListener("click", (event) => {
    const runButton = event.target.closest("[data-run-session-id][data-run-trigger-id]");
    if (runButton) {
      const sessionId = runButton.dataset.runSessionId || "";
      const triggerId = runButton.dataset.runTriggerId || "";
      runScheduleNow(sessionId, triggerId).then(() => {
        allSchedulesSummary.textContent = "Task queued. RemoteLab started running it now.";
      }).catch((error) => {
        allSchedulesSummary.textContent = error?.message || "Failed to run task.";
      });
      return;
    }
    const openBtn = event.target.closest("[data-session-id][data-trigger-id]");
    if (!openBtn) return;
    const sessionId = openBtn.dataset.sessionId || "";
    const triggerId = openBtn.dataset.triggerId || DRAFT_TRIGGER_ID;
    const targetSession = Array.isArray(sessions)
      ? sessions.find((entry) => entry.id === sessionId)
      : null;
    if (!targetSession) return;
    selectedTriggerId = triggerId;
    panelOpen = true;
    activeTab = "current";
    attachSession(sessionId, targetSession);
  });

  document.addEventListener("click", (event) => {
    if (!panelOpen) return;
    if (scheduleRoot.contains(event.target)) return;
    panelOpen = false;
    syncChip();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    panelOpen = false;
    syncChip();
  });

  syncChip(null);

  window.RemoteLabScheduleUi = {
    sync(session = null) {
      syncChip(session || getAttachedSession());
    },
    openAllTasks() {
      activeTab = "all";
      panelOpen = true;
      syncChip();
    },
  };
})();
