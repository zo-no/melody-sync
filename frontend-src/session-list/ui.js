// ---- Session list ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

// Whether to show long-term project member sessions in the tasks tab
// Default: hidden (false). User can toggle via the eye icon.
let showLongTermSessionsInTasksTab = false;

function getShowLongTermSessionsInTasksTab() {
  return showLongTermSessionsInTasksTab === true;
}

function setShowLongTermSessionsInTasksTab(value) {
  showLongTermSessionsInTasksTab = value === true;
}

globalThis.getShowLongTermSessionsInTasksTab = getShowLongTermSessionsInTasksTab;
globalThis.setShowLongTermSessionsInTasksTab = setShowLongTermSessionsInTasksTab;

const LONG_TERM_BUCKET_DEFS = [
  { key: "long_term", label: "长期任务", order: 0 },
  { key: "short_term", label: "短期任务", order: 1 },
  { key: "waiting", label: "等待任务", order: 2 },
  { key: "inbox", label: "收集箱", order: 3 },
  { key: "skill", label: "快捷按钮", order: 4 },
];

function inferLongTermSessionBucket(session) {
  const model = getSessionListModel();
  const membership = typeof model?.getLongTermTaskPoolMembership === "function"
    ? model.getLongTermTaskPoolMembership(session)
    : null;
  const bucketRaw = String(membership?.bucket || "").trim().toLowerCase();
  if (bucketRaw === "long_term") return "long_term";
  if (bucketRaw === "short_term") return "short_term";
  if (bucketRaw === "waiting") return "waiting";
  if (bucketRaw === "inbox") return "inbox";
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  if (kind === "recurring_task") return "long_term";
  if (kind === "scheduled_task") return "short_term";
  if (kind === "waiting_task") return "waiting";
  if (kind === "skill") return "skill";
  const workflowState = String(session?.workflowState || "").trim().toLowerCase();
  if (workflowState === "waiting_user") return "waiting";
  return "inbox";
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
  if (kind === "recurring_task") return "recurring_task";
  if (kind === "scheduled_task") return "scheduled_task";
  if (kind === "waiting_task") return "waiting_task";
  return kind === "skill" ? "skill" : "";
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
  // System sessions are read-only — no actions
  const model = getSessionListModel();
  const entry = model?.getSessionListEntry?.(session, { archived }) || null;
  if (entry?.isSystem === true) return [];
  const isArchivedSession = archived || session?.archived === true;
  const baseActions = typeof buildSessionActionConfigs === "function"
    ? buildSessionActionConfigs(session, { archived: isArchivedSession })
    : [];
  const visibleBaseActions = isArchivedSession
    ? baseActions
    : baseActions.filter((actionEntry) => actionEntry?.action !== "delete");
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
  const isSystem = entry?.isSystem === true;
  const extraClassNames = [];
  if (archived) extraClassNames.push("archived-item");
  if (isBranch) extraClassNames.push(archived ? "is-archived-branch" : "is-branch-session");
  if (isSystem) extraClassNames.push("is-system-item");
  if (persistentKind === "skill" || persistentKind === "recurring_task" || persistentKind === "scheduled_task" || persistentKind === "waiting_task") {
    extraClassNames.push("is-persistent-item");
  }
  if (persistentKind === "skill") extraClassNames.push("is-quick-action-item");
  if (persistentKind === "recurring_task") extraClassNames.push("is-persistent-recurring-item");
  if (persistentKind === "scheduled_task") extraClassNames.push("is-persistent-scheduled-item");
  if (persistentKind === "waiting_task") extraClassNames.push("is-persistent-waiting-item");
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

function isSkillSessionForList(session) {
  return getSidebarPersistentKind(session) === "skill";
}

function shouldIncludeSessionInSidebarTab(session, tab = getActiveSidebarTabForList()) {
  if (tab === "sessions") {
    // Tasks tab: aggregate view — show long_term + short_term members from all projects
    // (inbox, waiting, skill buckets are excluded — they need separate attention)
    if (isLongTermProjectSessionForList(session)) return false; // project roots not shown here
    const model = getSessionListModel();
    const membership = typeof model?.getLongTermTaskPoolMembership === "function"
      ? model.getLongTermTaskPoolMembership(session)
      : null;
    if (!membership?.projectSessionId) return false;
    const bucket = inferLongTermSessionBucket(session);
    // Show all active task buckets — long_term, short_term, and inbox (general tasks)
    // Exclude waiting (needs human action, shown separately) and skill (quick actions)
    return bucket === "long_term" || bucket === "short_term" || bucket === "inbox";
  }
  if (tab === "long-term") {
    return isLongTermProjectSessionForList(session) || isLongTermLineSessionForList(session);
  }
  return true;
}

function filterSessionsForSidebarTab(entries = [], tab = getActiveSidebarTabForList()) {
  return (Array.isArray(entries) ? entries : []).filter((session) => shouldIncludeSessionInSidebarTab(session, tab));
}

function renderSessionList() {
  const activeSidebarTab = getActiveSidebarTabForList();
  const isLongTermTab = activeSidebarTab === "long-term";
  const isSessionsTab = activeSidebarTab === "sessions";
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
  const groups = new Map();
  if (isSessionsTab) {
    // Tasks tab: flat per-project groups (no bucket sub-folders)
    // Shows long_term + short_term members from all projects
    const model = getSessionListModel();
    const allActive = typeof getVisibleActiveSessions === "function" ? getVisibleActiveSessions() : [];
    for (const session of visibleSessions) {
      if (!session?.id) continue;
      const membership = typeof model?.getLongTermTaskPoolMembership === "function"
        ? model.getLongTermTaskPoolMembership(session)
        : null;
      const projectId = membership?.projectSessionId || "";
      if (!projectId) continue;
      const groupKey = `group:tasks-project:${projectId}`;
      if (!groups.has(groupKey)) {
        const projectSession = allActive.find((s) => s?.id === projectId) || null;
        const projectTitle = String(projectSession?.name || "项目").trim() || "项目";
        const isSystemProject = String(projectSession?.taskListOrigin || "").trim().toLowerCase() === "system";
        groups.set(groupKey, {
          key: groupKey,
          label: projectTitle,
          title: projectTitle,
          order: isSystemProject ? -(groups.size + 1) : groups.size,
          type: "tasks-project",
          projectId,
          sessions: [],
        });
      }
      groups.get(groupKey).sessions.push(session);
    }
  } else if (isLongTermTab) {
    // Build per-project groups with bucket sub-folders
    const model = getSessionListModel();
    for (const session of visibleSessions) {
      if (!session?.id) continue;
      const isProject = isLongTermProjectSessionForList(session);
      const membership = typeof model?.getLongTermTaskPoolMembership === "function"
        ? model.getLongTermTaskPoolMembership(session)
        : null;
      const projectId = membership?.projectSessionId || (isProject ? session.id : "");
      if (!projectId) continue;
      const groupKey = `group:long-term-project:${projectId}`;
      if (!groups.has(groupKey)) {
        const projectSession = isProject
          ? session
          : (typeof getSessionCatalogRecordById === "function"
              ? getSessionCatalogRecordById(projectId)
              : getVisibleActiveSessions().find((s) => s?.id === projectId) || null);
        const projectTitle = String(projectSession?.name || projectSession?.description || "长期项目").trim() || "长期项目";
        const isSystemProject = String(projectSession?.taskListOrigin || "").trim().toLowerCase() === "system";
        groups.set(groupKey, {
          key: groupKey,
          label: projectTitle,
          title: projectTitle,
          // System projects sort before user projects (negative order)
          order: isSystemProject ? -(groups.size + 1) : groups.size,
          type: "long-term-project",
          projectId,
          isSystem: isSystemProject,
          projectSession: projectSession || null,
          sessions: [],
          buckets: Object.fromEntries(LONG_TERM_BUCKET_DEFS.map((b) => [b.key, { ...b, sessions: [] }])),
        });
      }
      const groupEntry = groups.get(groupKey);
      groupEntry.sessions.push(session);
      if (!isProject) {
        const bucket = inferLongTermSessionBucket(session);
        if (groupEntry.buckets[bucket]) {
          groupEntry.buckets[bucket].sessions.push(session);
        } else {
          // fallback: unknown bucket key → put in inbox
          groupEntry.buckets.inbox.sessions.push(session);
        }
      }
    }
  } else {
    for (const session of visibleSessions) {
      if (!session?.id) continue;
      const groupInfo = getSessionGroupInfoForList(session);
      if (!groups.has(groupInfo.key)) {
        groups.set(groupInfo.key, { ...groupInfo, sessions: [], insertOrder: groups.size });
      }
      groups.get(groupInfo.key).sessions.push(session);
    }
  }

  const orderedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const leftOrder = Number.isInteger(left?.order) ? left.order : 100000;
    const rightOrder = Number.isInteger(right?.order) ? right.order : 100000;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });
  const visibleGroups = (isLongTermTab || isSessionsTab)
    ? orderedGroups
    : orderedGroups.filter(([groupKey]) => isUserTemplateFolderGroup(groupKey));
  const showGroupHeaders = visibleGroups.length > 0;

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
  const shouldRenderArchivedSection = (isLongTermTab || isSessionsTab)
    ? archivedSessions.length > 0
    : (isArchivedSessionsLoading || archivedSessionTotal > 0 || archivedSessions.length > 0);
  const archivedCount = (isLongTermTab || isSessionsTab)
    ? archivedSessions.length
    : (hasArchivedSessionsLoaded
      ? archivedSessions.length
      : Math.max(archivedSessionTotal, archivedSessions.length));
  const sessionsLoaded = typeof hasLoadedSessions !== "undefined" && hasLoadedSessions === true;
  const shouldShowSessionListEmptyState =
    pinnedSessions.length === 0
    && visibleGroups.length === 0
    && !shouldRenderArchivedSection;
  const sessionListEmptyLabel = shouldShowSessionListEmptyState
    ? payloadSafeTranslate(
      sessionsLoaded
        ? (isLongTermTab ? "sidebar.longTerm.empty" : (isSessionsTab ? "sidebar.tasks.empty" : "sidebar.noSessions"))
        : "sidebar.loadingSessions",
      sessionsLoaded
        ? (isLongTermTab ? "还没有长期项目" : (isSessionsTab ? "还没有任务" : "还没有任务"))
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
      groups: visibleGroups.map(([groupKey, groupEntry]) => ({
        key: groupKey,
        label: groupEntry.label,
        title: groupEntry.title,
        sessions: groupEntry.sessions,
        collapsed: collapsedFolders[groupKey] === true,
        canDelete: showGroupingFolderControls && isUserTemplateFolderGroup(groupKey),
        ...(groupEntry.type === "long-term-project" ? {
          type: "long-term-project",
          projectId: groupEntry.projectId,
          isSystem: groupEntry.isSystem === true,
          projectSession: groupEntry.projectSession || null,
          buckets: Object.values(groupEntry.buckets).map((b) => ({
            key: b.key,
            label: b.label,
            order: b.order,
            sessions: b.sessions,
            collapsed: collapsedFolders[`${groupKey}:${b.key}`] === true,
          })),
        } : {}),
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
          // Only react to top-level project group keys — bucket sub-keys look like
          // "group:long-term-project:xxx:long_term" and must NOT trigger the panel
          const projectGroupMatch = /^group:long-term-project:([^:]+)$/.exec(groupKey);
          if (projectGroupMatch) {
            const projectId = projectGroupMatch[1];
            if (!collapsed) {
              if (typeof window.showLongTermProjectPanel === "function") {
                window.showLongTermProjectPanel(projectId);
              }
            } else {
              if (typeof window.hideLongTermProjectPanel === "function") {
                window.hideLongTermProjectPanel();
              }
            }
          }
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

  for (const [groupKey, groupEntry] of visibleGroups) {
    const groupSessions = groupEntry.sessions;
    const group = document.createElement("div");
    const isLongTermProject = groupEntry.type === "long-term-project";
    group.className = "folder-group" + (showGroupHeaders ? "" : " is-ungrouped") + (isLongTermProject ? " is-long-term-project-group" : "");

    if (showGroupHeaders) {
      const header = document.createElement("div");
      header.className =
        "folder-group-header" +
        (collapsedFolders[groupKey] ? " collapsed" : "") +
        (isLongTermProject ? " is-long-term-project-header" : "");
      const memberCount = isLongTermProject
        ? Object.values(groupEntry.buckets || {}).reduce((sum, b) => sum + b.sessions.length, 0)
        : groupSessions.length;
      header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
        <span class="folder-name" title="${esc(groupEntry.title)}">${esc(groupEntry.label)}</span>
        <span class="folder-count">${memberCount}</span>`;
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

    if (isLongTermProject) {
      // Render project root session first (the recurring_task itself)
      const projectRootSessions = groupSessions.filter((s) => isLongTermProjectSessionForList(s));
      appendSessionItems(items, projectRootSessions);
      // Then render bucket sub-folders
      for (const bucketDef of LONG_TERM_BUCKET_DEFS) {
        const bucketEntry = groupEntry.buckets[bucketDef.key];
        if (!bucketEntry || bucketEntry.sessions.length === 0) continue;
        const bucketKey = `${groupKey}:${bucketDef.key}`;
        const bucketGroup = document.createElement("div");
        bucketGroup.className = "folder-group folder-group-bucket";
        const bucketHeader = document.createElement("div");
        const isBucketCollapsed = collapsedFolders[bucketKey] === true;
        bucketHeader.className = "folder-group-header folder-group-bucket-header" + (isBucketCollapsed ? " collapsed" : "");
        bucketHeader.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
          <span class="folder-name">${esc(bucketDef.label)}</span>
          <span class="folder-count">${bucketEntry.sessions.length}</span>`;
        const bucketItems = document.createElement("div");
        bucketItems.className = "folder-group-items folder-group-bucket-items";
        bucketItems.hidden = isBucketCollapsed;
        bucketHeader.addEventListener("click", () => {
          bucketHeader.classList.toggle("collapsed");
          persistCollapsedGroupState(bucketKey, bucketHeader.classList.contains("collapsed"));
          bucketItems.hidden = collapsedFolders[bucketKey] === true;
        });
        appendSessionItems(bucketItems, bucketEntry.sessions);
        bucketGroup.appendChild(bucketHeader);
        bucketGroup.appendChild(bucketItems);
        items.appendChild(bucketGroup);
      }
    } else {
      appendSessionItems(items, groupSessions);
    }

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
  const isSessionsTab = activeSidebarTab === "sessions";
  const archivedSessions = filterSessionsForSidebarTab(
    getVisibleArchivedSessions().filter((session) => shouldShowSessionInSidebarForList(session, { archived: true })),
    activeSidebarTab,
  );
  const shouldRenderSection = (isLongTermTab || isSessionsTab)
    ? archivedSessions.length > 0
    : (archivedSessionsLoading || archivedSessionCount > 0 || archivedSessions.length > 0);
  if (!shouldRenderSection) return;

  const ARCHIVED_FOLDER_KEY = "folder:archived";
  const isCollapsed = collapsedFolders[ARCHIVED_FOLDER_KEY] === true;
  const count = (isLongTermTab || isSessionsTab)
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

function isLongTermProjectRootForPanel(session) {
  // Returns true only for the project root session (recurring_task with role=project)
  // — not for member sessions that belong to a project
  const kind = getSidebarPersistentKind(session);
  if (kind !== "recurring_task") return false;
  const model = getSessionListModel();
  if (typeof model?.getLongTermTaskPoolMembership === "function") {
    const membership = model.getLongTermTaskPoolMembership(session);
    if (membership) {
      // Must be explicitly role=project to show the panel
      return membership.role === "project";
    }
    // model exists but no membership found → not a project root
    return false;
  }
  // model unavailable → conservative fallback: don't show panel
  return false;
}

function attachSession(id, session) {
  const resolvedSession = resolveAttachedSessionRecord(id, session);

  // If this is a long-term project root, show the control panel instead of the chat UI
  if (isLongTermProjectRootForPanel(resolvedSession)) {
    if (typeof window.setSelectedLongTermProjectId === "function") {
      window.setSelectedLongTermProjectId(id);
    }
    if (typeof window.showLongTermProjectPanel === "function") {
      window.showLongTermProjectPanel(id);
    }
    return;
  }

  // Normal session: hide the project panel and show chat UI
  if (typeof window.hideLongTermProjectPanel === "function") {
    window.hideLongTermProjectPanel();
  }

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
