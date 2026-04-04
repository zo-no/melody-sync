// ---- Session list ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

function getSessionListModel() {
  return window.MelodySyncSessionListModel || null;
}

function getSessionGroupInfoForList(session) {
  return getSessionListModel()?.getSessionGroupInfo?.(session) || {
    key: "group:inbox",
    label: t("sidebar.group.inbox"),
    title: t("sidebar.group.inbox"),
    order: 0,
  };
}

function isBranchTaskSessionForList(session) {
  return getSessionListModel()?.isBranchTaskSession?.(session) === true;
}

function buildSessionListMetaHtml(session) {
  const model = getSessionListModel();
  const metaParts = typeof buildSessionMetaParts === "function"
    ? buildSessionMetaParts(session)
    : [];
  const badgeHtml = Array.isArray(model?.getSessionListBadges?.(session))
    ? model.getSessionListBadges(session)
        .filter((badge) => badge?.label)
        .map((badge) => `<span class="${esc(badge.className || "session-list-badge")}" title="${esc(badge.label)}">${esc(badge.label)}</span>`)
    : [];
  return [...badgeHtml, ...metaParts].join(" · ");
}

function getSidebarPersistentKind(session) {
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  return kind === "recurring_task" ? "recurring_task" : (kind === "skill" ? "skill" : "");
}

function getPersistentDockGroupKey(session) {
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
  const baseActions = typeof buildSessionActionConfigs === "function"
    ? buildSessionActionConfigs(session, { archived })
    : [];
  if (!canRunSidebarQuickAction(session, { archived })) {
    return baseActions;
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
    ...baseActions,
  ];
}

function createSidebarSessionItem(session, { archived = false } = {}) {
  const isBranch = isBranchTaskSessionForList(session);
  const persistentKind = getSidebarPersistentKind(session);
  const extraClassNames = [];
  if (archived) extraClassNames.push("archived-item");
  if (isBranch) extraClassNames.push(archived ? "is-archived-branch" : "is-branch-session");
  if (persistentKind === "skill" || persistentKind === "recurring_task") {
    extraClassNames.push("is-persistent-item");
  }
  if (persistentKind === "skill") extraClassNames.push("is-quick-action-item");
  if (persistentKind === "recurring_task") extraClassNames.push("is-persistent-recurring-item");
  const metaOverrideHtml = buildSessionListMetaHtml(session);
  return createActiveSessionItem(session, {
    extraClassName: extraClassNames.join(" "),
    actions: buildSidebarSessionActions(session, { archived }),
    ...(metaOverrideHtml ? { metaOverrideHtml } : {}),
  });
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

function getPersistentDockGroupLabel(groupKey) {
  if (groupKey === "group:quick-actions") return t("sidebar.group.quickActions");
  if (groupKey === "group:long-term") return t("sidebar.group.longTerm");
  return t(groupKey);
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
    setPersistentDockSectionCollapsed(groupKey, !isCollapsed);
    section.classList.toggle("is-collapsed");
  });

  const body = document.createElement("div");
  body.className = "persistent-dock-body";
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
  dock.className = "session-list-persistent-dock";

  const overview = document.createElement("div");
  overview.className = "persistent-dock-overview";
  overview.innerHTML = `<span class="persistent-dock-overview-title">${esc(t("persistent.sectionTitle"))}</span>
    <span class="persistent-dock-overview-count">${(hasLongTerm ? persistentSessionsByGroup["group:long-term"].length : 0) + (hasQuickActions ? persistentSessionsByGroup["group:quick-actions"].length : 0)}</span>`;
  dock.appendChild(overview);

  if (hasLongTerm) {
    dock.appendChild(renderPersistentDockSection("group:long-term", persistentSessionsByGroup["group:long-term"]));
  }
  if (hasQuickActions) {
    dock.appendChild(renderPersistentDockSection("group:quick-actions", persistentSessionsByGroup["group:quick-actions"]));
  }

  container.appendChild(dock);
}

function appendSessionItems(host, entries = [], options = {}) {
  for (const session of Array.isArray(entries) ? entries : []) {
    if (!session?.id) continue;
    host.appendChild(createSidebarSessionItem(session, options));
  }
}

function renderSessionList() {
  sessionList.innerHTML = "";
  const pinnedSessions = getVisiblePinnedSessions();
  const visibleSessions = getVisibleActiveSessions();
  const persistentSessionsByGroup = Object.create(null);

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

  const groups = new Map();
  for (const session of visibleSessions) {
    if (!session?.id) continue;
    const persistentDockGroupKey = getPersistentDockGroupKey(session);
    if (persistentDockGroupKey) {
      if (!Array.isArray(persistentSessionsByGroup[persistentDockGroupKey])) {
        persistentSessionsByGroup[persistentDockGroupKey] = [];
      }
      persistentSessionsByGroup[persistentDockGroupKey].push(session);
      continue;
    }
    const groupInfo = getSessionGroupInfoForList(session);
    if (!groups.has(groupInfo.key)) {
      groups.set(groupInfo.key, { ...groupInfo, sessions: [] });
    }
    groups.get(groupInfo.key).sessions.push(session);
  }

  const showGroupHeaders = groups.size > 0;
  const orderedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const leftOrder = Number.isInteger(left?.order) ? left.order : 100000;
    const rightOrder = Number.isInteger(right?.order) ? right.order : 100000;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

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
      header.addEventListener("click", () => {
        header.classList.toggle("collapsed");
        collapsedFolders[groupKey] = header.classList.contains("collapsed");
        localStorage.setItem(
          COLLAPSED_GROUPS_STORAGE_KEY,
          JSON.stringify(collapsedFolders),
        );
      });
      group.appendChild(header);
    }

    const items = document.createElement("div");
    items.className = "folder-group-items";
    appendSessionItems(items, groupSessions);

    group.appendChild(items);
    sessionList.appendChild(group);
  }

  renderPersistentSessionDock(persistentSessionsByGroup);
  renderArchivedSection();
}

function renderArchivedSection() {
  const existing = document.getElementById("archivedSection");
  if (existing) existing.remove();
  const archivedSessions = getVisibleArchivedSessions();
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
    collapsedFolders[ARCHIVED_FOLDER_KEY] = nextCollapsed;
    localStorage.setItem(
      COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify(collapsedFolders),
    );
    if (!nextCollapsed && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
      void fetchArchivedSessions().catch((error) => {
        console.warn("[sessions] Failed to load archived tasks:", error?.message || error);
      });
    }
  });
  section.appendChild(header);

  const items = document.createElement("div");
  items.className = "archived-items";
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

function attachSession(id, session) {
  if (typeof window !== "undefined" && typeof window.MelodySyncWorkbench?.setFocusedSessionId === "function") {
    window.MelodySyncWorkbench.setFocusedSessionId(id, { render: false });
  }
  const shouldReattach = !hasAttachedSession || currentSessionId !== id;
  if (shouldReattach) {
    clearMessages();
    dispatchAction({ action: "attach", sessionId: id });
  }
  applyAttachedSessionState(id, session);
  if (typeof markSessionReviewed === "function") {
    Promise.resolve(markSessionReviewed(session, { sync: shouldReattach, render: true })).catch(() => {});
  }
  if (typeof focusComposer === "function") {
    focusComposer({ preventScroll: true });
  } else {
    msgInput.focus();
  }
}
