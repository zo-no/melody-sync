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
  const baseActions = typeof buildSessionActionConfigs === "function"
    ? buildSessionActionConfigs(session, { archived: isArchivedSession })
    : [];
  const visibleBaseActions = isArchivedSession
    ? baseActions
    : baseActions.filter((entry) => entry?.action !== "delete");
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
    ...(titlePrefixHtml ? { titlePrefixHtml } : {}),
    ...(metaOverrideHtml ? { metaOverrideHtml } : {}),
  });
  return item;
}

function getPersistentDockStorageState() {
  const defaults = {
    "group:long-term": true,
    "group:quick-actions": true,
  };
  try {
    const raw = localStorage.getItem("collapsedSessionPersistentDock");
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    return {
      ...defaults,
      ...(parsed || {}),
    };
  } catch {
    return defaults;
  }
}

function setPersistentDockStorageState(nextState) {
  try {
    localStorage.setItem(
      "collapsedSessionPersistentDock",
      JSON.stringify(nextState || {}),
    );
  } catch {}
}

function isPersistentDockSectionCollapsed(groupKey) {
  const state = getPersistentDockStorageState();
  return state[groupKey] !== false;
}

function setPersistentDockSectionCollapsed(groupKey, collapsed) {
  const state = getPersistentDockStorageState();
  state[groupKey] = collapsed === true;
  setPersistentDockStorageState(state);
}

function getDefaultPersistentDockCollapsed() {
  return typeof window?.matchMedia === "function"
    ? window.matchMedia("(max-width: 767px)").matches
    : false;
}

function isPersistentDockCollapsed() {
  try {
    const raw = localStorage.getItem("collapsedSessionPersistentDockRoot");
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return getDefaultPersistentDockCollapsed();
}

function setPersistentDockCollapsed(collapsed) {
  try {
    localStorage.setItem("collapsedSessionPersistentDockRoot", collapsed === true ? "true" : "false");
  } catch {}
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

function renderPersistentDockSection(groupKey, sessions = []) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const section = document.createElement("div");
  const isCollapsed = isPersistentDockSectionCollapsed(groupKey);
  section.className = "persistent-dock-section" + (isCollapsed ? " is-collapsed" : "");

  const header = document.createElement("button");
  header.className = "persistent-dock-header";
  header.type = "button";
  header.setAttribute("aria-label", `${getPersistentDockGroupLabel(groupKey)} ${safeSessions.length} 项`);
  header.innerHTML = `<span class="persistent-dock-title">${esc(getPersistentDockGroupLabel(groupKey))}</span>
    <span class="persistent-dock-count">${safeSessions.length}</span>
    <span class="persistent-dock-chevron">${renderUiIcon("chevron-down")}</span>`;
  header.addEventListener("click", () => {
    const nextCollapsed = !section.classList.contains("is-collapsed");
    setPersistentDockSectionCollapsed(groupKey, nextCollapsed);
    section.classList.toggle("is-collapsed", nextCollapsed);
    body.hidden = nextCollapsed;
  });

  const body = document.createElement("div");
  body.className = "persistent-dock-body";
  body.hidden = isCollapsed;
  appendSessionItems(body, safeSessions);

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function renderPersistentSessionDock(persistentSessionsByGroup) {
  if (!sessionListFooter) return;
  const container = sessionListFooter;
  const hasLongTerm = Array.isArray(persistentSessionsByGroup["group:long-term"]) && persistentSessionsByGroup["group:long-term"].length > 0;
  const hasQuickActions = Array.isArray(persistentSessionsByGroup["group:quick-actions"]) && persistentSessionsByGroup["group:quick-actions"].length > 0;

  if (!hasLongTerm && !hasQuickActions) {
    container.innerHTML = "";
    container.className = "session-list-footer";
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = "";
  container.className = "session-list-footer has-persistent-dock";

  const dock = document.createElement("div");
  const totalCount = (hasLongTerm ? persistentSessionsByGroup["group:long-term"].length : 0)
    + (hasQuickActions ? persistentSessionsByGroup["group:quick-actions"].length : 0);
  const isCollapsed = isPersistentDockCollapsed();
  dock.className = "session-list-persistent-dock" + (isCollapsed ? " is-collapsed" : "");

  const overview = document.createElement("button");
  overview.className = "persistent-dock-overview";
  overview.type = "button";
  overview.setAttribute("aria-label", `${t("persistent.sectionTitle")} ${totalCount} 项`);
  overview.innerHTML = `<span class="persistent-dock-overview-title">${esc(t("persistent.sectionTitle"))}</span>
    <span class="persistent-dock-overview-count">${totalCount}</span>
    <span class="persistent-dock-overview-chevron">${renderUiIcon("chevron-down")}</span>`;
  overview.addEventListener("click", () => {
    const nextCollapsed = !dock.classList.contains("is-collapsed");
    dock.classList.toggle("is-collapsed", nextCollapsed);
    body.hidden = nextCollapsed;
    setPersistentDockCollapsed(nextCollapsed);
  });
  dock.appendChild(overview);

  const body = document.createElement("div");
  body.className = "session-list-persistent-dock-body";
  body.hidden = isCollapsed;
  if (hasLongTerm) {
    body.appendChild(renderPersistentDockSection("group:long-term", persistentSessionsByGroup["group:long-term"]));
  }
  if (hasQuickActions) {
    body.appendChild(renderPersistentDockSection("group:quick-actions", persistentSessionsByGroup["group:quick-actions"]));
  }
  dock.appendChild(body);

  container.appendChild(dock);
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

function renderSessionList() {
  const groupingMode = getSessionGroupingModeForList();
  const showGroupingFolderControls = groupingMode === "user";
  const pinnedSessions = getVisiblePinnedSessions().filter((session) => shouldShowSessionInSidebarForList(session));
  const visibleSessions = getVisibleActiveSessions().filter((session) => shouldShowSessionInSidebarForList(session));

  const groups = new Map();
  for (const session of visibleSessions) {
    if (!session?.id) continue;
    const persistentDockGroupKey = getPersistentDockGroupKey(session);
    const groupInfo = persistentDockGroupKey
      ? getPersistentSidebarGroupInfo(persistentDockGroupKey)
      : getSessionGroupInfoForList(session);
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
    if (groupingMode === "ai") {
      const leftInsertOrder = Number.isInteger(left?.insertOrder) ? left.insertOrder : 0;
      const rightInsertOrder = Number.isInteger(right?.insertOrder) ? right.insertOrder : 0;
      if (leftInsertOrder !== rightInsertOrder) return leftInsertOrder - rightInsertOrder;
    }
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

  const archivedSessions = (typeof getVisibleArchivedSessions === "function" ? getVisibleArchivedSessions() : [])
    .filter((session) => shouldShowSessionInSidebarForList(session, { archived: true }));
  const isArchivedSessionsLoading = typeof archivedSessionsLoading !== "undefined" && archivedSessionsLoading === true;
  const hasArchivedSessionsLoaded = typeof archivedSessionsLoaded !== "undefined" && archivedSessionsLoaded === true;
  const archivedSessionTotal = Number(typeof archivedSessionCount === "undefined" ? 0 : archivedSessionCount) || 0;
  const ARCHIVED_FOLDER_KEY = "folder:archived";
  const archivedCollapsed = collapsedFolders[ARCHIVED_FOLDER_KEY] === true;
  const shouldRenderArchivedSection = isArchivedSessionsLoading || archivedSessionTotal > 0 || archivedSessions.length > 0;
  const archivedCount = hasArchivedSessionsLoaded
    ? archivedSessions.length
    : Math.max(archivedSessionTotal, archivedSessions.length);
  const isGroupingCreateOpen = typeof window.isSessionGroupingTemplateCreateOpen === "function"
    ? window.isSessionGroupingTemplateCreateOpen()
    : false;

  const externalRenderer = window.MelodySyncSessionListReactUi;
  if (typeof externalRenderer?.renderSessionList === "function") {
    const rendered = externalRenderer.renderSessionList({
      sessionListEl: sessionList,
      sessionListFooterEl: sessionListFooter,
      pinnedSessions,
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
      helpers: {
        t,
        esc,
        renderUiIcon,
        appendSessionItems,
        createSessionItem: createSidebarSessionItem,
      },
      actions: {
        setGroupCollapsed(groupKey, collapsed) {
          persistCollapsedGroupState(groupKey, collapsed);
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
      renderPersistentSessionDock(Object.create(null));
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

  renderPersistentSessionDock(Object.create(null));
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
  const archivedSessions = getVisibleArchivedSessions().filter((session) => shouldShowSessionInSidebarForList(session, { archived: true }));
  const shouldRenderSection = archivedSessionsLoading || archivedSessionCount > 0 || archivedSessions.length > 0;
  if (!shouldRenderSection) return;

  const ARCHIVED_FOLDER_KEY = "folder:archived";
  const isCollapsed = collapsedFolders[ARCHIVED_FOLDER_KEY] === true;
  const count = archivedSessionsLoaded ? archivedSessions.length : Math.max(archivedSessionCount, archivedSessions.length);

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
    if (!nextCollapsed && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
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

  if (!isCollapsed && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
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
