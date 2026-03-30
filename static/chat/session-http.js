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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "remotelab:open-session") return;
    applyNavigationState(event.data);
    window.focus();
  });
}

function notifyCompletion(session) {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  if (document.visibilityState === "visible") return;
  const folder = (session?.folder || "").split("/").pop() || "Session";
  const name = session?.name || folder;
  const n = new Notification("MelodySync", {
    body: `${name} — task completed`,
    tag: "melodysync-done",
  });
  n.onclick = () => {
    window.focus();
    applyNavigationState({ sessionId: session?.id, tab: "sessions" });
    n.close();
  };
}

const SESSION_LIST_ORGANIZER_POLL_INTERVAL_MS = 1200;
const SESSION_LIST_ORGANIZER_POLL_TIMEOUT_MS = 90 * 1000;
const SESSION_LIST_ORGANIZER_INTERNAL_ROLE = "session_list_organizer";
const DEFAULT_SORT_SESSION_LIST_BUTTON_LABEL = "整理任务";
const SESSION_ORGANIZER_POLL_INTERVAL_MS = 1200;
const SESSION_ORGANIZER_POLL_TIMEOUT_MS = 90 * 1000;
let sessionListOrganizerInFlight = null;
let sessionListOrganizerLabelResetTimer = null;

const SESSION_LIST_ORGANIZER_SYSTEM_PROMPT = [
  "You are MelodySync's hidden session-list organizer.",
  "Your job is to organize the owner's non-archived MelodySync tasks into a simple GTD-style task list.",
  "Do not rename sessions, delete them, change pin state, edit prompts, or ask the user follow-up questions.",
  "Only update existing sessions by calling the owner-authenticated MelodySync API from this machine.",
  "Use `melodysync api GET /api/sessions` if you need to double-check current state.",
  "Use `melodysync api PATCH /api/sessions/<sessionId> --body ...` to update `group` and `sidebarOrder`.",
  "Only writable API fields for this task are `group` and `sidebarOrder`.",
  "Never send read-only snapshot keys such as `title`, `brief`, `existingGroup`, `existingSidebarOrder`, `currentGroup`, or `currentSidebarOrder` in PATCH bodies.",
  "Example PATCH body: {\"group\":\"短期任务\",\"sidebarOrder\":3}",
  "If `melodysync` is unavailable in PATH, use `node \"$REMOTELAB_PROJECT_ROOT/cli.js\" api ...` instead.",
  "`sidebarOrder` must be a positive integer; smaller numbers sort first.",
  "Assign unique contiguous `sidebarOrder` values across the current non-archived sessions you organize.",
  "Use only these exact groups: 收集箱, 长期任务, 短期任务, 知识库内容, 等待任务.",
  "Default unclear or newly created work to 收集箱; only move work out when the intent is obvious from the metadata snapshot.",
  "Return only a brief plain-text summary of the grouping strategy you applied.",
].join("\n");

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setSortSessionListButtonState(label = DEFAULT_SORT_SESSION_LIST_BUTTON_LABEL, { busy = false } = {}) {
  if (!sortSessionListBtn) return;
  sortSessionListBtn.textContent = label || DEFAULT_SORT_SESSION_LIST_BUTTON_LABEL;
  sortSessionListBtn.disabled = busy;
}

function clipSessionListOrganizerText(value, maxChars = 240) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxChars
    ? `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
    : normalized;
}

function scheduleSortSessionListButtonReset(delayMs = 1600) {
  if (sessionListOrganizerLabelResetTimer) {
    window.clearTimeout(sessionListOrganizerLabelResetTimer);
  }
  sessionListOrganizerLabelResetTimer = window.setTimeout(() => {
    sessionListOrganizerLabelResetTimer = null;
    setSortSessionListButtonState(DEFAULT_SORT_SESSION_LIST_BUTTON_LABEL, { busy: false });
  }, delayMs);
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
    pinned: session?.pinned === true,
    tool: clipSessionListOrganizerText(session?.tool || "", 40),
    appName: clipSessionListOrganizerText(session?.appName || "", 80),
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
  const activeSessions = getActiveSessions();
  return {
    tool: selectedTool || preferredTool || "codex",
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(selectedEffort ? { effort: selectedEffort } : {}),
    thinking: thinkingEnabled === true,
    sessions: activeSessions.map(buildSessionListOrganizerSessionMetadata).filter((session) => session.id),
  };
}

function buildSessionListOrganizerTask(sessions) {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalSessions: Array.isArray(sessions) ? sessions.length : 0,
    sessions: Array.isArray(sessions) ? sessions : [],
  };
  return [
    "Organize the current non-archived MelodySync task list using the provided metadata snapshot.",
    "Classify tasks into 收集箱, 长期任务, 短期任务, 知识库内容, 等待任务, and improve sidebar ordering inside those groups.",
    "Apply changes by calling the MelodySync API from this machine; do not merely suggest them.",
    "Snapshot fields like `title`, `brief`, `existingGroup`, and `existingSidebarOrder` are read-only context.",
    "When patching a session, send only `group` and `sidebarOrder` in the API body.",
    "",
    "<session_list_organizer_input>",
    JSON.stringify(payload, null, 2),
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
      text: buildSessionListOrganizerTask(payload?.sessions || []),
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
  const runState = getSessionRunState(session);
  if (runState !== "running") return true;
  if (!hasRenderedEventSnapshot(sessionId)) return true;
  if (renderedEventState.runState !== "running") return true;
  return renderedEventState.runningBlockExpanded === true;
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
  return normalizeSessionReviewStamp(session?.lastEventAt || session?.updatedAt || session?.created || "");
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
  const normalized = {
    ...session,
    appId: getEffectiveSessionAppId(session),
  };
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
  const reviewBaselineAt = normalizeSessionReviewStamp(
    normalized.reviewBaselineAt
    || previous?.reviewBaselineAt
    || (typeof getSessionReviewBaselineAt === "function" ? getSessionReviewBaselineAt() : ""),
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
  refreshAppCatalog();
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
  applySessionListState(data.sessions || [], {
    archivedCount: Number.isInteger(data.archivedCount) ? data.archivedCount : 0,
  });
  return sessions;
}

async function organizeSessionListWithAgent({ closeSidebar = false } = {}) {
  if (sessionListOrganizerInFlight) return sessionListOrganizerInFlight;

  const payload = buildSessionListOrganizerPayload();
  if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    setSortSessionListButtonState("没有可整理的任务", { busy: false });
    scheduleSortSessionListButtonReset();
    return false;
  }

  if (sessionListOrganizerLabelResetTimer) {
    window.clearTimeout(sessionListOrganizerLabelResetTimer);
    sessionListOrganizerLabelResetTimer = null;
  }
  setSortSessionListButtonState("整理中…", { busy: true });

  const request = (async () => {
    try {
      const data = await createSessionListOrganizerRun(payload);
      const runId = typeof data?.run?.id === "string" ? data.run.id.trim() : "";
      if (runId) {
        const run = await waitForSessionListOrganizerRun(runId);
        if (run?.state !== "completed") {
          throw new Error(run?.failureReason || `Sort list ${run?.state || "failed"}`);
        }
      } else {
        throw new Error("Sort list did not start a run");
      }
      await fetchSessionsList();
      if (closeSidebar && !isDesktop) {
        closeSidebarFn();
      }
      setSortSessionListButtonState("已整理", { busy: false });
      return true;
    } catch (error) {
      console.warn("[sessions] Failed to organize the session list:", error.message);
      setSortSessionListButtonState("整理失败", { busy: false });
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
  syncForkButton();
  if (typeof syncOrganizeSessionButton === "function") {
    syncOrganizeSessionButton();
  }
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
    `/api/sessions/${encodeURIComponent(sessionId)}/events?filter=visible`,
  );
  const events = data.events || [];
  if (currentSessionId !== sessionId) return events;
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
    return session;
  }
  renderedEventState.sessionId = sessionId;
  renderedEventState.runState = runState;
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
          refreshAppCatalog();
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

async function setupPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const persistSubscription = async (subscription) => {
      const payload = subscription?.toJSON ? subscription.toJSON() : subscription;
      if (!payload?.endpoint) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    };
    const reg = await navigator.serviceWorker.register(
      `/sw.js?v=${encodeURIComponent(buildAssetVersion)}`,
      { updateViaCache: "none" },
    );
    await reg.update().catch(() => {});
    reg.installing?.postMessage({ type: "remotelab:clear-caches" });
    reg.waiting?.postMessage({ type: "remotelab:clear-caches" });
    reg.active?.postMessage({ type: "remotelab:clear-caches" });
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await persistSubscription(existing);
      return;
    }
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return;
    const { publicKey } = await res.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await persistSubscription(sub);
    console.log("[push] Subscribed to web push");
  } catch (err) {
    console.warn("[push] Setup failed:", err.message);
  }
}
