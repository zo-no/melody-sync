function createEmptySessionStatus() {
  return sessionStateModel.createEmptyStatus();
}

function getSessionActivity(session) {
  return sessionStateModel.normalizeSessionActivity(session);
}

function isSessionBusy(session) {
  return sessionStateModel.isSessionBusy(session);
}

function getSessionStatusSummary(session, { includeToolFallback = false } = {}) {
  return sessionStateModel.getSessionStatusSummary(session, { includeToolFallback });
}

function getSessionVisualStatus(session, options = {}) {
  return getSessionStatusSummary(session, options).primary;
}

function refreshSessionAttentionUi(sessionId = currentSessionId) {
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
  if (
    sessionId
    && sessionId === currentSessionId
    && typeof updateStatus === "function"
    && typeof getCurrentSession === "function"
  ) {
    const session = getCurrentSession();
    updateStatus("connected", session);
  }
}

// Thinking block state
let currentThinkingBlock = null; // { el, body, tools: Set }
let inThinkingBlock = false;

function initializePushNotifications() {
  if (!("Notification" in window)) return;
  const setupPushNotificationsFn =
    typeof globalThis.setupPushNotifications === "function"
      ? globalThis.setupPushNotifications
      : typeof globalThis.MelodySyncRuntime?.setupPushNotifications === "function"
        ? globalThis.MelodySyncRuntime.setupPushNotifications
        : null;
  if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        if (typeof setupPushNotificationsFn !== "function") return;
        setupPushNotificationsFn().then((result) => {
          if (result?.ok === false) {
            console.warn("[push] Auto-subscribe failed:", result.error || "unknown_error");
          }
        });
      }
    });
  } else if (Notification.permission === "granted") {
    if (typeof setupPushNotificationsFn !== "function") return;
    setupPushNotificationsFn().then((result) => {
      if (result?.ok === false) {
        console.warn("[push] Auto-subscribe failed:", result.error || "unknown_error");
      }
    });
  }
}

function persistActiveSessionId(sessionId) {
  if (sessionId) {
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
  } else {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }
}

function persistActiveSidebarTab(tab) {
  localStorage.setItem(
    ACTIVE_SIDEBAR_TAB_STORAGE_KEY,
    normalizeSidebarTab(tab),
  );
}

function buildNavigationUrl(state = {}) {
  const nextSessionId =
    state.sessionId === undefined ? currentSessionId : state.sessionId;
  const nextTab = normalizeSidebarTab(
    state.tab === undefined ? activeTab : state.tab,
  );
  const url = new URL(window.location.href);
  url.searchParams.delete("source");
  if (nextSessionId) url.searchParams.set("session", nextSessionId);
  else url.searchParams.delete("session");
  if (nextTab !== "sessions") {
    url.searchParams.set("tab", nextTab);
  } else {
    url.searchParams.delete("tab");
  }
  return `${url.pathname}${url.search}`;
}

function syncBrowserState(state = {}) {
  const nextSessionId =
    state.sessionId === undefined ? currentSessionId : state.sessionId;
  const nextTab = normalizeSidebarTab(
    state.tab === undefined ? activeTab : state.tab,
  );
  persistActiveSessionId(nextSessionId);
  persistActiveSidebarTab(nextTab);
  const nextUrl = buildNavigationUrl({
    sessionId: nextSessionId,
    tab: nextTab,
  });
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl !== currentUrl) {
    history.replaceState(null, "", nextUrl);
  }
}

function getEffectiveSessionSourceName(session) {
  const explicitSourceName = typeof session?.sourceName === "string"
    ? session.sourceName.trim()
    : "";
  if (explicitSourceName) return explicitSourceName;
  const sourceId = typeof session?.sourceId === "string"
    ? session.sourceId.trim()
    : "";
  if (!sourceId || sourceId.toLowerCase() === DEFAULT_APP_ID) return "";
  return sourceId;
}

function getVisibleActiveSessions() {
  return getActiveSessions().filter((session) => !session.pinned);
}

function getVisiblePinnedSessions() {
  return getActiveSessions().filter((session) => session.pinned === true);
}

function getVisibleArchivedSessions() {
  return getArchivedSessions();
}

function getSessionSortTime(session) {
  if (typeof sessionStateModel.getSessionSortTime === "function") {
    return sessionStateModel.getSessionSortTime(session);
  }
  const stamp = session?.lastEventAt || session?.updatedAt || session?.created || "";
  const time = new Date(stamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSessionPinSortRank(session) {
  return session?.pinned === true ? 1 : 0;
}

function compareSessionListSessions(a, b) {
  if (typeof sessionStateModel.compareSessionListSessions === "function") {
    return sessionStateModel.compareSessionListSessions(a, b);
  }
  return getSessionSortTime(b) - getSessionSortTime(a);
}

function sortSessionsInPlace() {
  sessions.sort((a, b) => (
    getSessionPinSortRank(b) - getSessionPinSortRank(a)
    || compareSessionListSessions(a, b)
  ));
}

function getArchivedSessionSortTime(session) {
  const stamp = session?.archivedAt || session?.lastEventAt || session?.updatedAt || session?.created || "";
  const time = new Date(stamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getActiveSessions() {
  return sessions.filter((session) => !session.archived);
}

function getArchivedSessions() {
  return sessions
    .filter((session) => session.archived)
    .slice()
    .sort((a, b) => getArchivedSessionSortTime(b) - getArchivedSessionSortTime(a));
}

function getSessionCatalogRecordById(sessionId = "") {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) return null;
  return sessions.find((session) => session?.id === normalizedSessionId) || null;
}

function normalizeCatalogPersistentKind(value) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
  return normalized === "recurring_task" ? "recurring_task" : "";
}

function getCatalogLongTermTaskPoolMembership(session) {
  const membership = session?.taskPoolMembership?.longTerm;
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) return null;
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  const projectSessionId = typeof membership?.projectSessionId === "string"
    ? membership.projectSessionId.trim()
    : "";
  if (!projectSessionId) return null;
  const requestedRole = typeof membership?.role === "string"
    ? membership.role.trim().toLowerCase()
    : "";
  const role = requestedRole === "project"
    ? "project"
    : (projectSessionId === sessionId ? "project" : "member");
  return {
    role,
    projectSessionId,
    fixedNode: membership?.fixedNode === true || role === "project",
  };
}

function isLongTermProjectRootSession(session) {
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  if (!sessionId) return false;
  const membership = getCatalogLongTermTaskPoolMembership(session);
  if (membership?.role === "project" && membership?.fixedNode === true) {
    return membership.projectSessionId === sessionId;
  }
  return normalizeCatalogPersistentKind(session?.persistent?.kind) === "recurring_task";
}

function resolveLongTermProjectRootSessionId(session, visited = new Set()) {
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  if (!sessionId || visited.has(sessionId)) return "";
  const membership = getCatalogLongTermTaskPoolMembership(session);
  if (membership?.projectSessionId) return membership.projectSessionId;
  if (isLongTermProjectRootSession(session)) return sessionId;

  const nextVisited = new Set(visited);
  nextVisited.add(sessionId);
  const candidateIds = [];
  const rootSessionId = typeof session?.rootSessionId === "string" ? session.rootSessionId.trim() : "";
  const sourceRootSessionId = typeof session?.sourceContext?.rootSessionId === "string"
    ? session.sourceContext.rootSessionId.trim()
    : "";
  const branchParentSessionId = typeof session?._branchParentSessionId === "string"
    ? session._branchParentSessionId.trim()
    : (typeof session?.branchParentSessionId === "string" ? session.branchParentSessionId.trim() : "");
  const parentSessionId = typeof session?.sourceContext?.parentSessionId === "string"
    ? session.sourceContext.parentSessionId.trim()
    : "";
  for (const candidateId of [rootSessionId, sourceRootSessionId, branchParentSessionId, parentSessionId]) {
    if (!candidateId || candidateId === sessionId || candidateIds.includes(candidateId)) continue;
    candidateIds.push(candidateId);
  }
  for (const candidateId of candidateIds) {
    const candidate = getSessionCatalogRecordById(candidateId);
    if (!candidate) continue;
    const resolvedRootSessionId = resolveLongTermProjectRootSessionId(candidate, nextVisited);
    if (resolvedRootSessionId) return resolvedRootSessionId;
  }
  return "";
}

function getSidebarTabForSession(session) {
  if (isLongTermProjectRootSession(session)) return "long-term";
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  if (kind === "skill") return "skill";
  return "sessions";
}

function sessionMatchesSidebarTab(session, tab = activeTab) {
  return getSidebarTabForSession(session) === normalizeSidebarTab(tab);
}

function getLatestSession() {
  return sessions[0] || null;
}

function getLatestActiveSession() {
  return sessions.find((session) => !session.archived) || null;
}

function getLatestSessionForSidebarTab(tab = activeTab) {
  return sessions.find((session) => sessionMatchesSidebarTab(session, tab)) || null;
}

function getLatestActiveSessionForSidebarTab(tab = activeTab) {
  return sessions.find((session) => !session.archived && sessionMatchesSidebarTab(session, tab)) || null;
}

function getLatestSessionForCurrentFilters() {
  return sessions.find((session) => matchesCurrentFilters(session)) || null;
}

function getLatestActiveSessionForCurrentFilters() {
  return sessions.find(
    (session) => !session.archived && matchesCurrentFilters(session),
  ) || null;
}

function resolveRestoreTargetSession() {
  const preferredTab = pendingNavigationState?.tab || activeTab;
  if (pendingNavigationState?.sessionId) {
    const requested = sessions.find(
      (session) => session.id === pendingNavigationState.sessionId,
    );
    if (requested) return requested;
  }
  if (currentSessionId) {
    const current = sessions.find((session) => session.id === currentSessionId);
    if (current) {
      if (preferredTab === "long-term") {
        const longTermRootSessionId = resolveLongTermProjectRootSessionId(current);
        const longTermRootSession = getSessionCatalogRecordById(longTermRootSessionId);
        if (longTermRootSession && longTermRootSession.archived !== true) {
          return longTermRootSession;
        }
      }
      if (sessionMatchesSidebarTab(current, preferredTab)) {
        return current;
      }
    }
  }
  return getLatestActiveSessionForSidebarTab(preferredTab)
    || getLatestSessionForSidebarTab(preferredTab);
}

function applyNavigationState(rawState) {
  const next = normalizeNavigationState(rawState);
  if (next.tab) {
    switchTab(next.tab, { syncState: false });
  }
  pendingNavigationState = next.sessionId ? next : null;
  if (next.sessionId) {
    const target = sessions.find((session) => session.id === next.sessionId);
    const targetTab = next.tab || getSidebarTabForSession(target) || activeTab;
    if (target) {
      if (targetTab !== activeTab) {
        switchTab(targetTab, { syncState: false });
      }
      attachSession(target.id, target);
      pendingNavigationState = null;
    } else {
      dispatchAction({ action: "list" });
    }
    syncBrowserState({
      sessionId: next.sessionId,
      tab: targetTab,
    });
    return;
  }
  syncBrowserState({ tab: next.tab || activeTab });
}
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}
