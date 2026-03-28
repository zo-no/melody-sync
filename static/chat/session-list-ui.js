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
      items.appendChild(createTaskClusterItem(cluster.root, cluster.branches, {
        currentBranchSessionId: cluster.currentBranchSessionId,
      }));
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

  const showGroupHeaders = groups.size > 1 || pinnedClusters.length > 0;
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
      items.appendChild(createTaskClusterItem(cluster.root, cluster.branches, {
        currentBranchSessionId: cluster.currentBranchSessionId,
      }));
    }

    group.appendChild(items);
    sessionList.appendChild(group);
  }

}

function renderArchivedSection() {
  const existing = document.getElementById("archivedSection");
  if (existing) existing.remove();
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
