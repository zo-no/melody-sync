function restoreOwnerSessionSelection() {
  const requestedTab = pendingNavigationState?.tab || activeTab;
  if (requestedTab !== activeTab) {
    switchTab(requestedTab, { syncState: false });
  }

  const targetSession = resolveRestoreTargetSession();
  if (!targetSession) {
    currentSessionId = null;
    hasAttachedSession = false;
    persistActiveSessionId(null);
    syncBrowserState({ sessionId: null, tab: activeTab });
    showEmpty();
    restoreDraft();
    updateStatus("connected");
    pendingNavigationState = null;
    return;
  }

  if (!hasAttachedSession || currentSessionId !== targetSession.id) {
    attachSession(targetSession.id, targetSession);
  } else {
    syncBrowserState();
  }
  pendingNavigationState = null;
}

function getSessionRecordForHttp(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return null;
  return Array.isArray(sessions)
    ? sessions.find((entry) => entry?.id === normalizedSessionId) || null
    : null;
}

function normalizePersistentKindForHttp(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "recurring_task" ? "recurring_task" : "";
}

function getLongTermTaskPoolMembershipForHttp(session) {
  const membership = session?.taskPoolMembership?.longTerm;
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) return null;
  const sessionId = String(session?.id || "").trim();
  const projectSessionId = String(membership?.projectSessionId || "").trim();
  if (!projectSessionId) return null;
  const requestedRole = String(membership?.role || "").trim().toLowerCase();
  const role = requestedRole === "project"
    ? "project"
    : (projectSessionId === sessionId ? "project" : "member");
  return {
    role,
    projectSessionId,
    fixedNode: membership?.fixedNode === true || role === "project",
  };
}

function resolveLongTermProjectRootSessionIdForHttp(session, visited = new Set()) {
  if (typeof resolveLongTermProjectRootSessionId === "function") {
    return String(resolveLongTermProjectRootSessionId(session) || "").trim();
  }
  const sessionId = String(session?.id || "").trim();
  if (!sessionId || visited.has(sessionId)) return "";
  const membership = getLongTermTaskPoolMembershipForHttp(session);
  if (membership?.projectSessionId) return membership.projectSessionId;
  if (normalizePersistentKindForHttp(session?.persistent?.kind) === "recurring_task") {
    return sessionId;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(sessionId);
  const candidateIds = [];
  const rootSessionId = String(
    session?.rootSessionId
    || session?.sourceContext?.rootSessionId
    || "",
  ).trim();
  const parentSessionId = String(
    session?._branchParentSessionId
    || session?.branchParentSessionId
    || session?.sourceContext?.parentSessionId
    || "",
  ).trim();
  for (const candidateId of [rootSessionId, parentSessionId]) {
    if (!candidateId || candidateId === sessionId || candidateIds.includes(candidateId)) continue;
    candidateIds.push(candidateId);
  }
  for (const candidateId of candidateIds) {
    const candidate = getSessionRecordForHttp(candidateId);
    if (!candidate) continue;
    const resolvedRootSessionId = resolveLongTermProjectRootSessionIdForHttp(candidate, nextVisited);
    if (resolvedRootSessionId) return resolvedRootSessionId;
  }
  return "";
}

function getSidebarTabForSessionHttp(session) {
  return resolveLongTermProjectRootSessionIdForHttp(session) ? "long-term" : "sessions";
}

function getSidebarTabForSessionId(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return "sessions";
  const session = getSessionRecordForHttp(normalizedSessionId);
  return getSidebarTabForSessionHttp(session);
}

function getCompletionNavigationTarget(sessionOrId = null) {
  const session = typeof sessionOrId === "string"
    ? getSessionRecordForHttp(sessionOrId)
    : sessionOrId;
  const sessionId = String(session?.id || sessionOrId || "").trim();
  if (!sessionId) {
    return {
      sessionId: "",
      tab: "sessions",
    };
  }
  const longTermRootSessionId = resolveLongTermProjectRootSessionIdForHttp(session);
  if (longTermRootSessionId) {
    return {
      sessionId: longTermRootSessionId,
      tab: "long-term",
    };
  }
  return {
    sessionId,
    tab: getSidebarTabForSessionHttp(session),
  };
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "melodysync:open-session") return;
    applyNavigationState(event.data);
    window.focus();
  });
}

function notifyCompletion(session) {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  const folder = (session?.folder || "").split("/").pop() || "Session";
  const name = session?.name || folder;
  const completionText = `${name} 已完成`;
  try {
    const n = new Notification("MelodySync", {
      icon: "/icon.svg",
      body: completionText,
      tag: "melodysync-done",
      renotify: true,
      requireInteraction: isLikelyMobileClient(),
    });
    n.onclick = () => {
      const target = getCompletionNavigationTarget(session);
      window.focus();
      applyNavigationState(target);
      n.close();
    };
  } catch {}
}

let completionAudioContext = null;
let completionAudioPrimed = false;
let completionSoundEnabled = true;
const notifiedCompletionStamps = new Map();
const completionAttentionBanner = typeof document !== "undefined"
  ? document.getElementById("completionAttentionBanner")
  : null;
const completionAttentionText = typeof document !== "undefined"
  ? document.getElementById("completionAttentionText")
  : null;
const completionAttentionOpenBtn = typeof document !== "undefined"
  ? document.getElementById("completionAttentionOpenBtn")
  : null;
const completionAttentionCloseBtn = typeof document !== "undefined"
  ? document.getElementById("completionAttentionCloseBtn")
  : null;
const completionAttentionModalBackdrop = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalBackdrop")
  : null;
const completionAttentionModalTitle = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalTitle")
  : null;
const completionAttentionModalLead = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalLead")
  : null;
const completionAttentionModalOpenBtn = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalOpenBtn")
  : null;
const completionAttentionModalAckBtn = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalAckBtn")
  : null;
const completionAttentionModalCloseBtn = typeof document !== "undefined"
  ? document.getElementById("completionAttentionModalCloseBtn")
  : null;
let completionAttentionSessionId = "";
let completionAttentionHideTimer = null;
let completionTitleFlashTimer = null;
let completionTitleFlashBaseTitle = "";
let completionTitleFlashAlertTitle = "";
let completionForegroundRefreshPromise = null;
let lastCompletionForegroundRefreshAt = 0;

function normalizeOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function setCompletionSoundEnabled(value, fallback = true) {
  const normalized = normalizeOptionalBoolean(value);
  completionSoundEnabled = normalized === null ? fallback : normalized;
  return completionSoundEnabled;
}

function applyCompletionSoundSetting(settings = null) {
  const fallback = typeof completionSoundEnabled === "boolean" ? completionSoundEnabled : true;
  return setCompletionSoundEnabled(settings?.completionSoundEnabled, fallback);
}

function applyTaskListTemplateGroupSetting(settings = null) {
  const model = typeof getSessionListModelApi === "function"
    ? getSessionListModelApi()
    : (window.MelodySyncSessionListModel || null);
  if (typeof model?.setSessionGroupingTemplateGroups !== "function") return [];
  const groups = model.setSessionGroupingTemplateGroups(settings?.taskListTemplateGroups || []);
  if (typeof window?.syncSessionGroupingControls === "function") {
    window.syncSessionGroupingControls();
  }
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
  return groups;
}

function applyGeneralSettingsPayload(settings = null) {
  applyCompletionSoundSetting(settings);
  applyTaskListTemplateGroupSetting(settings);
  return settings;
}

async function refreshGeneralSettings() {
  if (typeof window?.fetch !== "function") return;
  try {
    const response = await window.fetch("/api/settings", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response?.ok) return;
    const payload = await response.json().catch(() => null);
    applyGeneralSettingsPayload(payload);
  } catch {}
}

function getCompletionAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioCtor !== "function") return null;
  if (!completionAudioContext || completionAudioContext.state === "closed") {
    completionAudioContext = new AudioCtor();
  }
  return completionAudioContext;
}

async function unlockCompletionAudioContext() {
  const ctx = getCompletionAudioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === "running";
}

function primeCompletionAudioContext() {
  if (completionAudioPrimed) return;
  if (typeof window?.addEventListener !== "function") return;
  completionAudioPrimed = true;
  const unlock = () => {
    void unlockCompletionAudioContext();
  };
  window.addEventListener("pointerdown", unlock, { capture: true, once: true });
  window.addEventListener("keydown", unlock, { capture: true, once: true });
  window.addEventListener("touchstart", unlock, { capture: true, once: true });
}

function isLikelyMobileClient() {
  const userAgent = String(navigator?.userAgent || "");
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  if (typeof window?.matchMedia === "function") {
    return window.matchMedia("(max-width: 820px)").matches
      && window.matchMedia("(pointer: coarse)").matches;
  }
  return false;
}

function shouldPlayCompletionSoundLocally() {
  return isLikelyMobileClient();
}

function shouldUseBlockingCompletionModal() {
  return isLikelyMobileClient();
}

function refreshCompletionAlertsOnForeground() {
  if (typeof fetchSessionsList !== "function") return null;
  if (completionForegroundRefreshPromise) return completionForegroundRefreshPromise;
  const now = Date.now();
  if (now - lastCompletionForegroundRefreshAt < 3000) return null;
  lastCompletionForegroundRefreshAt = now;
  const request = fetchSessionsList().catch(() => {}).finally(() => {
    completionForegroundRefreshPromise = null;
  });
  completionForegroundRefreshPromise = request;
  return request;
}

function clearCompletionAttentionHideTimer() {
  if (completionAttentionHideTimer) {
    window.clearTimeout(completionAttentionHideTimer);
    completionAttentionHideTimer = null;
  }
}

function hideCompletionAttention() {
  clearCompletionAttentionHideTimer();
  completionAttentionSessionId = "";
  if (!completionAttentionBanner) return;
  completionAttentionBanner.classList.remove("is-visible");
  if (typeof document?.body?.classList?.remove === "function") {
    document.body.classList.remove("completion-attention-active");
  }
  window.setTimeout(() => {
    if (!completionAttentionBanner.classList.contains("is-visible")) {
      completionAttentionBanner.hidden = true;
    }
  }, 180);
  if (completionAttentionModalBackdrop) {
    completionAttentionModalBackdrop.hidden = true;
  }
}

function scheduleCompletionAttentionHide(delayMs = 12000) {
  if (!completionAttentionBanner || typeof window?.setTimeout !== "function") return;
  clearCompletionAttentionHideTimer();
  completionAttentionHideTimer = window.setTimeout(() => {
    hideCompletionAttention();
  }, delayMs);
}

function stopCompletionTitleFlash() {
  if (completionTitleFlashTimer) {
    window.clearInterval(completionTitleFlashTimer);
    completionTitleFlashTimer = null;
  }
  if (typeof document !== "undefined" && completionTitleFlashBaseTitle) {
    document.title = completionTitleFlashBaseTitle;
  }
  completionTitleFlashBaseTitle = "";
  completionTitleFlashAlertTitle = "";
}

function startCompletionTitleFlash(session) {
  if (typeof document === "undefined" || typeof window?.setInterval !== "function") return;
  const folder = (session?.folder || "").split("/").pop() || "任务";
  const name = session?.name || folder;
  completionTitleFlashBaseTitle = String(document.title || "MelodySync Chat");
  completionTitleFlashAlertTitle = `MelodySync 任务完成: ${name} 已完成`;
  stopCompletionTitleFlash();
  completionTitleFlashBaseTitle = String(document.title || "MelodySync Chat");
  completionTitleFlashAlertTitle = `MelodySync 任务完成: ${name} 已完成`;
  let showAlert = true;
  let tickCount = 0;
  document.title = completionTitleFlashAlertTitle;
  completionTitleFlashTimer = window.setInterval(() => {
    tickCount += 1;
    document.title = showAlert ? completionTitleFlashAlertTitle : completionTitleFlashBaseTitle;
    showAlert = !showAlert;
    if (document.visibilityState === "visible" && tickCount >= 8) {
      stopCompletionTitleFlash();
    }
  }, 900);
}

function triggerCompletionHaptics() {
  try {
    if (typeof navigator?.vibrate === "function") {
      navigator.vibrate([180, 120, 180]);
    }
  } catch {}
}

function showCompletionAttention(session) {
  const folder = (session?.folder || "").split("/").pop() || "任务";
  const name = session?.name || folder;
  const isMobile = isLikelyMobileClient();
  completionAttentionSessionId = typeof session?.id === "string" ? session.id : "";
  triggerCompletionHaptics();
  startCompletionTitleFlash(session);
  if (!completionAttentionBanner || !completionAttentionText) return;
  completionAttentionText.textContent = `${name} 已完成`;
  completionAttentionBanner.hidden = false;
  if (typeof document?.body?.classList?.add === "function") {
    document.body.classList.add("completion-attention-active");
  }
  if (typeof window?.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      completionAttentionBanner.classList.add("is-visible");
    });
  } else {
    completionAttentionBanner.classList.add("is-visible");
  }
  if (!isMobile) {
    scheduleCompletionAttentionHide(document?.visibilityState === "visible" ? 12000 : 18000);
  }
  if (shouldUseBlockingCompletionModal() && completionAttentionModalBackdrop) {
    completionAttentionBanner.classList.remove("is-visible");
    completionAttentionBanner.hidden = true;
    completionAttentionModalBackdrop.hidden = false;
    if (completionAttentionModalTitle) {
      completionAttentionModalTitle.textContent = "MelodySync 任务完成";
    }
    if (completionAttentionModalLead) {
      completionAttentionModalLead.textContent = `${name} 已完成`;
    }
    clearCompletionAttentionHideTimer();
  }
}

if (typeof window !== "undefined" && typeof window?.addEventListener === "function") {
  window.addEventListener("melodysync:general-settings-updated", (event) => {
    applyGeneralSettingsPayload(event?.detail || null);
  });
  window.addEventListener("focus", () => {
    stopCompletionTitleFlash();
    void refreshCompletionAlertsOnForeground();
  });
  window.addEventListener("pageshow", () => {
    void refreshCompletionAlertsOnForeground();
  });
  primeCompletionAudioContext();
  void refreshGeneralSettings();
}

if (typeof document !== "undefined" && typeof document?.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      stopCompletionTitleFlash();
      void refreshCompletionAlertsOnForeground();
      if (completionAttentionBanner && !completionAttentionBanner.hidden) {
        const isMobile = isLikelyMobileClient();
        scheduleCompletionAttentionHide(isMobile ? 45000 : 10000);
      }
    }
  });
}

completionAttentionOpenBtn?.addEventListener?.("click", () => {
  if (completionAttentionSessionId) {
    applyNavigationState(getCompletionNavigationTarget(completionAttentionSessionId));
  }
  stopCompletionTitleFlash();
  hideCompletionAttention();
});

completionAttentionCloseBtn?.addEventListener?.("click", () => {
  stopCompletionTitleFlash();
  hideCompletionAttention();
});

completionAttentionModalOpenBtn?.addEventListener?.("click", () => {
  if (completionAttentionSessionId) {
    applyNavigationState(getCompletionNavigationTarget(completionAttentionSessionId));
  }
  stopCompletionTitleFlash();
  hideCompletionAttention();
});

completionAttentionModalAckBtn?.addEventListener?.("click", () => {
  stopCompletionTitleFlash();
  hideCompletionAttention();
});

completionAttentionModalCloseBtn?.addEventListener?.("click", () => {
  stopCompletionTitleFlash();
  hideCompletionAttention();
});

function normalizeCompletionWorkflowState(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getCompletionStamp(session) {
  return String(
    session?.lastEventAt
    || session?.updatedAt
    || session?.created
    || "",
  ).trim();
}

function shouldNotifyCompletion(session, previousSession = null) {
  if (!session?.id || !previousSession?.id) return false;
  const nextState = normalizeCompletionWorkflowState(session?.workflowState);
  const previousState = normalizeCompletionWorkflowState(previousSession?.workflowState);
  return nextState === "done" && previousState !== "done";
}

function buildCompletionNoticeKey(session = null, previousSession = null) {
  const sessionId = String(session?.id || "").trim();
  const runId = String(session?.activeRunId || previousSession?.activeRunId || "").trim();
  const stamp = getCompletionStamp(session);
  const normalizedStamp = String(stamp || "").trim();
  if (!sessionId) return "";
  if (runId) {
    return `completion:run:${runId}`;
  }
  return `completion:session:${sessionId}:run:${runId || "unknown"}:stamp:${normalizedStamp || "no-stamp"}`;
}

function requestHostCompletionSound(session = null, previousSession = null) {
  if (typeof window?.fetch !== "function") return null;
  const completionNoticeKey = buildCompletionNoticeKey(session, previousSession);
  const runId = String(session?.activeRunId || previousSession?.activeRunId || "").trim();
  return window.fetch("/api/system/completion-sound", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      completionNoticeKey,
      runId,
    }),
  }).then((response) => response?.ok === true);
}

function playBrowserCompletionSound() {
  const ctx = getCompletionAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      void unlockCompletionAudioContext();
      return;
    }
    const now = typeof ctx.currentTime === "number" ? ctx.currentTime : 0;
    const notes = [
      { at: 0, hz: 1046.5, gain: 0.12, len: 0.11 },
      { at: 0.11, hz: 1318.51, gain: 0.11, len: 0.1 },
      { at: 0.23, hz: 1567.98, gain: 0.1, len: 0.15 },
    ];
    for (const note of notes) {
      const startAt = now + note.at;
      const stopAt = startAt + note.len;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(note.hz, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(note.gain, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.01);
    }
  } catch {}
}

function shouldRequestHostCompletionSound() {
  return isLikelyMobileClient();
}

function playCompletionSound(session = null, previousSession = null) {
  const playedLocally = shouldPlayCompletionSoundLocally();
  if (playedLocally) {
    playBrowserCompletionSound();
  }
  const hostRequest = shouldRequestHostCompletionSound() ? requestHostCompletionSound(session, previousSession) : null;
  if (hostRequest && typeof hostRequest.then === "function") {
    void hostRequest.then((played) => {
      if (played || playedLocally) return;
      playBrowserCompletionSound();
    }).catch(() => {
      if (playedLocally) return;
      playBrowserCompletionSound();
    });
    return;
  }
  if (!playedLocally) {
    playBrowserCompletionSound();
  }
}

function handleCompletionAlerts(session, previousSession = null) {
  if (!shouldNotifyCompletion(session, previousSession)) return;
  const completionNoticeKey = buildCompletionNoticeKey(session, previousSession);
  if (completionNoticeKey && notifiedCompletionStamps.get(session.id) === completionNoticeKey) return;
  if (completionNoticeKey) {
    notifiedCompletionStamps.set(session.id, completionNoticeKey);
  } else {
    notifiedCompletionStamps.set(session.id, "done");
  }
  if (typeof completionSoundEnabled === "undefined" || completionSoundEnabled !== false) {
    playCompletionSound(session, previousSession);
  }
  showCompletionAttention(session);
  notifyCompletion(session);
}

const SESSION_LIST_ORGANIZER_POLL_INTERVAL_MS = 1200;
const SESSION_LIST_ORGANIZER_POLL_TIMEOUT_MS = 90 * 1000;
const SESSION_LIST_ORGANIZER_INTERNAL_ROLE = "session_list_organizer";
const SESSION_LIST_AUTO_ORGANIZER_DEBOUNCE_MS = 1600;
const SESSION_LIST_AUTO_ORGANIZER_MIN_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_LIST_ORGANIZER_SESSION_NAME = "sort session list";
const SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_STORAGE_KEY = "melodysyncSessionListOrganizerAiQuickActionId";
const SESSION_LIST_ORGANIZER_LAST_FINGERPRINT_STORAGE_KEY = "melodysyncSessionListOrganizerLastFingerprint";
const SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_PROMPT = "整理当前非归档任务：先读取最新任务列表，再按规则更新分组与排序，避免改动只读字段。";
const SESSION_ORGANIZER_POLL_INTERVAL_MS = 1200;
const SESSION_ORGANIZER_POLL_TIMEOUT_MS = 90 * 1000;
let sessionListOrganizerInFlight = null;
let sessionListOrganizerLabelResetTimer = null;
let sessionListOrganizerAutoTimer = null;
let sessionListOrganizerLastFingerprint = "";
let sessionListOrganizerLastAutoRunAt = 0;
let initialInboxSessionPromise = null;

function getSessionListContract() {
  return window.MelodySyncSessionListContract || null;
}

function getSessionListModelApi() {
  return window.MelodySyncSessionListModel || null;
}

function getSessionListGroupingMode() {
  return typeof getSessionListModelApi()?.getSessionGroupingMode === "function"
    ? getSessionListModelApi().getSessionGroupingMode()
    : "user";
}

function setSessionListGroupingMode(mode) {
  return typeof getSessionListModelApi()?.setSessionGroupingMode === "function"
    ? getSessionListModelApi().setSessionGroupingMode(mode)
    : "user";
}

function getSessionListGroupingTemplateGroups() {
  return typeof getSessionListModelApi()?.getSessionGroupingTemplateGroups === "function"
    ? getSessionListModelApi().getSessionGroupingTemplateGroups()
    : [];
}

function setSessionListGroupingTemplateGroups(groups) {
  return typeof getSessionListModelApi()?.setSessionGroupingTemplateGroups === "function"
    ? getSessionListModelApi().setSessionGroupingTemplateGroups(groups)
    : [];
}

function translateSessionListUiText(key, fallback) {
  const translated = typeof window?.melodySyncT === "function"
    ? window.melodySyncT(key)
    : "";
  return translated && translated !== key ? translated : fallback;
}

function getSessionListGroupingFallbackLabel() {
  return translateSessionListUiText("sidebar.group.uncategorized", "未分类");
}

function hasSessionListGroupingTemplateGroups() {
  return getSessionListGroupingTemplateGroups().length > 0;
}

function getDefaultSortSessionListButtonLabel() {
  if (!hasSessionListGroupingTemplateGroups()) {
    return translateSessionListUiText("sidebar.sortList.createFolderFirst", "先新建文件夹");
  }
  return translateSessionListUiText("sidebar.sortList.runTemplate", "整理到文件夹");
}

function getRunningSortSessionListButtonLabel() {
  return translateSessionListUiText("sidebar.sortList.runningTemplate", "整理中…");
}

function getDoneSortSessionListButtonLabel() {
  return translateSessionListUiText("sidebar.sortList.doneTemplate", "已整理到文件夹");
}

function getFailedSortSessionListButtonLabel() {
  return translateSessionListUiText("sidebar.sortList.failedTemplate", "整理失败");
}

function getSessionListOrganizerWritableFieldsText() {
  return typeof getSessionListContract()?.buildTaskListOrganizerWritableFieldsText === "function"
    ? getSessionListContract().buildTaskListOrganizerWritableFieldsText()
    : "`name`, `group`, and `sidebarOrder`";
}

function getSessionListOrganizerReadonlyFieldsText() {
  return typeof getSessionListContract()?.buildTaskListOrganizerReadonlyFieldsText === "function"
    ? getSessionListContract().buildTaskListOrganizerReadonlyFieldsText()
    : "`title`, `brief`, `existingGroup`, and `existingSidebarOrder`";
}

const SESSION_LIST_ORGANIZER_SYSTEM_PROMPT = [
  "You are MelodySync's hidden session-list organizer.",
  "Your job is to clean up the owner's visible MelodySync task list one task at a time.",
  "Do not rename tasks casually, delete them, change pin state, edit prompts, or ask the user follow-up questions.",
  "Only update existing sessions by calling the owner-authenticated MelodySync API from this machine.",
  "Use `melodysync api GET /api/sessions` if you need to double-check current state.",
  `Use \`melodysync api PATCH /api/sessions/<sessionId> --body ...\` to update ${getSessionListOrganizerWritableFieldsText()}.`,
  `Only writable API fields for this task are ${getSessionListOrganizerWritableFieldsText()}.`,
  `Never send read-only snapshot keys such as ${getSessionListOrganizerReadonlyFieldsText()}, \`currentGroup\`, or \`currentSidebarOrder\` in PATCH bodies.`,
  "Patch at most one existing session, and it must be the provided `targetSession.id`.",
  "Prefer changing only `group` for the target session.",
  'Rename only when the current task name is generic, stale, or clearly tool-generated.',
  "Do not reorder the whole list. If you patch `sidebarOrder`, only change the target session and never touch any other session.",
  'Keep group labels concise, stable, and task-shaped. Do not create a different group for every task.',
  'Follow the folder strategy provided in the task body. Stay inside the provided user folders plus the fallback folder.',
  'Example PATCH body: {"name":"电影史学习路线","group":"研究任务","sidebarOrder":3}',
  "If `melodysync` is unavailable in PATH, use `node \"$MELODYSYNC_PROJECT_ROOT/cli.js\" api ...` instead.",
  "`sidebarOrder` must be a positive integer when used.",
  "Default newly created or unclear work to the provided fallback group instead of inventing noisy categories.",
  "Return only a brief plain-text summary of what you changed for the single target session.",
].join("\n");

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setSortSessionListButtonState(label = getDefaultSortSessionListButtonLabel(), { busy = false } = {}) {
  if (!sortSessionListBtn) return;
  sortSessionListBtn.textContent = label || getDefaultSortSessionListButtonLabel();
  sortSessionListBtn.disabled = busy;
}

function getSessionListOrganizerAiQuickActionSessionId() {
  try {
    return String(localStorage.getItem(SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_STORAGE_KEY) || "")
      .trim();
  } catch {
    return "";
  }
}

function setSessionListOrganizerAiQuickActionSessionId(sessionId = "") {
  const normalized = String(sessionId || "").trim();
  try {
    if (!normalized) {
      localStorage.removeItem(SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_STORAGE_KEY);
    } else {
      localStorage.setItem(SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_STORAGE_KEY, normalized);
    }
  } catch {}
}

function clearSessionListOrganizerAiQuickActionSessionId() {
  setSessionListOrganizerAiQuickActionSessionId("");
}

function getStoredSessionListOrganizerLastFingerprint() {
  try {
    return String(localStorage.getItem(SESSION_LIST_ORGANIZER_LAST_FINGERPRINT_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setStoredSessionListOrganizerLastFingerprint(fingerprint = "") {
  const normalized = String(fingerprint || "").trim();
  sessionListOrganizerLastFingerprint = normalized;
  try {
    if (!normalized) {
      localStorage.removeItem(SESSION_LIST_ORGANIZER_LAST_FINGERPRINT_STORAGE_KEY);
    } else {
      localStorage.setItem(SESSION_LIST_ORGANIZER_LAST_FINGERPRINT_STORAGE_KEY, normalized);
    }
  } catch {}
  return normalized;
}

sessionListOrganizerLastFingerprint = getStoredSessionListOrganizerLastFingerprint();

function isSessionListOrganizerAiQuickActionCandidate(session = null) {
  if (!session?.id) return false;
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  const prompt = String(session?.systemPrompt || "");
  return session?.archived !== true
    && kind === "skill"
    && prompt.includes("You are MelodySync's hidden session-list organizer.");
}

function getSessionListOrganizerAiQuickActionSessionFromStore() {
  const quickActionSessionId = getSessionListOrganizerAiQuickActionSessionId();
  if (!quickActionSessionId) return null;
  const byId = (Array.isArray(sessions) ? sessions : []).find((entry) => entry?.id === quickActionSessionId);
  if (!isSessionListOrganizerAiQuickActionCandidate(byId)) {
    clearSessionListOrganizerAiQuickActionSessionId();
    return null;
  }
  return byId;
}

async function createSessionListOrganizerAiQuickActionSeedSession(payload) {
  const data = await fetchJsonOrRedirect("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder: "~",
      tool: payload?.tool || "codex",
      name: SESSION_LIST_ORGANIZER_SESSION_NAME,
      systemPrompt: SESSION_LIST_ORGANIZER_SYSTEM_PROMPT,
      internalRole: SESSION_LIST_ORGANIZER_INTERNAL_ROLE,
      sourceId: typeof DEFAULT_APP_ID === "string" ? DEFAULT_APP_ID : "chat",
    }),
  });
  return data?.session || null;
}

async function promoteSessionListOrganizerAiQuickAction(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return null;
  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(normalizedSessionId)}/promote-persistent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "skill",
      execution: {
        runPrompt: SESSION_LIST_ORGANIZER_AI_QUICK_ACTION_PROMPT,
      },
    }),
  });
  return data?.session || null;
}

async function runSessionListOrganizerAiQuickAction(sessionId = "", payload = null) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return null;
  }
  const messageResponse = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(normalizedSessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: buildSessionListOrganizerTask(payload),
      ...(payload?.model ? { model: payload.model } : {}),
      ...(payload?.effort ? { effort: payload.effort } : {}),
      ...(payload?.thinking ? { thinking: true } : {}),
    }),
  });
  const runId = typeof messageResponse?.run?.id === "string" ? messageResponse.run.id.trim() : "";
  if (!runId) {
    return null;
  }
  return waitForSessionListOrganizerRun(runId);
}

async function resolveSessionListOrganizerAiQuickAction(payload) {
  const existing = getSessionListOrganizerAiQuickActionSessionFromStore();
  if (existing) {
    return existing;
  }

  const seedSession = await createSessionListOrganizerAiQuickActionSeedSession(payload);
  const seedSessionId = typeof seedSession?.id === "string" ? seedSession.id.trim() : "";
  if (!seedSessionId) {
    throw new Error("Failed to create the organizer AI quick action");
  }

  const promotedSession = await promoteSessionListOrganizerAiQuickAction(seedSessionId);
  const promotedSessionId = typeof promotedSession?.id === "string" ? promotedSession.id.trim() : "";
  if (!promotedSessionId) {
    throw new Error("Failed to promote the organizer AI quick action");
  }
  setSessionListOrganizerAiQuickActionSessionId(promotedSessionId);
  return promotedSession;
}

function clipSessionListOrganizerText(value, maxChars = 240) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxChars
    ? `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
    : normalized;
}

function buildSessionListOrganizerStrategy() {
  const templateGroups = getSessionListGroupingTemplateGroups();
  return {
    mode: "user_template",
    fallbackGroup: getSessionListGroupingFallbackLabel(),
    templateGroups,
  };
}

function buildSessionListOrganizerStrategySummary(strategy = null) {
  const groups = Array.isArray(strategy?.templateGroups) ? strategy.templateGroups : [];
  if (groups.length === 0) {
    return "Folder grouping is active, but no user-created folders are configured yet.";
  }
  return `Use only these exact user-created folders, in this order: ${groups.join(", ")}. If no folder fits, use ${strategy.fallbackGroup || getSessionListGroupingFallbackLabel()}.`;
}

function isPersistentSessionForOrganizer(session) {
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  return kind === "skill"
    || kind === "recurring_task"
    || kind === "scheduled_task"
    || kind === "waiting_task";
}

function isGenericSessionTitleForOrganizer(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return true;
  return [
    "new session",
    "task",
    "任务",
    "initial task",
    "初始化任务",
  ].includes(normalized);
}

function isSessionReadyForOrganizer(session) {
  if (!session?.id || session?.archived === true) return false;
  if (isPersistentSessionForOrganizer(session)) return false;
  if (session?.autoRenamePending === true) return false;
  const name = String(session?.name || "").trim();
  return !!name && !isGenericSessionTitleForOrganizer(name);
}

function isPrimarySessionForOrganizer(session) {
  return String(session?.taskListVisibility || "primary").trim().toLowerCase() === "primary";
}

function getSessionListOrganizerPriority(session, strategy = null) {
  const fallbackGroup = String(strategy?.fallbackGroup || getSessionListGroupingFallbackLabel()).trim();
  const currentGroup = String(session?.group || "").trim();
  let score = 0;
  if (!currentGroup) score += 100;
  if (fallbackGroup && currentGroup === fallbackGroup) score += 80;
  if (!normalizeSessionSidebarOrderValue(session?.sidebarOrder)) score += 30;
  score += Math.min(Number.isInteger(session?.messageCount) ? session.messageCount : 0, 20);
  return score;
}

function selectSessionListOrganizerTarget(activeSessions = [], strategy = null) {
  const candidates = (Array.isArray(activeSessions) ? activeSessions : [])
    .filter(isPrimarySessionForOrganizer)
    .filter(isSessionReadyForOrganizer)
    .slice()
    .sort((left, right) => {
      const priorityDiff = getSessionListOrganizerPriority(right, strategy) - getSessionListOrganizerPriority(left, strategy);
      if (priorityDiff) return priorityDiff;
      const leftTime = Date.parse(left?.updatedAt || left?.created || "") || 0;
      const rightTime = Date.parse(right?.updatedAt || right?.created || "") || 0;
      return rightTime - leftTime;
    });
  return candidates[0] || null;
}

function buildSessionListOrganizerFingerprint(payload = null) {
  const target = payload?.targetSession || null;
  return JSON.stringify({
    strategy: {
      mode: payload?.strategy?.mode || "",
      fallbackGroup: payload?.strategy?.fallbackGroup || "",
      templateGroups: Array.isArray(payload?.strategy?.templateGroups)
        ? payload.strategy.templateGroups
        : [],
    },
    target: target ? [
      target?.id || "",
      target?.title || "",
      target?.existingGroup || "",
      Number.isInteger(target?.existingSidebarOrder) ? target.existingSidebarOrder : 0,
      target?.pinned === true ? 1 : 0,
    ] : [],
  });
}

function canRunAutoSessionOrganizer(now = Date.now()) {
  return !sessionListOrganizerLastAutoRunAt
    || now - sessionListOrganizerLastAutoRunAt >= SESSION_LIST_AUTO_ORGANIZER_MIN_INTERVAL_MS;
}

function clearSessionListOrganizerAutoRun() {
  if (sessionListOrganizerAutoTimer) {
    window.clearTimeout(sessionListOrganizerAutoTimer);
    sessionListOrganizerAutoTimer = null;
  }
}

async function saveTaskListTemplateGroups(groups = []) {
  const normalizedGroups = typeof getSessionListModelApi()?.normalizeSessionGroupingTemplateGroups === "function"
    ? getSessionListModelApi().normalizeSessionGroupingTemplateGroups(groups)
    : (Array.isArray(groups) ? groups : []);
  const data = await fetchJsonOrRedirect("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskListTemplateGroups: normalizedGroups,
    }),
  });
  applyGeneralSettingsPayload(data || null);
  if (typeof window?.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("melodysync:general-settings-updated", {
      detail: data || null,
    }));
  }
  return data || null;
}

globalThis.cancelSessionListOrganizerAutoRun = clearSessionListOrganizerAutoRun;
globalThis.saveTaskListTemplateGroups = saveTaskListTemplateGroups;

function scheduleSortSessionListButtonReset(delayMs = 1600) {
  if (sessionListOrganizerLabelResetTimer) {
    window.clearTimeout(sessionListOrganizerLabelResetTimer);
  }
  sessionListOrganizerLabelResetTimer = window.setTimeout(() => {
    sessionListOrganizerLabelResetTimer = null;
    setSortSessionListButtonState(getDefaultSortSessionListButtonLabel(), { busy: false });
  }, delayMs);
}

function getInitialInboxSessionName() {
  const translated = typeof window?.melodySyncT === "function"
    ? window.melodySyncT("sidebar.bootstrapSession")
    : "";
  return translated && translated !== "sidebar.bootstrapSession"
    ? translated
    : "Initial Task";
}

function getInboxGroupLabel() {
  const translated = typeof window?.melodySyncT === "function"
    ? window.melodySyncT("sidebar.group.inbox")
    : "";
  return translated && translated !== "sidebar.group.inbox"
    ? translated
    : "收集箱";
}

function getPreferredSessionCreationTool() {
  return [
    preferredTool,
    selectedTool,
    Array.isArray(toolsList) ? toolsList[0]?.id : "",
    typeof DEFAULT_TOOL_ID === "string" ? DEFAULT_TOOL_ID : "",
  ].find((value) => typeof value === "string" && value.trim()) || "";
}

async function ensureInitialInboxSession() {
  if (initialInboxSessionPromise) return initialInboxSessionPromise;
  const tool = getPreferredSessionCreationTool();
  if (!tool) return null;
  initialInboxSessionPromise = (async () => {
    try {
      const data = await fetchJsonOrRedirect("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: "~",
          tool,
          name: getInitialInboxSessionName(),
          group: getInboxGroupLabel(),
          sourceId: typeof DEFAULT_APP_ID === "string" ? DEFAULT_APP_ID : "chat",
        }),
      });
      const session = data?.session || null;
      if (!session) return null;
      applySessionListState([session], { archivedCount: 0 });
      const hasSelectedSession = currentSessionId
        && sessions.some((entry) => entry?.id === currentSessionId);
      if (!hasSelectedSession && typeof attachSession === "function") {
        attachSession(session.id, session);
      }
      const sidebarInteractionLocked = typeof globalThis.hasSidebarCollapseUserInteraction === "function"
        ? globalThis.hasSidebarCollapseUserInteraction()
        : false;
      if (!sidebarInteractionLocked && typeof globalThis.setSidebarCollapsed === "function") {
        globalThis.setSidebarCollapsed(true);
      }
      if (typeof window !== "undefined" && typeof window.MelodySyncWorkbench?.closeTaskMapDrawer === "function") {
        window.MelodySyncWorkbench.closeTaskMapDrawer();
      }
      if (typeof requestLayoutPass === "function") {
        requestLayoutPass("seed-session-layout");
      }
      return session;
    } catch (error) {
      console.warn("[sessions] Failed to create the initial inbox task:", error?.message || error);
      return null;
    } finally {
      initialInboxSessionPromise = null;
    }
  })();
  return initialInboxSessionPromise;
}

function buildSessionListOrganizerSessionMetadata(session) {
  const brief = typeof session?.description === "string"
    ? session.description.trim()
    : "";
  return {
    id: session?.id || "",
    title: clipSessionListOrganizerText(getSessionDisplayName(session), 160),
    brief: clipSessionListOrganizerText(brief, 280),
    existingGroup: typeof session?.group === "string" && session.group.trim()
      ? clipSessionListOrganizerText(session.group, 80)
      : null,
    existingSidebarOrder: Number.isInteger(session?.sidebarOrder) && session.sidebarOrder > 0
      ? session.sidebarOrder
      : null,
    taskListOrigin: clipSessionListOrganizerText(session?.taskListOrigin || "", 20),
    taskListVisibility: clipSessionListOrganizerText(session?.taskListVisibility || "", 20),
    pinned: session?.pinned === true,
    tool: clipSessionListOrganizerText(session?.tool || "", 40),
    sourceName: clipSessionListOrganizerText(session?.sourceName || "", 80),
    userName: clipSessionListOrganizerText(session?.userName || "", 80),
    folder: clipSessionListOrganizerText(session?.folder || "", 180),
    workflowState: clipSessionListOrganizerText(session?.workflowState || "", 40),
    workflowPriority: clipSessionListOrganizerText(session?.workflowPriority || "", 40),
    messageCount: Number.isInteger(session?.messageCount) ? session.messageCount : 0,
    created: clipSessionListOrganizerText(session?.created || "", 40),
    updatedAt: clipSessionListOrganizerText(session?.updatedAt || "", 40),
    lastEventAt: clipSessionListOrganizerText(session?.lastEventAt || "", 40),
  };
}

function buildSessionListOrganizerPayload() {
  const activeSessions = getActiveSessions()
    .filter(isPrimarySessionForOrganizer)
    .filter(isSessionReadyForOrganizer);
  const strategy = buildSessionListOrganizerStrategy();
  const targetSession = selectSessionListOrganizerTarget(activeSessions, strategy);
  const sessions = activeSessions
    .map(buildSessionListOrganizerSessionMetadata)
    .filter((session) => session.id);
  return {
    tool: selectedTool || preferredTool || "codex",
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(selectedEffort ? { effort: selectedEffort } : {}),
    thinking: thinkingEnabled === true,
    strategy,
    targetSession: targetSession ? buildSessionListOrganizerSessionMetadata(targetSession) : null,
    sessions,
  };
}

function maybeScheduleAutoSessionListOrganize() {
  clearSessionListOrganizerAutoRun();
}

function buildSessionListOrganizerTask(payload = null) {
  const strategy = payload?.strategy || buildSessionListOrganizerStrategy();
  const targetSession = payload?.targetSession || null;
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const taskPayload = {
    generatedAt: new Date().toISOString(),
    strategy,
    targetSession,
    totalSessions: sessions.length,
    sessions,
  };
  return [
    "Organize exactly one visible MelodySync task using the provided metadata snapshot.",
    buildSessionListOrganizerStrategySummary(strategy),
    "Patch at most one existing session, and it must be `targetSession.id`.",
    "Prefer changing only the target task group.",
    "Rename only when the current title is clearly weak, generic, or tool-generated.",
    "Do not reorder the whole list. If you patch `sidebarOrder`, only touch the target session.",
    "If the target task is already in a good state, make no changes.",
    "Apply changes by calling the MelodySync API from this machine; do not merely suggest them.",
    `Snapshot fields like ${getSessionListOrganizerReadonlyFieldsText()} are read-only context.`,
    `When patching a session, send only ${getSessionListOrganizerWritableFieldsText()} in the API body.`,
    `If a task does not fit any user folder, use ${strategy?.fallbackGroup || getSessionListGroupingFallbackLabel()}.`,
    "",
    "<session_list_organizer_input>",
    JSON.stringify(taskPayload, null, 2),
    "</session_list_organizer_input>",
  ].join("\n");
}

async function createSessionListOrganizerRun(payload) {
  const sessionResponse = await fetchJsonOrRedirect("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder: "~",
      tool: payload?.tool || "codex",
      name: "sort session list",
      systemPrompt: SESSION_LIST_ORGANIZER_SYSTEM_PROMPT,
      internalRole: SESSION_LIST_ORGANIZER_INTERNAL_ROLE,
    }),
  });
  const organizerSessionId = typeof sessionResponse?.session?.id === "string"
    ? sessionResponse.session.id.trim()
    : "";
  if (!organizerSessionId) {
    throw new Error("Failed to create the hidden session organizer");
  }

  const messageResponse = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(organizerSessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: buildSessionListOrganizerTask(payload),
      ...(payload?.model ? { model: payload.model } : {}),
      ...(payload?.effort ? { effort: payload.effort } : {}),
      ...(payload?.thinking ? { thinking: true } : {}),
    }),
  });

  return {
    session: sessionResponse?.session || null,
    run: messageResponse?.run || null,
  };
}

async function waitForSessionListOrganizerRun(runId) {
  return waitForDetachedRunCompletion(runId, {
    pollIntervalMs: SESSION_LIST_ORGANIZER_POLL_INTERVAL_MS,
    timeoutMs: SESSION_LIST_ORGANIZER_POLL_TIMEOUT_MS,
  });
}

async function waitForDetachedRunCompletion(
  runId,
  {
    pollIntervalMs = SESSION_ORGANIZER_POLL_INTERVAL_MS,
    timeoutMs = SESSION_ORGANIZER_POLL_TIMEOUT_MS,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await fetchJsonOrRedirect(`/api/runs/${encodeURIComponent(runId)}`, {
      revalidate: false,
    });
    const state = typeof data?.run?.state === "string" ? data.run.state : "";
    if (["completed", "failed", "cancelled"].includes(state)) {
      return data.run || null;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error("Timed out while waiting for the run to finish");
}

function buildSessionOrganizerPayload(session) {
  const attachedSession = session || (typeof getCurrentSession === "function" ? getCurrentSession() : null);
  return {
    tool: attachedSession?.tool || selectedTool || preferredTool || "codex",
    ...(attachedSession?.model ? { model: attachedSession.model } : {}),
    ...(attachedSession?.effort ? { effort: attachedSession.effort } : {}),
    ...(attachedSession?.thinking === true ? { thinking: true } : {}),
  };
}

async function organizeSessionById(sessionId, { viewportIntent = "preserve" } = {}) {
  const targetSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!targetSessionId) {
    throw new Error("Missing session id");
  }
  const session = sessions.find((entry) => entry?.id === targetSessionId) || null;
  const payload = buildSessionOrganizerPayload(session);
  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(targetSessionId)}/organize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (data.session) {
    const nextSession = upsertSession(data.session) || data.session;
    renderSessionList();
    if (currentSessionId === targetSessionId) {
      applyAttachedSessionState(targetSessionId, nextSession);
    }
  }
  const runId = typeof data?.run?.id === "string" ? data.run.id.trim() : "";
  if (!runId) {
    throw new Error("Organize task did not start a run");
  }
  const run = await waitForDetachedRunCompletion(runId);
  if (run?.state !== "completed") {
    throw new Error(run?.failureReason || `Organize task ${run?.state || "failed"}`);
  }
  if (currentSessionId === targetSessionId) {
    await refreshCurrentSession({ viewportIntent });
  } else {
    await refreshSidebarSession(targetSessionId);
  }
  return run;
}


function getSessionRunState(session) {
  return session?.activity?.run?.state === "running" ? "running" : "idle";
}

function hasRenderedEventSnapshot(sessionId) {
  const sameSession = renderedEventState.sessionId === sessionId;
  return sameSession && (
    renderedEventState.eventCount > 0
    || emptyState.parentNode === messagesInner
  );
}

function shouldFetchSessionEventsForRefresh(sessionId, session) {
  return true;
}

function getEventRenderPlan(sessionId, events) {
  const normalizedEvents = Array.isArray(events) ? events : [];
  const latestSeq = getLatestEventSeq(normalizedEvents);
  const nextBaseKeys = normalizedEvents.map((event) => getEventRenderBaseKey(event));
  const nextKeys = normalizedEvents.map((event) => getEventRenderKey(event));
  const sameSession = renderedEventState.sessionId === sessionId;
  const hasRenderedSnapshot = sameSession && (
    renderedEventState.eventCount > 0
    || emptyState.parentNode === messagesInner
  );

  if (!sameSession || !hasRenderedSnapshot) {
    return { mode: "reset", events: normalizedEvents };
  }

  if (
    latestSeq < renderedEventState.latestSeq ||
    normalizedEvents.length < renderedEventState.eventCount
  ) {
    return { mode: "reset", events: normalizedEvents };
  }

  if (latestSeq === renderedEventState.latestSeq && eventKeyArraysEqual(nextKeys, renderedEventState.eventKeys || [])) {
    return { mode: "noop", events: [] };
  }

  if (
    renderedEventState.runningBlockExpanded === true
    && normalizedEvents.length > 0
    && normalizedEvents.length === renderedEventState.eventCount
    && eventKeyArraysEqual(nextBaseKeys, renderedEventState.eventBaseKeys || [])
  ) {
    const lastEvent = normalizedEvents[normalizedEvents.length - 1];
    if (
      isRunningThinkingBlockEvent(lastEvent)
      && Number.isInteger(lastEvent?.blockEndSeq)
      && lastEvent.blockEndSeq > renderedEventState.latestSeq
    ) {
      return { mode: "refresh_running_block", events: [lastEvent] };
    }
  }

  if (eventKeyPrefixMatches(renderedEventState.eventKeys || [], nextKeys)) {
    const appendedEvents = normalizedEvents.slice((renderedEventState.eventKeys || []).length);
    if (appendedEvents.length > 0) {
      return { mode: "append", events: appendedEvents };
    }
  }

  return { mode: "reset", events: normalizedEvents };
}

function reconcilePendingMessageState(event) {
  if (typeof reconcileComposerPendingSendWithEvent === "function") {
    reconcileComposerPendingSendWithEvent(event);
  }
}

const pendingSessionReviewSyncs = new Map();

function normalizeSessionReviewStamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const time = new Date(trimmed).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function getSessionReviewStampTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSessionReviewStamp(session) {
  return normalizeSessionReviewStamp(session?.lastEventAt || session?.created || "");
}

function getEffectiveSessionReviewedAt(session) {
  const candidates = [
    normalizeSessionReviewStamp(session?.lastReviewedAt),
    normalizeSessionReviewStamp(session?.localReviewedAt),
    normalizeSessionReviewStamp(session?.reviewBaselineAt),
  ].filter(Boolean);
  let best = "";
  let bestTime = 0;
  for (const candidate of candidates) {
    const time = getSessionReviewStampTime(candidate);
    if (time > bestTime) {
      best = candidate;
      bestTime = time;
    }
  }
  return best;
}

function rememberSessionReviewedLocally(session, { render = false } = {}) {
  if (!session?.id) return "";
  const stamp = getSessionReviewStamp(session);
  if (!stamp) return "";
  if (getSessionReviewStampTime(stamp) <= getSessionReviewStampTime(getEffectiveSessionReviewedAt(session))) {
    return getEffectiveSessionReviewedAt(session);
  }
  const stored = typeof setLocalSessionReviewedAt === "function"
    ? setLocalSessionReviewedAt(session.id, stamp)
    : stamp;
  session.localReviewedAt = stored || stamp;
  if (render) {
    renderSessionList();
  }
  return session.localReviewedAt;
}

async function syncSessionReviewedToServer(session) {
  if (!session?.id) return session;
  const stamp = getSessionReviewStamp(session);
  if (!stamp) return session;
  if (getSessionReviewStampTime(stamp) <= getSessionReviewStampTime(normalizeSessionReviewStamp(session?.lastReviewedAt))) {
    return session;
  }
  const currentPending = pendingSessionReviewSyncs.get(session.id);
  if (getSessionReviewStampTime(currentPending) >= getSessionReviewStampTime(stamp)) {
    return session;
  }
  pendingSessionReviewSyncs.set(session.id, stamp);
  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReviewedAt: stamp }),
    });
    return upsertSession(data.session) || data.session || session;
  } finally {
    if (pendingSessionReviewSyncs.get(session.id) === stamp) {
      pendingSessionReviewSyncs.delete(session.id);
    }
  }
}

function markSessionReviewed(session, { sync = false, render = true } = {}) {
  const stamp = rememberSessionReviewedLocally(session, { render });
  if (!stamp || !sync) {
    return Promise.resolve(session);
  }
  return syncSessionReviewedToServer(session);
}

function markVisibleSessionReviewed(session, { sync = false } = {}) {
  if (!session?.id || currentSessionId !== session.id) {
    return Promise.resolve(session);
  }
  if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") {
    return Promise.resolve(session);
  }
  return markSessionReviewed(session, { sync, render: true });
}

function normalizeSessionLocalListOrder(value) {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSessionSidebarOrderValue(value) {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function assignSessionListOrderHints(entries = [], previousMap = null) {
  const previousOrders = previousMap instanceof Map
    ? [...previousMap.values()].map((session) => normalizeSessionLocalListOrder(session?._sessionListOrder))
    : [];
  let nextOrder = Math.max(
    0,
    ...entries.map((session) => normalizeSessionLocalListOrder(session?._sessionListOrder)),
    ...previousOrders,
  ) + 1;

  for (const session of Array.isArray(entries) ? entries : []) {
    if (!session?.id || session.archived === true) continue;
    if (normalizeSessionSidebarOrderValue(session?.sidebarOrder)) {
      delete session._sessionListOrder;
      continue;
    }
    const currentOrder = normalizeSessionLocalListOrder(session?._sessionListOrder);
    if (currentOrder) continue;
    const previousOrder = previousMap instanceof Map
      ? normalizeSessionLocalListOrder(previousMap.get(session.id)?._sessionListOrder)
      : 0;
    session._sessionListOrder = previousOrder || nextOrder;
    if (!previousOrder) {
      nextOrder += 1;
    }
  }
  return entries;
}

function normalizeSessionRecord(session, previous = null) {
  const queueCount = Number.isInteger(session?.activity?.queue?.count)
    ? session.activity.queue.count
    : 0;
  const normalized = { ...session };
  delete normalized.appId;
  delete normalized.appName;
  if (!Object.prototype.hasOwnProperty.call(session || {}, "queuedMessages")) {
    if (queueCount > 0 && Array.isArray(previous?.queuedMessages)) {
      normalized.queuedMessages = previous.queuedMessages;
    } else {
      delete normalized.queuedMessages;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(session || {}, "model")) {
    if (typeof previous?.model === "string") {
      normalized.model = previous.model;
    } else {
      delete normalized.model;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(session || {}, "effort")) {
    if (typeof previous?.effort === "string") {
      normalized.effort = previous.effort;
    } else {
      delete normalized.effort;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(session || {}, "thinking")) {
    if (previous?.thinking === true) {
      normalized.thinking = true;
    } else {
      delete normalized.thinking;
    }
  }
  const localReviewedAt = normalizeSessionReviewStamp(
    normalized.localReviewedAt
    || previous?.localReviewedAt
    || (typeof getLocalSessionReviewedAt === "function" ? getLocalSessionReviewedAt(normalized.id) : ""),
  );
  if (localReviewedAt) {
    normalized.localReviewedAt = localReviewedAt;
  } else {
    delete normalized.localReviewedAt;
  }
  const latestSessionStamp = normalizeSessionReviewStamp(
    normalized.lastEventAt
    || normalized.created
    || "",
  );
  const reviewBaselineAt = normalizeSessionReviewStamp(
    normalized.reviewBaselineAt
    || previous?.reviewBaselineAt
    || (typeof getSessionReviewBaselineAtForSession === "function"
      ? getSessionReviewBaselineAtForSession(normalized.id, latestSessionStamp)
      : (typeof getSessionReviewBaselineAt === "function" ? getSessionReviewBaselineAt() : "")),
  );
  if (reviewBaselineAt) {
    normalized.reviewBaselineAt = reviewBaselineAt;
  } else {
    delete normalized.reviewBaselineAt;
  }
  if (!normalizeSessionSidebarOrderValue(normalized.sidebarOrder)) {
    const previousOrder = normalizeSessionLocalListOrder(previous?._sessionListOrder);
    if (previousOrder) {
      normalized._sessionListOrder = previousOrder;
    }
  } else {
    delete normalized._sessionListOrder;
  }
  return normalized;
}

function upsertSession(session) {
  if (!session?.id) return null;
  const previous = sessions.find((entry) => entry.id === session.id);
  const normalized = normalizeSessionRecord(session, previous);
  const index = sessions.findIndex((entry) => entry.id === session.id);
  if (index === -1) {
    sessions.push(normalized);
  } else {
    sessions[index] = normalized;
  }
  assignSessionListOrderHints(sessions, previous ? new Map([[session.id, previous]]) : null);
  sortSessionsInPlace();
  if (typeof syncMelodySyncAppState === "function") {
    syncMelodySyncAppState();
  }
  handleCompletionAlerts(normalized, previous);
  return normalized;
}


async function fetchSessionSidebar(sessionId) {
  const url = getSessionSidebarUrl(sessionId);
  const data = await fetchJsonOrRedirect(url);
  return upsertSession(data.session);
}

async function fetchArchivedSessions() {
  if (archivedSessionsRefreshPromise) {
    return archivedSessionsRefreshPromise;
  }
  if (!archivedSessionsLoaded && archivedSessionCount === 0) {
    archivedSessionsLoaded = true;
    archivedSessionsLoading = false;
    renderSessionList();
    return [];
  }

  archivedSessionsLoading = true;
  renderSessionList();
  const request = (async () => {
    try {
      const data = await fetchJsonOrRedirect(ARCHIVED_SESSION_LIST_URL);
      return applyArchivedSessionListState(data.sessions || [], {
        archivedCount: Number.isInteger(data.archivedCount)
          ? data.archivedCount
          : (Array.isArray(data.sessions) ? data.sessions.length : 0),
      });
    } catch (error) {
      archivedSessionsLoading = false;
      renderSessionList();
      throw error;
    } finally {
      archivedSessionsRefreshPromise = null;
    }
  })();
  archivedSessionsRefreshPromise = request;
  return request;
}

async function fetchSessionsList() {
  const data = await fetchJsonOrRedirect(SESSION_LIST_URL);
  const nextSessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const nextArchivedCount = Number.isInteger(data?.archivedCount) ? data.archivedCount : 0;
  if (nextSessions.length === 0 && nextArchivedCount === 0) {
    const seededSession = await ensureInitialInboxSession();
    if (seededSession) {
      maybeScheduleAutoSessionListOrganize();
      return sessions;
    }
  }
  applySessionListState(nextSessions, {
    archivedCount: nextArchivedCount,
  });
  maybeScheduleAutoSessionListOrganize();
  return sessions;
}

async function organizeSessionListWithAgent({
  closeSidebar = false,
  auto = false,
  skipModeSwitch = false,
  expectedFingerprint = "",
} = {}) {
  if (sessionListOrganizerInFlight) return sessionListOrganizerInFlight;
  if (!hasSessionListGroupingTemplateGroups()) {
    setSortSessionListButtonState(getDefaultSortSessionListButtonLabel(), { busy: false });
    return false;
  }

  const payload = buildSessionListOrganizerPayload();
  const organizerFingerprint = expectedFingerprint || buildSessionListOrganizerFingerprint(payload);
  if (!payload?.targetSession?.id) {
    setSortSessionListButtonState("没有可整理的任务", { busy: false });
    scheduleSortSessionListButtonReset();
    return false;
  }
  if (auto && organizerFingerprint && organizerFingerprint === sessionListOrganizerLastFingerprint) {
    return false;
  }
  if (auto && !canRunAutoSessionOrganizer()) {
    return false;
  }

  if (sessionListOrganizerLabelResetTimer) {
    window.clearTimeout(sessionListOrganizerLabelResetTimer);
    sessionListOrganizerLabelResetTimer = null;
  }
  clearSessionListOrganizerAutoRun();
  setSortSessionListButtonState(getRunningSortSessionListButtonLabel(), { busy: true });

  const request = (async () => {
    try {
      if (auto) sessionListOrganizerLastAutoRunAt = Date.now();
      const data = await createSessionListOrganizerRun(payload);
      const runId = typeof data?.run?.id === "string" ? data.run.id.trim() : "";
      if (!runId) {
        throw new Error("Sort list did not start a run");
      }
      const run = await waitForSessionListOrganizerRun(runId);

      if (run?.state !== "completed") {
        throw new Error(run?.failureReason || `Sort list ${run?.state || "failed"}`);
      }

      await fetchSessionsList();
      setStoredSessionListOrganizerLastFingerprint(
        buildSessionListOrganizerFingerprint(buildSessionListOrganizerPayload()),
      );
      clearSessionListOrganizerAutoRun();
      if (closeSidebar && !isDesktop) {
        closeSidebarFn();
      }
      setSortSessionListButtonState(getDoneSortSessionListButtonLabel(), { busy: false });
      return true;
    } catch (error) {
      console.warn("[sessions] Failed to organize the session list:", error.message);
      setSortSessionListButtonState(
        auto
          ? getDefaultSortSessionListButtonLabel()
          : getFailedSortSessionListButtonLabel(),
        { busy: false },
      );
      return false;
    } finally {
      sessionListOrganizerInFlight = null;
      scheduleSortSessionListButtonReset();
    }
  })();

  sessionListOrganizerInFlight = request;
  return request;
}

function applyAttachedSessionState(id, session) {
  currentSessionId = id;
  hasAttachedSession = true;
  stopCompletionTitleFlash();
  if (completionAttentionSessionId && completionAttentionSessionId === id) {
    hideCompletionAttention();
  }
  if (typeof syncMelodySyncAppState === "function") {
    syncMelodySyncAppState();
  }
  currentTokens = 0;
  contextTokens.style.display = "none";

  const displayName = getSessionDisplayName(session);
  if (typeof document !== "undefined") {
    document.title = `${displayName} · MelodySync Chat`;
  }
  if (typeof reconcileComposerPendingSendWithSession === "function") {
    reconcileComposerPendingSendWithSession(session);
  }
  updateStatus("connected", session);
  if (typeof renderQueuedMessagePanel === "function") {
    renderQueuedMessagePanel(session);
  }
  if (session?.tool) {
    const availableTools = typeof allToolsList !== "undefined" && Array.isArray(allToolsList)
      ? allToolsList
      : (Array.isArray(toolsList) ? toolsList : []);
    const toolAvailable = availableTools.some((tool) => tool.id === session.tool);
    if (toolAvailable || availableTools.length === 0) {
      if (toolAvailable && typeof refreshPrimaryToolPicker === "function") {
        refreshPrimaryToolPicker({ keepToolIds: [session.tool], selectedValue: session.tool });
      }
      inlineToolSelect.value = session.tool;
      selectedTool = session.tool;
    }
    if (toolAvailable) {
      Promise.resolve(loadModelsForCurrentTool()).catch(() => {});
    }
  }

  restoreDraft();
  renderSessionList();
  syncBrowserState();
  if (typeof window !== "undefined" && typeof window.MelodySyncWorkbench?.setFocusedSessionId === "function") {
    window.MelodySyncWorkbench.setFocusedSessionId(id, { render: false });
  }
  if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
    document.dispatchEvent(new CustomEvent("melodysync:session-change", {
      detail: { session: session || null },
    }));
  }
  if (typeof window !== "undefined" && window.MelodySyncWorkbench?.refresh) {
    window.setTimeout(() => {
      void window.MelodySyncWorkbench.refresh();
    }, 0);
  }
}

async function fetchSessionState(sessionId) {
  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const normalized = upsertSession(data.session);
  if (normalized && currentSessionId === sessionId) {
    rememberSessionReviewedLocally(normalized);
    applyAttachedSessionState(sessionId, normalized);
  }
  return normalized;
}

async function fetchSessionEvents(sessionId, { runState = "idle", viewportIntent = "preserve" } = {}) {
  const normalizedViewportIntent = normalizeSessionViewportIntent(viewportIntent);
  const hadRenderedMessages =
    messagesInner.children.length > 0 && emptyState.parentNode !== messagesInner;
  const shouldStickToBottom =
    !hadRenderedMessages ||
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  const data = await fetchJsonOrRedirect(
    `/api/sessions/${encodeURIComponent(sessionId)}/events?filter=all`,
  );
  const events = data.events || [];
  if (currentSessionId !== sessionId) return events;
  window.MelodySyncGraphOpsUi?.replaceSessionProposals?.(sessionId, events);
  const renderPlan = getEventRenderPlan(sessionId, events);

  if (renderPlan.mode === "refresh_running_block") {
    const [runningEvent] = renderPlan.events;
    if (
      runningEvent
      && typeof refreshExpandedRunningThinkingBlock === "function"
      && refreshExpandedRunningThinkingBlock(sessionId, runningEvent)
    ) {
      updateRenderedEventState(sessionId, events, { runState });
      return renderPlan.events;
    }
  }

  if (renderPlan.mode === "reset") {
    const preserveRunningBlockExpanded =
      renderedEventState.sessionId === sessionId
      && renderedEventState.runningBlockExpanded === true;
    clearMessages({ preserveRunningBlockExpanded });
    if (events.length === 0) {
      showEmpty();
    }
    for (const event of events) {
      reconcilePendingMessageState(event);
      renderEvent(event, false);
    }
    if (messagesInner.children.length === 0) {
      showEmpty();
    }
    updateRenderedEventState(sessionId, events, { runState });
    const latestTurnStart = applyFinishedTurnCollapseState();
    if (shouldOpenCurrentSessionFromTop()) {
      scrollCurrentSessionViewportToTop();
    } else if (
      normalizedViewportIntent === "session_entry"
      && shouldFocusLatestTurnStartOnSessionEntry(sessionId, latestTurnStart)
    ) {
      scrollNodeToTop(latestTurnStart);
    } else if (events.length > 0 && shouldStickToBottom) {
      scrollToBottom();
    }
    return events;
  }

  if (renderPlan.mode === "append") {
    for (const event of renderPlan.events) {
      reconcilePendingMessageState(event);
      renderEvent(event, false);
    }
    updateRenderedEventState(sessionId, events, { runState });
    const latestTurnStart = applyFinishedTurnCollapseState();
    if (shouldOpenCurrentSessionFromTop()) {
      scrollCurrentSessionViewportToTop();
    } else if (
      normalizedViewportIntent === "session_entry"
      && shouldFocusLatestTurnStartOnSessionEntry(sessionId, latestTurnStart)
    ) {
      scrollNodeToTop(latestTurnStart);
    } else if (renderPlan.events.length > 0 && shouldStickToBottom) {
      scrollToBottom();
    }
    return renderPlan.events;
  }

  updateRenderedEventState(sessionId, events, { runState });
  const latestTurnStart = applyFinishedTurnCollapseState();
  if (shouldOpenCurrentSessionFromTop()) {
    scrollCurrentSessionViewportToTop();
  } else if (
    normalizedViewportIntent === "session_entry"
    && shouldFocusLatestTurnStartOnSessionEntry(sessionId, latestTurnStart)
  ) {
    scrollNodeToTop(latestTurnStart);
  }
  return events;
}

async function runCurrentSessionRefresh(
  sessionId,
  { viewportIntent = hasAttachedSession ? "preserve" : "session_entry" } = {},
) {
  const session = await fetchSessionState(sessionId);
  if (currentSessionId !== sessionId) return session;
  const runState = getSessionRunState(session);
  if (shouldFetchSessionEventsForRefresh(sessionId, session)) {
    await fetchSessionEvents(sessionId, { runState, viewportIntent });
    const latestSession = sessions.find((entry) => entry?.id === sessionId) || session;
    await Promise.resolve(markVisibleSessionReviewed(latestSession, {
      sync: !isSessionBusy(latestSession),
    })).catch(() => {});
    return latestSession;
  }
  renderedEventState.sessionId = sessionId;
  renderedEventState.runState = runState;
  await Promise.resolve(markVisibleSessionReviewed(session, {
    sync: !isSessionBusy(session),
  })).catch(() => {});
  return session;
}

async function refreshCurrentSession(
  { viewportIntent = hasAttachedSession ? "preserve" : "session_entry" } = {},
) {
  const sessionId = currentSessionId;
  if (!sessionId) return null;
  if (currentSessionRefreshPromise) {
    pendingCurrentSessionRefresh = true;
    return currentSessionRefreshPromise;
  }
  currentSessionRefreshPromise = (async () => {
    try {
      return await runCurrentSessionRefresh(sessionId, { viewportIntent });
    } finally {
      currentSessionRefreshPromise = null;
      if (pendingCurrentSessionRefresh) {
        pendingCurrentSessionRefresh = false;
        refreshCurrentSession().catch(() => {});
      }
    }
  })();
  return currentSessionRefreshPromise;
}

async function refreshSidebarSession(sessionId) {
  if (!sessionId) return null;
  if (sessionId === currentSessionId) {
    return refreshCurrentSession();
  }
  if (sidebarSessionRefreshPromises.has(sessionId)) {
    pendingSidebarSessionRefreshes.add(sessionId);
    return sidebarSessionRefreshPromises.get(sessionId);
  }
  const request = (async () => {
    try {
      const session = await fetchSessionSidebar(sessionId);
      if (session) {
        renderSessionList();
      }
      return session;
    } catch (error) {
      if (error?.message === "Session not found") {
        const nextSessions = sessions.filter((session) => session.id !== sessionId);
        if (nextSessions.length !== sessions.length) {
          sessions = nextSessions;
          renderSessionList();
        }
        return null;
      }
      throw error;
    } finally {
      sidebarSessionRefreshPromises.delete(sessionId);
      if (pendingSidebarSessionRefreshes.delete(sessionId)) {
        refreshSidebarSession(sessionId).catch(() => {});
      }
    }
  })();
  sidebarSessionRefreshPromises.set(sessionId, request);
  return request;
}

async function refreshRealtimeViews({ viewportIntent = "preserve" } = {}) {
  await fetchSessionsList().catch(() => {});
  if (archivedSessionsLoaded) {
    await fetchArchivedSessions().catch(() => {});
  }
  if (currentSessionId) {
    await refreshCurrentSession({ viewportIntent }).catch(() => {});
  }
}

function startParallelCurrentSessionBootstrap() {
  if (!currentSessionId) return;
  refreshCurrentSession({ viewportIntent: "session_entry" }).catch((error) => {
    if (error?.message === "Session not found") return;
    console.warn(
      "[sessions] Failed to bootstrap the current session in parallel:",
      error?.message || error,
    );
  });
}

async function bootstrapViaHttp({ deferOwnerRestore = false } = {}) {
  if (deferOwnerRestore) {
    startParallelCurrentSessionBootstrap();
  }
  await fetchSessionsList();
  if (!deferOwnerRestore) {
    restoreOwnerSessionSelection();
  }
}

function normalizePushApplicationServerKey(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array();
}

function pushApplicationServerKeysMatch(subscription, expectedKey) {
  const currentKey = normalizePushApplicationServerKey(
    subscription?.options?.applicationServerKey || null,
  );
  const nextKey = normalizePushApplicationServerKey(expectedKey);
  if (!currentKey.length || !nextKey.length || currentKey.length !== nextKey.length) {
    return false;
  }
  for (let index = 0; index < currentKey.length; index += 1) {
    if (currentKey[index] !== nextKey[index]) return false;
  }
  return true;
}

async function setupPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return {
      ok: false,
      error: "当前浏览器不支持 Web Push 订阅。",
    };
  }
  try {
    const persistSubscription = async (subscription) => {
      const payload = subscription?.toJSON ? subscription.toJSON() : subscription;
      if (!payload?.endpoint) return;
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response?.ok) {
        throw new Error(`保存浏览器订阅失败（${response?.status || "unknown"}）`);
      }
    };
    const reg = await navigator.serviceWorker.register(
      `/sw.js?v=${encodeURIComponent(buildAssetVersion)}`,
      { updateViaCache: "none" },
    );
    await reg.update().catch(() => {});
    reg.installing?.postMessage({ type: "melodysync:clear-caches" });
    reg.waiting?.postMessage({ type: "melodysync:clear-caches" });
    reg.active?.postMessage({ type: "melodysync:clear-caches" });
    await navigator.serviceWorker.ready;
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) {
      throw new Error(`获取推送公钥失败（${res.status || "unknown"}）`);
    }
    const { publicKey } = await res.json();
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      if (!pushApplicationServerKeysMatch(existing, applicationServerKey)) {
        await existing.unsubscribe().catch(() => {});
      } else {
        await persistSubscription(existing);
        return {
          ok: true,
          reused: true,
        };
      }
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    await persistSubscription(sub);
    console.log("[push] Subscribed to web push");
    return {
      ok: true,
      renewed: true,
    };
  } catch (err) {
    console.warn("[push] Setup failed:", err.message);
    return {
      ok: false,
      error: err?.message || "浏览器订阅失败",
    };
  }
}
