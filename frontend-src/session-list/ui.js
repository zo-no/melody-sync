// ---- Session list ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

function getSessionListModel() {
  return window.MelodySyncSessionListModel || null;
}

function getSessionGroupingModeForList() {
  const model = getSessionListModel();
  return typeof model?.getSessionGroupingMode === "function"
    ? model.getSessionGroupingMode()
    : "user";
}

function getSessionGroupInfoForList(session, options = {}) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session, options);
  if (entry?.groupInfo) return entry.groupInfo;
  return model?.getSessionGroupInfo?.(session, options) || {
    key: "group:inbox",
    label: t("sidebar.group.inbox"),
    title: t("sidebar.group.inbox"),
    order: 0,
  };
}

function isUserTemplateFolderGroup(groupKey = "") {
  return String(groupKey || "").startsWith("group:template:");
}

function isBranchTaskSessionForList(session, options = {}) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session, options);
  if (entry) return entry.branch === true;
  return model?.isBranchTaskSession?.(session) === true;
}

function shouldShowSessionInSidebarForList(session, options = {}) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session, options);
  if (entry) return entry.visible !== false;
  return model?.shouldShowSessionInSidebar?.(session, options) !== false;
}

function buildSessionListMetaHtml(session, options = {}) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session, options);
  const metaParts = typeof buildSessionMetaParts === "function"
    ? buildSessionMetaParts(session)
    : [];
  const badges = Array.isArray(entry?.badges)
    ? entry.badges
    : (Array.isArray(model?.getSessionListBadges?.(session))
      ? model.getSessionListBadges(session)
      : []);
  const badgeHtml = Array.isArray(badges)
    ? badges
        .filter((badge) => !(options?.hideBranchBadge === true && badge?.key === "branch"))
        .filter((badge) => badge?.label)
        .map((badge) => `<span class="${esc(badge.className || "session-list-badge")}" title="${esc(badge.title || badge.label)}">${esc(badge.label)}</span>`)
    : [];
  return [...badgeHtml, ...metaParts].join(" · ");
}

function getSidebarPersistentKind(session) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session);
  if (typeof entry?.persistentKind === "string") return entry.persistentKind;
  if (typeof model?.getSidebarPersistentKind === "function") {
    return model.getSidebarPersistentKind(session);
  }
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  return kind === "recurring_task" ? "recurring_task" : (kind === "skill" ? "skill" : "");
}

function getPersistentDockGroupKey(session) {
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session);
  if (typeof entry?.persistentDockGroupKey === "string") return entry.persistentDockGroupKey;
  if (typeof model?.getPersistentDockGroupKey === "function") {
    return model.getPersistentDockGroupKey(session);
  }
  const kind = getSidebarPersistentKind(session);
  if (kind === "recurring_task") return "group:long-term";
  if (kind === "skill") return "group:quick-actions";
  return "";
}

function canRunSidebarQuickAction(session, { archived = false } = {}) {
  if (archived || session?.archived === true) return false;
  if (getSidebarPersistentKind(session) !== "skill") return false;
  const activity = typeof getSessionActivity === "function"
    ? getSessionActivity(session)
    : { run: { state: "idle" }, compact: { state: "idle" }, queue: { count: 0 } };
  return activity.run?.state !== "running"
    && activity.compact?.state !== "pending"
    && (!Number.isInteger(activity.queue?.count) || activity.queue.count === 0);
}

function buildSidebarSessionActions(session, { archived = false } = {}) {
  const isArchivedSession = archived || session?.archived === true;
  const entry = getSessionListModel()?.getSessionListEntry?.(session, { archived: isArchivedSession }) || null;
  const baseActions = typeof buildSessionActionConfigs === "function"
    ? buildSessionActionConfigs(session, { archived: isArchivedSession })
    : [];
  const visibleBaseActions = isArchivedSession
    ? baseActions
    : baseActions
      .filter((actionEntry) => actionEntry?.action !== "delete")
      .map((actionEntry) => {
        if (actionEntry?.action !== "archive" || entry?.staleInfo?.stage !== "cleanup") {
          return actionEntry;
        }
        return {
          ...actionEntry,
          label: t("action.cleanup"),
          className: "cleanup",
        };
      });
  const renameAction = isArchivedSession ? null : {
    key: "rename",
    label: t("action.rename"),
    icon: "edit",
    className: "rename",
    onClick(event, currentSession, itemEl) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!itemEl || !currentSession?.id) return;
      startRename(itemEl, currentSession);
    },
  };
  const actionList = [renameAction, ...visibleBaseActions].filter(Boolean);
  if (!canRunSidebarQuickAction(session, { archived })) {
    return actionList;
  }
  return [
    {
      key: "quick-run",
      label: "触发快捷按钮",
      icon: "send",
      className: "quick-run",
      onClick(event) {
        event?.preventDefault?.();
        if (typeof dispatchAction !== "function") return;
        dispatchAction({
          action: "persistent_run",
          sessionId: session.id,
          runtime: window.MelodySyncSessionTooling?.getCurrentRuntimeSelectionSnapshot?.() || undefined,
        });
      },
    },
    ...actionList,
  ];
}

function createSidebarSessionItem(session, { archived = false } = {}) {
  const entry = getSessionListModel()?.getSessionListEntry?.(session, { archived }) || null;
  const isBranch = entry ? entry.branch === true : isBranchTaskSessionForList(session, { archived });
  const persistentKind = entry?.persistentKind || getSidebarPersistentKind(session);
  const extraClassNames = [];
  if (archived) extraClassNames.push("archived-item");
  if (isBranch) extraClassNames.push(archived ? "is-archived-branch" : "is-branch-session");
  if (persistentKind === "skill" || persistentKind === "recurring_task") {
    extraClassNames.push("is-persistent-item");
  }
  if (persistentKind === "skill") extraClassNames.push("is-quick-action-item");
  if (persistentKind === "recurring_task") extraClassNames.push("is-persistent-recurring-item");
  if (entry?.staleInfo?.itemClass) extraClassNames.push(entry.staleInfo.itemClass);
  const branchBadge = Array.isArray(entry?.badges)
    ? entry.badges.find((badge) => badge?.key === "branch" && badge?.label)
    : null;
  const titlePrefixHtml = isBranch
    ? `<span class="session-title-badge session-title-badge-branch" title="${esc(branchBadge?.label || t("sidebar.branchTag"))}">${esc(branchBadge?.label || t("sidebar.branchTag"))}</span>`
    : "";
  const metaOverrideHtml = buildSessionListMetaHtml(session, { archived, hideBranchBadge: isBranch });
  const item = createActiveSessionItem(session, {
    extraClassName: extraClassNames.join(" "),
    actions: buildSidebarSessionActions(session, { archived }),
    compactActions: typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : (typeof isDesktop === "boolean" ? !isDesktop : false),
    ...(titlePrefixHtml ? { titlePrefixHtml } : {}),
    ...(metaOverrideHtml ? { metaOverrideHtml } : {}),
  });
  return item;
}

function getPersistentDockGroupLabel(groupKey) {
  if (groupKey === "group:quick-actions") return t("sidebar.group.quickActions");
  if (groupKey === "group:long-term") return t("sidebar.group.longTerm");
  return t(groupKey);
}

function getPersistentSidebarGroupInfo(groupKey) {
  const label = getPersistentDockGroupLabel(groupKey);
  if (groupKey === "group:long-term") {
    return {
      key: groupKey,
      label,
      title: label,
      order: 90000,
    };
  }
  if (groupKey === "group:quick-actions") {
    return {
      key: groupKey,
      label,
      title: label,
      order: 90001,
    };
  }
  return {
    key: groupKey,
    label,
    title: label,
    order: 90002,
  };
}

function resetSessionListFooter() {
  if (!sessionListFooter) return;
  sessionListFooter.innerHTML = "";
  sessionListFooter.className = "session-list-footer";
  sessionListFooter.hidden = true;
}

function appendSessionItems(host, entries = [], options = {}) {
  for (const session of Array.isArray(entries) ? entries : []) {
    if (!session?.id || !shouldShowSessionInSidebarForList(session, options)) continue;
    host.appendChild(createSidebarSessionItem(session, options));
  }
}

function persistCollapsedGroupState(groupKey, collapsed) {
  collapsedFolders[groupKey] = collapsed === true;
  localStorage.setItem(
    COLLAPSED_GROUPS_STORAGE_KEY,
    JSON.stringify(collapsedFolders),
  );
}

function getSessionListGroupPriority(groupEntry) {
  const groupKey = String(groupEntry?.key || "").trim();
  if (groupKey === "group:quick-actions") return -2;
  if (groupKey === "group:long-term") return -1;
  return 0;
}

function getActiveSidebarTabForList() {
  return typeof window.getActiveSidebarTab === "function"
    ? window.getActiveSidebarTab()
    : "sessions";
}

function isLongTermProjectSessionForList(session) {
  const model = getSessionListModel();
  if (typeof model?.isLongTermProjectSession === "function") {
    return model.isLongTermProjectSession(session);
  }
  return getSidebarPersistentKind(session) === "recurring_task";
}

function isLongTermLineSessionForList(session) {
  const model = getSessionListModel();
  if (typeof model?.isLongTermLineSession === "function") {
    return model.isLongTermLineSession(session);
  }
  return isLongTermProjectSessionForList(session);
}

function shouldIncludeSessionInSidebarTab(session, tab = getActiveSidebarTabForList()) {
  return tab === "long-term"
    ? isLongTermProjectSessionForList(session)
    : !isLongTermProjectSessionForList(session);
}

function filterSessionsForSidebarTab(entries = [], tab = getActiveSidebarTabForList()) {
  return (Array.isArray(entries) ? entries : []).filter((session) => shouldIncludeSessionInSidebarTab(session, tab));
}

function getSessionStateModelForList() {
  return window.MelodySyncSessionStateModel || null;
}

function getSessionFocusReason(session) {
  const stateModel = getSessionStateModelForList();
  const workflowState = typeof stateModel?.normalizeSessionWorkflowState === "function"
    ? stateModel.normalizeSessionWorkflowState(session?.workflowState || "")
    : "";
  const activity = typeof stateModel?.normalizeSessionActivity === "function"
    ? stateModel.normalizeSessionActivity(session)
    : { run: { state: "idle" } };
  const hasUnreadUpdate = typeof stateModel?.hasSessionUnreadUpdate === "function"
    ? stateModel.hasSessionUnreadUpdate(session)
    : false;
  const workflowPriority = typeof stateModel?.getSessionWorkflowPriorityInfo === "function"
    ? stateModel.getSessionWorkflowPriorityInfo(session)
    : null;

  if (workflowState === "waiting_user") {
    return { key: "waiting", rank: 0, label: payloadSafeTranslate("sidebar.focus.reason.waiting", "等待你") };
  }
  if (activity?.run?.state === "running") {
    return { key: "running", rank: 1, label: payloadSafeTranslate("sidebar.focus.reason.running", "进行中") };
  }
  if (hasUnreadUpdate) {
    return { key: "updated", rank: 2, label: payloadSafeTranslate("sidebar.focus.reason.updated", "有更新") };
  }
  if (workflowPriority?.key === "high") {
    return { key: "priority", rank: 3, label: payloadSafeTranslate("sidebar.focus.reason.priority", "优先处理") };
  }
  return null;
}

function getSessionFocusSectionData(entries = []) {
  const stateModel = getSessionStateModelForList();
  const deduped = [];
  const seen = new Set();
  for (const session of Array.isArray(entries) ? entries : []) {
    const sessionId = String(session?.id || "").trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    deduped.push(session);
  }

  const focusEntries = deduped
    .filter((session) => !getSidebarPersistentKind(session))
    .map((session) => ({
      session,
      reason: getSessionFocusReason(session),
    }))
    .filter((entry) => entry.reason);

  focusEntries.sort((left, right) => {
    const rankDiff = (left.reason?.rank || 0) - (right.reason?.rank || 0);
    if (rankDiff) return rankDiff;
    if (typeof stateModel?.compareSessionListSessions === "function") {
      return stateModel.compareSessionListSessions(left.session, right.session);
    }
    return String(left.session?.id || "").localeCompare(String(right.session?.id || ""));
  });

  const focusSessions = focusEntries.slice(0, 3).map((entry) => entry.session);
  const reasonCounts = new Map();
  for (const entry of focusEntries.slice(0, 3)) {
    const reasonKey = String(entry.reason?.key || "").trim();
    if (!reasonKey) continue;
    reasonCounts.set(reasonKey, (reasonCounts.get(reasonKey) || 0) + 1);
  }
  const reasonLabelByKey = new Map(focusEntries.map((entry) => [entry.reason.key, entry.reason.label]));
  const hintParts = ["waiting", "running", "updated", "priority"]
    .filter((key) => reasonCounts.has(key))
    .map((key) => `${reasonLabelByKey.get(key) || key} ${reasonCounts.get(key)}`);

  return {
    sessions: focusSessions,
    hintLabel: hintParts.join(" · "),
  };
}

function clipSidebarLongTermContextText(value, max = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function getSessionLongTermStateForSidebar(session) {
  const longTerm = session?.sessionState?.longTerm;
  if (!longTerm || typeof longTerm !== "object" || Array.isArray(longTerm)) return null;
  const rootSessionId = String(longTerm?.rootSessionId || "").trim();
  if (!rootSessionId) return null;
  const role = String(longTerm?.role || "").trim().toLowerCase();
  return {
    lane: String(longTerm?.lane || "").trim().toLowerCase() === "long-term" ? "long-term" : "sessions",
    role: role === "project" || role === "member" ? role : "",
    rootSessionId,
    rootTitle: String(longTerm?.rootTitle || "").trim(),
    rootSummary: String(longTerm?.rootSummary || "").trim(),
  };
}

function getSessionLongTermRootIdForSidebar(session) {
  const projected = getSessionLongTermStateForSidebar(session);
  if (projected?.rootSessionId) return projected.rootSessionId;
  const sessionId = String(session?.id || "").trim();
  return isLongTermProjectSessionForList(session) ? sessionId : "";
}

function getSidebarLongTermContextData(tab = getActiveSidebarTabForList()) {
  if (tab === "long-term") return null;
  const currentSession = Array.isArray(sessions)
    ? sessions.find((session) => session?.id === currentSessionId) || null
    : null;
  const longTermState = getSessionLongTermStateForSidebar(currentSession);
  if (!currentSession?.id || longTermState?.role !== "member" || !longTermState.rootSessionId) {
    return null;
  }

  const rootSessionId = longTermState.rootSessionId;
  const rootSession = Array.isArray(sessions)
    ? sessions.find((session) => session?.id === rootSessionId) || null
    : null;
  const rootTitle = clipSidebarLongTermContextText(
    longTermState.rootTitle
      || (typeof getPreferredSessionDisplayName === "function" ? getPreferredSessionDisplayName(rootSession) : "")
      || (typeof getSessionDisplayName === "function" ? getSessionDisplayName(rootSession) : "")
      || String(rootSession?.name || "").trim()
      || "长期任务",
    48,
  );
  const rootSummary = clipSidebarLongTermContextText(
    longTermState.rootSummary
      || rootSession?.persistent?.digest?.summary
      || rootSession?.taskCard?.checkpoint
      || rootSession?.taskCard?.summary
      || rootSession?.description
      || "",
    160,
  );
  const relatedSessions = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.archived !== true)
    .filter((session) => String(session?.id || "").trim() !== rootSessionId)
    .filter((session) => String(session?.id || "").trim() !== String(currentSession?.id || "").trim())
    .filter((session) => getSessionLongTermRootIdForSidebar(session) === rootSessionId)
    .filter((session) => shouldShowSessionInSidebarForList(session))
    .slice()
    .sort((left, right) => {
      const stateModel = getSessionStateModelForList();
      if (typeof stateModel?.compareSessionListSessions === "function") {
        return stateModel.compareSessionListSessions(left, right);
      }
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    })
    .slice(0, 3);
  const memberCount = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.archived !== true)
    .filter((session) => String(session?.id || "").trim() !== rootSessionId)
    .filter((session) => getSessionLongTermRootIdForSidebar(session) === rootSessionId)
    .length;

  return {
    rootSessionId,
    rootTitle,
    rootSummary,
    memberCount,
    relatedSessions,
  };
}

function renderSidebarLongTermContextSection(contextData = null) {
  if (!contextData?.rootSessionId) return null;
  const section = document.createElement("section");
  section.className = "session-long-term-context";
  section.innerHTML = `
    <div class="session-long-term-context-header">
      <div class="session-long-term-context-kicker">${esc(payloadSafeTranslate("sidebar.longTerm.context.kicker", "归属长期任务"))}</div>
      <div class="session-long-term-context-title">${esc(contextData.rootTitle || "长期任务")}</div>
      <div class="session-long-term-context-summary">${esc(
        contextData.rootSummary
          || payloadSafeTranslate("sidebar.longTerm.context.summary", "当前会话继续留在普通列表执行，右侧任务地图跟随这个长期任务。"),
      )}</div>
      <div class="session-long-term-context-meta">
        <span class="session-long-term-context-chip">${esc(payloadSafeTranslate("sidebar.longTerm.context.current", "当前会话已归入"))}</span>
        <span class="session-long-term-context-chip">${esc(
          `${payloadSafeTranslate("sidebar.longTerm.context.memberCount", "维护项")} ${Math.max(1, Number(contextData.memberCount) || 0)}`,
        )}</span>
      </div>
    </div>`;
  if (Array.isArray(contextData.relatedSessions) && contextData.relatedSessions.length > 0) {
    const related = document.createElement("div");
    related.className = "session-long-term-context-related";

    const label = document.createElement("div");
    label.className = "session-long-term-context-related-label";
    label.textContent = payloadSafeTranslate("sidebar.longTerm.context.related", "同长期任务下的维护项");
    related.appendChild(label);

    const items = document.createElement("div");
    items.className = "session-long-term-context-items";
    appendSessionItems(items, contextData.relatedSessions);
    related.appendChild(items);
    section.appendChild(related);
  }
  return section;
}

function renderFocusSection({ focusSessions = [], focusLabel = "", hintLabel = "" } = {}) {
  if (!Array.isArray(focusSessions) || focusSessions.length === 0) return null;
  const section = document.createElement("div");
  section.className = "session-focus-section";

  const header = document.createElement("div");
  header.className = "session-focus-header";
  header.innerHTML = `
    <div class="session-focus-header-main">
      <div class="session-focus-title">${esc(focusLabel)}</div>
      ${hintLabel ? `<div class="session-focus-note">${esc(hintLabel)}</div>` : ""}
    </div>
    <span class="folder-count">${focusSessions.length}</span>`;

  const items = document.createElement("div");
  items.className = "session-focus-items";
  appendSessionItems(items, focusSessions);

  section.appendChild(header);
  section.appendChild(items);
  return section;
}

function renderSessionList() {
  const activeSidebarTab = getActiveSidebarTabForList();
  const isLongTermTab = activeSidebarTab === "long-term";
  const longTermContext = getSidebarLongTermContextData(activeSidebarTab);
  const groupingMode = getSessionGroupingModeForList();
  const showGroupingFolderControls = !isLongTermTab;
  const pinnedSessions = filterSessionsForSidebarTab(
    getVisiblePinnedSessions().filter((session) => shouldShowSessionInSidebarForList(session)),
    activeSidebarTab,
  );
  const visibleSessions = filterSessionsForSidebarTab(
    getVisibleActiveSessions().filter((session) => shouldShowSessionInSidebarForList(session)),
    activeSidebarTab,
  );
  const focusSection = isLongTermTab
    ? { sessions: [], hintLabel: "" }
    : getSessionFocusSectionData([...pinnedSessions, ...visibleSessions]);

  const groups = new Map();
  for (const session of visibleSessions) {
    if (!session?.id) continue;
    const persistentDockGroupKey = getPersistentDockGroupKey(session);
    const groupInfo = isLongTermTab
      ? {
          key: "group:long-term-projects",
          label: payloadSafeTranslate("sidebar.longTerm.projects", "长期任务"),
          title: payloadSafeTranslate("sidebar.longTerm.projects", "长期任务"),
          order: 0,
        }
      : (persistentDockGroupKey
        ? getPersistentSidebarGroupInfo(persistentDockGroupKey)
        : getSessionGroupInfoForList(session));
    if (!groups.has(groupInfo.key)) {
      groups.set(groupInfo.key, { ...groupInfo, sessions: [], insertOrder: groups.size });
    }
    groups.get(groupInfo.key).sessions.push(session);
  }

  const showGroupHeaders = groups.size > 0;
  const orderedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const leftPriority = getSessionListGroupPriority(left);
    const rightPriority = getSessionListGroupPriority(right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftOrder = Number.isInteger(left?.order) ? left.order : 100000;
    const rightOrder = Number.isInteger(right?.order) ? right.order : 100000;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

  const archivedSessions = filterSessionsForSidebarTab(
    (typeof getVisibleArchivedSessions === "function" ? getVisibleArchivedSessions() : [])
      .filter((session) => shouldShowSessionInSidebarForList(session, { archived: true })),
    activeSidebarTab,
  );
  const isArchivedSessionsLoading = typeof archivedSessionsLoading !== "undefined" && archivedSessionsLoading === true;
  const hasArchivedSessionsLoaded = typeof archivedSessionsLoaded !== "undefined" && archivedSessionsLoaded === true;
  const archivedSessionTotal = Number(typeof archivedSessionCount === "undefined" ? 0 : archivedSessionCount) || 0;
  const ARCHIVED_FOLDER_KEY = "folder:archived";
  const archivedCollapsed = collapsedFolders[ARCHIVED_FOLDER_KEY] === true;
  const shouldRenderArchivedSection = isLongTermTab
    ? archivedSessions.length > 0
    : (isArchivedSessionsLoading || archivedSessionTotal > 0 || archivedSessions.length > 0);
  const archivedCount = isLongTermTab
    ? archivedSessions.length
    : (hasArchivedSessionsLoaded
      ? archivedSessions.length
      : Math.max(archivedSessionTotal, archivedSessions.length));
  const sessionsLoaded = typeof hasLoadedSessions !== "undefined" && hasLoadedSessions === true;
  const shouldShowSessionListEmptyState =
    focusSection.sessions.length === 0
    && pinnedSessions.length === 0
    && orderedGroups.length === 0
    && !shouldRenderArchivedSection;
  const sessionListEmptyLabel = shouldShowSessionListEmptyState
    ? payloadSafeTranslate(
      sessionsLoaded
        ? (isLongTermTab ? "sidebar.longTerm.empty" : "sidebar.noSessions")
        : "sidebar.loadingSessions",
      sessionsLoaded
        ? (isLongTermTab ? "还没有长期任务" : "还没有任务")
        : "加载任务中…",
    )
    : "";
  const isGroupingCreateOpen = typeof window.isSessionGroupingTemplateCreateOpen === "function"
    ? window.isSessionGroupingTemplateCreateOpen()
    : false;

  const externalRenderer = window.MelodySyncSessionListReactUi;
  if (typeof externalRenderer?.renderSessionList === "function") {
    const rendered = externalRenderer.renderSessionList({
      sessionListEl: sessionList,
      sessionListFooterEl: sessionListFooter,
      pinnedSessions,
      contextPanel: longTermContext
        ? {
          rootSessionId: longTermContext.rootSessionId,
          kicker: payloadSafeTranslate("sidebar.longTerm.context.kicker", "归属长期任务"),
          title: longTermContext.rootTitle || "长期任务",
          summary: longTermContext.rootSummary
            || payloadSafeTranslate("sidebar.longTerm.context.summary", "当前会话继续留在普通列表执行，右侧任务地图跟随这个长期任务。"),
          chips: [
            payloadSafeTranslate("sidebar.longTerm.context.current", "当前会话已归入"),
            `${payloadSafeTranslate("sidebar.longTerm.context.memberCount", "维护项")} ${Math.max(1, Number(longTermContext.memberCount) || 0)}`,
          ],
          relatedLabel: payloadSafeTranslate("sidebar.longTerm.context.related", "同长期任务下的维护项"),
          relatedSessions: longTermContext.relatedSessions,
        }
        : null,
      focus: {
        sessions: focusSection.sessions,
        titleLabel: payloadSafeTranslate("sidebar.focus.title", "焦点"),
        hintLabel: focusSection.hintLabel,
      },
      groups: orderedGroups.map(([groupKey, groupEntry]) => ({
        key: groupKey,
        label: groupEntry.label,
        title: groupEntry.title,
        sessions: groupEntry.sessions,
        collapsed: collapsedFolders[groupKey] === true,
        canDelete: showGroupingFolderControls && isUserTemplateFolderGroup(groupKey),
      })),
      showGroupHeaders,
      grouping: {
        mode: groupingMode,
        showCreateFolder: showGroupingFolderControls,
        createFolderLabel: payloadSafeTranslate("sidebar.grouping.createFolder", "新建文件夹"),
        createFolderPlaceholder: payloadSafeTranslate("sidebar.grouping.createFolderPlaceholder", "输入文件夹名称"),
        createFolderHint: payloadSafeTranslate("sidebar.grouping.createFolderHint", "Enter 保存，Esc 取消"),
        saveFailedLabel: payloadSafeTranslate("sidebar.grouping.saveFailed", "文件夹保存失败。"),
        deleteFolderLabel: payloadSafeTranslate("sidebar.grouping.deleteFolder", "删除文件夹"),
        isCreatingFolder: showGroupingFolderControls && isGroupingCreateOpen,
      },
      archived: {
        sessions: archivedSessions,
        shouldRenderSection: shouldRenderArchivedSection,
        isCollapsed: archivedCollapsed,
        count: archivedCount,
        loading: isArchivedSessionsLoading,
        loaded: hasArchivedSessionsLoaded,
        total: archivedSessionTotal,
        emptyText: getFilteredSessionEmptyText({ archived: true }),
        storageKey: ARCHIVED_FOLDER_KEY,
      },
      emptyState: {
        show: shouldShowSessionListEmptyState,
        label: sessionListEmptyLabel,
      },
      helpers: {
        t,
        esc,
        renderUiIcon,
        appendSessionItems,
        createSessionItem: createSidebarSessionItem,
        getSessionRenderKey: typeof getSessionDisplayRenderKey === "function"
          ? getSessionDisplayRenderKey
          : null,
      },
      actions: {
        setGroupCollapsed(groupKey, collapsed) {
          persistCollapsedGroupState(groupKey, collapsed);
          renderSessionList();
        },
        openGroupingCreate(anchorEl) {
          window.openSessionGroupingTemplatePopoverAtAnchor?.(anchorEl, { runAfterSave: false });
        },
        closeGroupingCreate() {
          window.closeSessionGroupingTemplateCreate?.();
        },
        createTemplateFolder(label) {
          if (typeof window.saveSessionGroupingTemplateGroup !== "function") {
            return Promise.resolve({
              ok: false,
              reason: payloadSafeTranslate("sidebar.grouping.saveFailed", "文件夹保存失败。"),
            });
          }
          return window.saveSessionGroupingTemplateGroup(label);
        },
        removeTemplateFolder(groupLabel) {
          void window.removeSessionGroupingTemplateGroup?.(groupLabel, { runAfterSave: false });
        },
        ensureArchivedLoaded() {
          if (!archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
            void fetchArchivedSessions().catch((error) => {
              console.warn("[sessions] Failed to load archived tasks:", error?.message || error);
            });
          }
        },
      },
    });
    if (rendered === true) {
      resetSessionListFooter();
      return;
    }
  }

  sessionList.innerHTML = "";

  const longTermContextEl = renderSidebarLongTermContextSection(longTermContext);
  if (longTermContextEl) {
    sessionList.appendChild(longTermContextEl);
  }

  const focusSectionEl = renderFocusSection({
    focusSessions: focusSection.sessions,
    focusLabel: payloadSafeTranslate("sidebar.focus.title", "焦点"),
    hintLabel: focusSection.hintLabel,
  });
  if (focusSectionEl) {
    sessionList.appendChild(focusSectionEl);
  }

  if (pinnedSessions.length > 0) {
    const section = document.createElement("div");
    section.className = "pinned-section";

    const header = document.createElement("div");
    header.className = "pinned-section-header";
    header.innerHTML = `<span class="pinned-label">${esc(t("sidebar.pinned"))}</span><span class="folder-count">${pinnedSessions.length}</span>`;

    const items = document.createElement("div");
    items.className = "pinned-items";
    appendSessionItems(items, pinnedSessions);

    section.appendChild(header);
    section.appendChild(items);
    sessionList.appendChild(section);
  }

  if (shouldShowSessionListEmptyState) {
    const empty = document.createElement("div");
    empty.className = "session-list-empty";
    empty.textContent = sessionListEmptyLabel;
    sessionList.appendChild(empty);
  }

  for (const [groupKey, groupEntry] of orderedGroups) {
    const groupSessions = groupEntry.sessions;
    const group = document.createElement("div");
    group.className = "folder-group" + (showGroupHeaders ? "" : " is-ungrouped");

    if (showGroupHeaders) {
      const header = document.createElement("div");
      header.className =
        "folder-group-header" +
        (collapsedFolders[groupKey] ? " collapsed" : "");
      header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
        <span class="folder-name" title="${esc(groupEntry.title)}">${esc(groupEntry.label)}</span>
        <span class="folder-count">${groupSessions.length}</span>`;
      if (showGroupingFolderControls && isUserTemplateFolderGroup(groupKey)) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "folder-group-delete";
        deleteBtn.title = payloadSafeTranslate("sidebar.grouping.deleteFolder", "删除文件夹");
        deleteBtn.setAttribute("aria-label", deleteBtn.title);
        deleteBtn.innerHTML = renderUiIcon("trash");
        deleteBtn.addEventListener("click", (event) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          void window.removeSessionGroupingTemplateGroup?.(groupEntry.label, { runAfterSave: false });
        });
        header.appendChild(deleteBtn);
      }
      header.addEventListener("click", () => {
      header.classList.toggle("collapsed");
        persistCollapsedGroupState(groupKey, header.classList.contains("collapsed"));
        items.hidden = collapsedFolders[groupKey] === true;
      });
      group.appendChild(header);
    }

    const items = document.createElement("div");
    items.className = "folder-group-items";
    items.hidden = showGroupHeaders && collapsedFolders[groupKey] === true;
    appendSessionItems(items, groupSessions);

    group.appendChild(items);
    sessionList.appendChild(group);
  }

  if (showGroupingFolderControls) {
    const createSection = document.createElement("div");
    createSection.className = "session-grouping-create-section";
    if (isGroupingCreateOpen) {
      const draft = document.createElement("div");
      draft.className = "session-grouping-create-draft";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "session-grouping-create-input";
      input.placeholder = payloadSafeTranslate("sidebar.grouping.createFolderPlaceholder", "输入文件夹名称");
      input.setAttribute("aria-label", payloadSafeTranslate("sidebar.grouping.createFolder", "新建文件夹"));
      const note = document.createElement("div");
      note.className = "session-grouping-create-note";
      note.textContent = payloadSafeTranslate("sidebar.grouping.createFolderHint", "Enter 保存，Esc 取消");

      let saving = false;
      async function commit() {
        if (saving) return;
        saving = true;
        input.disabled = true;
        note.textContent = `${payloadSafeTranslate("action.save", "保存")}…`;
        try {
          const result = await window.saveSessionGroupingTemplateGroup?.(input.value);
          if (result?.ok) return;
          note.textContent = result?.reason || payloadSafeTranslate("sidebar.grouping.saveFailed", "文件夹保存失败。");
          input.disabled = false;
          input.focus();
          input.select();
          saving = false;
        } catch (error) {
          note.textContent = error?.message || payloadSafeTranslate("sidebar.grouping.saveFailed", "文件夹保存失败。");
          input.disabled = false;
          input.focus();
          input.select();
          saving = false;
        }
      }

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          window.closeSessionGroupingTemplateCreate?.();
        }
      });

      draft.appendChild(input);
      draft.appendChild(note);
      createSection.appendChild(draft);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else {
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "session-grouping-create-btn";
      createBtn.textContent = `+ ${payloadSafeTranslate("sidebar.grouping.createFolder", "新建文件夹")}`;
      createBtn.addEventListener("click", (event) => {
        window.openSessionGroupingTemplatePopoverAtAnchor?.(event.currentTarget, { runAfterSave: false });
      });
      createSection.appendChild(createBtn);
    }
    sessionList.appendChild(createSection);
  }

  resetSessionListFooter();
  renderArchivedSection();
}

function payloadSafeTranslate(key, fallback) {
  if (typeof t !== "function") return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
}

function renderArchivedSection() {
  const existing = document.getElementById("archivedSection");
  if (existing) existing.remove();
  const activeSidebarTab = getActiveSidebarTabForList();
  const isLongTermTab = activeSidebarTab === "long-term";
  const archivedSessions = filterSessionsForSidebarTab(
    getVisibleArchivedSessions().filter((session) => shouldShowSessionInSidebarForList(session, { archived: true })),
    activeSidebarTab,
  );
  const shouldRenderSection = isLongTermTab
    ? archivedSessions.length > 0
    : (archivedSessionsLoading || archivedSessionCount > 0 || archivedSessions.length > 0);
  if (!shouldRenderSection) return;

  const ARCHIVED_FOLDER_KEY = "folder:archived";
  const isCollapsed = collapsedFolders[ARCHIVED_FOLDER_KEY] === true;
  const count = isLongTermTab
    ? archivedSessions.length
    : (archivedSessionsLoaded ? archivedSessions.length : Math.max(archivedSessionCount, archivedSessions.length));

  const section = document.createElement("div");
  section.id = "archivedSection";
  section.className = "archived-section";

  const header = document.createElement("div");
  header.className = "archived-section-header" + (isCollapsed ? " collapsed" : "");
  header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
    <span class="archived-label">${esc(t("sidebar.archive"))}</span>
    <span class="folder-count">${count}</span>`;
  header.addEventListener("click", () => {
    const nextCollapsed = !header.classList.contains("collapsed");
    header.classList.toggle("collapsed", nextCollapsed);
    persistCollapsedGroupState(ARCHIVED_FOLDER_KEY, nextCollapsed);
    items.hidden = nextCollapsed;
    if (!isLongTermTab && !nextCollapsed && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
      void fetchArchivedSessions().catch((error) => {
        console.warn("[sessions] Failed to load archived tasks:", error?.message || error);
      });
    }
  });
  section.appendChild(header);

  const items = document.createElement("div");
  items.className = "archived-items";
  items.hidden = isCollapsed;
  section.appendChild(items);

  if (!isLongTermTab && !isCollapsed && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
    void fetchArchivedSessions().catch((error) => {
      console.warn("[sessions] Failed to load archived tasks:", error?.message || error);
    });
  }

  if (archivedSessionsLoading && archivedSessions.length === 0) {
    const loading = document.createElement("div");
    loading.className = "archived-empty";
    loading.textContent = t("sidebar.loadingArchived");
    items.appendChild(loading);
  } else if (archivedSessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "archived-empty";
    empty.textContent = getFilteredSessionEmptyText({ archived: true });
    items.appendChild(empty);
  } else {
    appendSessionItems(items, archivedSessions, { archived: true });
  }

  sessionList.appendChild(section);
}

function startRename(itemEl, session) {
  const nameEl = itemEl.querySelector(".session-item-name");
  const current = session.name || session.tool || "";
  const input = document.createElement("input");
  input.className = "session-rename-input";
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName && newName !== current) {
      dispatchAction({ action: "rename", sessionId: session.id, name: newName });
    } else {
      renderSessionList(); // revert
    }
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      renderSessionList();
    }
  });
}

function resolveAttachedSessionRecord(id, session) {
  const sessionId = typeof id === "string" ? id.trim() : "";
  if (!sessionId) return session || null;
  const existing = Array.isArray(sessions)
    ? sessions.find((entry) => entry?.id === sessionId)
    : null;
  return existing || session || null;
}

function attachSession(id, session) {
  const resolvedSession = resolveAttachedSessionRecord(id, session);
  if (typeof window !== "undefined" && typeof window.MelodySyncWorkbench?.setFocusedSessionId === "function") {
    window.MelodySyncWorkbench.setFocusedSessionId(id, { render: false });
  }
  const shouldReattach = !hasAttachedSession || currentSessionId !== id;
  if (shouldReattach) {
    clearMessages();
    dispatchAction({ action: "attach", sessionId: id });
  }
  applyAttachedSessionState(id, resolvedSession);
  if (typeof markSessionReviewed === "function") {
    Promise.resolve(markSessionReviewed(resolvedSession, { sync: shouldReattach, render: true })).catch(() => {});
  }
  if (typeof focusComposer === "function") {
    focusComposer({ preventScroll: true });
  } else {
    msgInput.focus();
  }
}
