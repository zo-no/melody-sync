// ---- Session list ----
function t(key, vars) {
  return window.remotelabT ? window.remotelabT(key, vars) : key;
}

function renderSessionList() {
  sessionList.innerHTML = "";
  const pinnedSessions = getVisiblePinnedSessions();
  const visibleSessions = getVisibleActiveSessions();
  const allVisibleSessions = [...pinnedSessions, ...visibleSessions];
  const allTaskClusters = typeof getSidebarTaskClusters === "function"
    ? getSidebarTaskClusters(allVisibleSessions)
    : allVisibleSessions.map((session) => ({ root: session, branches: [] }));
  const pinnedClusters = allTaskClusters.filter((cluster) => cluster?.root?.pinned === true);
  const unpinnedClusters = allTaskClusters.filter((cluster) => cluster?.root?.pinned !== true);

  if (pinnedSessions.length > 0) {
    const section = document.createElement("div");
    section.className = "pinned-section";

    const header = document.createElement("div");
    header.className = "pinned-section-header";
    header.innerHTML = `<span class="pinned-label">${esc(t("sidebar.pinned"))}</span><span class="folder-count">${pinnedClusters.length}</span>`;

    const items = document.createElement("div");
    items.className = "pinned-items";
    for (const cluster of pinnedClusters) {
      const nodes = typeof createTaskClusterNodes === "function"
        ? createTaskClusterNodes(cluster.root, cluster.branches, {
            currentBranchSessionId: cluster.currentBranchSessionId,
          })
        : [createTaskClusterItem(cluster.root, cluster.branches, {
            currentBranchSessionId: cluster.currentBranchSessionId,
          })];
      nodes.forEach((node) => items.appendChild(node));
    }

    section.appendChild(header);
    section.appendChild(items);
    sessionList.appendChild(section);
  }

  const groups = new Map();
  for (const cluster of unpinnedClusters) {
    const rootSession = cluster?.root;
    if (!rootSession) continue;
    const groupInfo = getSessionGroupInfo(rootSession);
    if (!groups.has(groupInfo.key)) {
      groups.set(groupInfo.key, { ...groupInfo, clusters: [] });
    }
    groups.get(groupInfo.key).clusters.push(cluster);
  }

  const showGroupHeaders = groups.size > 0;
  const orderedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const leftOrder = Number.isInteger(left?.order) ? left.order : 999;
    const rightOrder = Number.isInteger(right?.order) ? right.order : 999;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  });

  for (const [groupKey, groupEntry] of orderedGroups) {
    const taskClusters = groupEntry.clusters;
    const group = document.createElement("div");
    group.className = "folder-group" + (showGroupHeaders ? "" : " is-ungrouped");

    if (showGroupHeaders) {
      const header = document.createElement("div");
      header.className =
        "folder-group-header" +
        (collapsedFolders[groupKey] ? " collapsed" : "");
      header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
        <span class="folder-name" title="${esc(groupEntry.title)}">${esc(groupEntry.label)}</span>
        <span class="folder-count">${taskClusters.length}</span>`;
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

    for (const cluster of taskClusters) {
      const nodes = typeof createTaskClusterNodes === "function"
        ? createTaskClusterNodes(cluster.root, cluster.branches, {
            currentBranchSessionId: cluster.currentBranchSessionId,
          })
        : [createTaskClusterItem(cluster.root, cluster.branches, {
            currentBranchSessionId: cluster.currentBranchSessionId,
          })];
      nodes.forEach((node) => items.appendChild(node));
    }

    group.appendChild(items);
    sessionList.appendChild(group);
  }

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
    for (const session of archivedSessions) {
      const row = createActiveSessionItem(session, {
        extraClassName: `archived-item${typeof isBranchTaskSession === "function" && isBranchTaskSession(session) ? " is-archived-branch" : ""}`,
      });
      items.appendChild(row);
    }
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
