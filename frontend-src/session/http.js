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
  applyTaskListTemplateGroupSetting(settings);
  return settings;
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

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

globalThis.saveTaskListTemplateGroups = saveTaskListTemplateGroups;

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
      return sessions;
    }
  }
  applySessionListState(nextSessions, {
    archivedCount: nextArchivedCount,
  });
  return sessions;
}

function applyAttachedSessionState(id, session) {
  currentSessionId = id;
  hasAttachedSession = true;
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

