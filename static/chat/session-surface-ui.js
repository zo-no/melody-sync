function t(key, vars) {
  return window.remotelabT ? window.remotelabT(key, vars) : key;
}

function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

function getShortFolder(folder) {
  return (folder || "").replace(/^\/Users\/[^/]+/, "~");
}

function getFolderLabel(folder) {
  const shortFolder = getShortFolder(folder);
  return shortFolder.split("/").pop() || shortFolder || t("session.defaultName");
}

function getSessionDisplayName(session) {
  const name = typeof session?.name === "string" ? session.name.trim() : "";
  const taskGoal = typeof session?.taskCard?.goal === "string" ? session.taskCard.goal.trim() : "";
  const mainGoal = typeof session?.taskCard?.mainGoal === "string" ? session.taskCard.mainGoal.trim() : "";
  const fallbackGoal = taskGoal || mainGoal;
  if (fallbackGoal && (session?.autoRenamePending === true || !name || name === t("session.defaultName"))) {
    return fallbackGoal;
  }
  return name || fallbackGoal || getFolderLabel(session?.folder) || t("session.defaultName");
}

function getTaskBranchDisplayName(session) {
  const raw = getSessionDisplayName(session);
  return raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, "").trim() || raw;
}

function getBranchStatusLabel(session) {
  const status = String(session?._branchStatus || "").toLowerCase();
  const name = getTaskBranchDisplayName(session);
  if (status === "resolved") return `已完成：${name}`;
  if (status === "merged") return `已带回主线：${name}`;
  if (status === "parked") return `已暂停：${name}`;
  return t("sidebar.currentBranch", { name });
}

const TASK_CLUSTER_EXPANDED_STORAGE_KEY = "melodysyncTaskClusterExpanded";
let expandedTaskClusters = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TASK_CLUSTER_EXPANDED_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
})();

function persistExpandedTaskClusters() {
  try {
    localStorage.setItem(TASK_CLUSTER_EXPANDED_STORAGE_KEY, JSON.stringify(expandedTaskClusters));
  } catch {}
}

function isBranchTaskSession(session) {
  const lineRole = String(session?.taskCard?.lineRole || "").trim().toLowerCase();
  return lineRole === "branch" || Boolean(session?.sourceContext?.parentSessionId);
}

function getBranchParentSessionId(session) {
  return typeof session?.sourceContext?.parentSessionId === "string"
    ? session.sourceContext.parentSessionId.trim()
    : "";
}

function getSessionActivityTimestamp(session) {
  const value = session?.updatedAt || session?.lastEventAt || session?.created || "";
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function getSessionMainGoal(session) {
  const mainGoal = typeof session?.taskCard?.mainGoal === "string" ? session.taskCard.mainGoal.trim() : "";
  const goal = typeof session?.taskCard?.goal === "string" ? session.taskCard.goal.trim() : "";
  return mainGoal || goal || getSessionDisplayName(session);
}

function normalizeTaskClusterKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sortBranchSessions(branches = []) {
  return [...branches].sort((a, b) => getSessionActivityTimestamp(b) - getSessionActivityTimestamp(a));
}

function dedupeBranchSessions(branches = []) {
  const next = [];
  const seen = new Set();
  for (const session of Array.isArray(branches) ? branches : []) {
    const key = String(session?.id || normalizeTaskClusterKey(getTaskBranchDisplayName(session)));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(session);
  }
  return next;
}

function buildTaskClusters(sessions = []) {
  const byId = new Map();
  const mainSessionsByGoal = new Map();
  for (const session of sessions) {
    if (session?.id) byId.set(session.id, session);
    if (!isBranchTaskSession(session)) {
      const goalKey = normalizeTaskClusterKey(getSessionMainGoal(session));
      if (goalKey && !mainSessionsByGoal.has(goalKey)) {
        mainSessionsByGoal.set(goalKey, session);
      }
    }
  }

  const branchChildren = new Map();
  const roots = [];
  for (const session of sessions) {
    const parentSessionId = getBranchParentSessionId(session);
    const branchParent = parentSessionId && byId.has(parentSessionId)
      ? byId.get(parentSessionId)
      : null;
    const goalParent = !branchParent && isBranchTaskSession(session)
      ? mainSessionsByGoal.get(normalizeTaskClusterKey(getSessionMainGoal(session))) || null
      : null;
    const resolvedParent = branchParent || goalParent;
    if (isBranchTaskSession(session) && resolvedParent?.id) {
      const key = resolvedParent.id;
      if (!branchChildren.has(key)) branchChildren.set(key, []);
      branchChildren.get(key).push(session);
      continue;
    }
    roots.push(session);
  }

  function collectBranchSessions(parentId, depth = 1, visited = new Set()) {
    const directChildren = sortBranchSessions(branchChildren.get(parentId) || []);
    const results = [];
    for (const session of directChildren) {
      if (!session?.id || visited.has(session.id)) continue;
      visited.add(session.id);
      results.push({
        ...session,
        _branchDepth: depth,
        _branchParentSessionId: parentId,
      });
      results.push(...collectBranchSessions(session.id, depth + 1, visited));
    }
    return results;
  }

  return roots.map((root) => ({
    root,
    branches: collectBranchSessions(root.id),
  }));
}

function getSidebarTaskClusters(sessions = []) {
  const sessionMap = new Map((Array.isArray(sessions) ? sessions : []).filter((session) => session?.id).map((session) => [session.id, session]));
  const snapshot = window.MelodySyncWorkbench && typeof window.MelodySyncWorkbench.getSnapshot === "function"
    ? window.MelodySyncWorkbench.getSnapshot()
    : null;
  const rawClusters = Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
  if (!rawClusters.length) {
    return buildTaskClusters(sessions);
  }

  const clusters = [];
  const consumedIds = new Set();
  for (const cluster of rawClusters) {
    const root = sessionMap.get(cluster?.mainSessionId) || cluster?.mainSession || null;
    if (!root) continue;
    const embeddedBranches = new Map(
      (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
        .filter((session) => session?.id)
        .map((session) => [session.id, session]),
    );
    const branchIds = Array.isArray(cluster?.branchSessionIds) ? cluster.branchSessionIds : [];
    const branches = branchIds.length > 0
      ? branchIds.map((id) => {
          const live = sessionMap.get(id);
          const embedded = embeddedBranches.get(id);
          if (live && embedded) {
            return {
              ...live,
              _branchDepth: embedded._branchDepth,
              _branchParentSessionId: embedded._branchParentSessionId,
              _branchStatus: embedded._branchStatus,
            };
          }
          return live || embedded || null;
        }).filter(Boolean)
      : Array.from(embeddedBranches.values());
    consumedIds.add(root.id);
    branches.forEach((branch) => consumedIds.add(branch.id));
    clusters.push({
      root,
      branches,
      currentBranchSessionId: typeof cluster?.currentBranchSessionId === "string" ? cluster.currentBranchSessionId : "",
    });
  }

  const unmatched = (Array.isArray(sessions) ? sessions : []).filter((session) => session?.id && !consumedIds.has(session.id));
  if (unmatched.length > 0) {
    clusters.push(...buildTaskClusters(unmatched));
  }
  return clusters;
}

function toggleTaskClusterExpanded(sessionId, expanded) {
  if (!sessionId) return;
  expandedTaskClusters[sessionId] = expanded === true;
  persistExpandedTaskClusters();
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
}

function formatQueuedMessageTimestamp(stamp) {
  if (!stamp) return t("queue.timestamp.default");
  const parsed = new Date(stamp).getTime();
  if (!Number.isFinite(parsed)) return t("queue.timestamp.default");
  return t("queue.timestamp.withTime", { time: messageTimeFormatter.format(parsed) });
}

function renderQueuedMessagePanel(session) {
  if (!queuedPanel) return;
  const items = Array.isArray(session?.queuedMessages) ? session.queuedMessages : [];
  if (!session?.id || session.id !== currentSessionId || items.length === 0) {
    queuedPanel.innerHTML = "";
    queuedPanel.classList.remove("visible");
    return;
  }

  queuedPanel.innerHTML = "";
  queuedPanel.classList.add("visible");

  const header = document.createElement("div");
  header.className = "queued-panel-header";

  const title = document.createElement("div");
  title.className = "queued-panel-title";
  title.textContent = items.length === 1
    ? t("queue.single")
    : t("queue.multiple", { count: items.length });

  const note = document.createElement("div");
  note.className = "queued-panel-note";
  const activity = getSessionActivity(session);
  note.textContent = activity.run.state === "running" || activity.compact.state === "pending"
    ? t("queue.note.afterRun")
    : t("queue.note.preparing");

  header.appendChild(title);
  header.appendChild(note);
  queuedPanel.appendChild(header);

  const list = document.createElement("div");
  list.className = "queued-list";
  const visibleItems = items.slice(-5);
  for (const item of visibleItems) {
    const row = document.createElement("div");
    row.className = "queued-item";

    const meta = document.createElement("div");
    meta.className = "queued-item-meta";
    meta.textContent = formatQueuedMessageTimestamp(item.queuedAt);

    const text = document.createElement("div");
    text.className = "queued-item-text";
    text.textContent = item.text || t("queue.attachmentOnly");

    row.appendChild(meta);
    row.appendChild(text);

    const imageNames = (item.images || []).map((image) => getAttachmentDisplayName(image)).filter(Boolean);
    if (imageNames.length > 0) {
      const imageLine = document.createElement("div");
      imageLine.className = "queued-item-images";
      imageLine.textContent = t("queue.attachments", { names: imageNames.join(", ") });
      row.appendChild(imageLine);
    }

    list.appendChild(row);
  }

  queuedPanel.appendChild(list);

  if (items.length > visibleItems.length) {
    const more = document.createElement("div");
    more.className = "queued-panel-more";
    more.textContent = items.length - visibleItems.length === 1
      ? t("queue.olderHidden.one")
      : t("queue.olderHidden.multiple", { count: items.length - visibleItems.length });
    queuedPanel.appendChild(more);
  }
}

function renderSessionMessageCount(session) {
  const count = Number.isInteger(session?.messageCount)
    ? session.messageCount
    : (Number.isInteger(session?.activeMessageCount) ? session.activeMessageCount : 0);
  if (count <= 0) return "";
  const label = t("session.messages", { count, suffix: count === 1 ? "" : "s" });
  return `<span class="session-item-count" title="${esc(t("session.messagesTitle"))}">${esc(label)}</span>`;
}

function getSessionMetaStatusInfo(session) {
  const liveStatus = getSessionStatusSummary(session).primary;
  if (liveStatus?.key && liveStatus.key !== "idle") {
    return liveStatus;
  }
  const workflowStatus = typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.getWorkflowStatusInfo === "function"
    ? window.RemoteLabSessionStateModel.getWorkflowStatusInfo(session?.workflowState)
    : null;
  return workflowStatus || liveStatus;
}

function getSessionReviewStatusInfo(session) {
  return typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.getSessionReviewStatusInfo === "function"
    ? window.RemoteLabSessionStateModel.getSessionReviewStatusInfo(session)
    : null;
}

function isSessionCompleteAndReviewed(session) {
  return typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.isSessionCompleteAndReviewed === "function"
    ? window.RemoteLabSessionStateModel.isSessionCompleteAndReviewed(session)
    : false;
}

function buildSessionMetaParts(session) {
  const parts = [];
  const reviewHtml = renderSessionStatusHtml(getSessionReviewStatusInfo(session));
  if (reviewHtml) parts.push(reviewHtml);
  const liveStatus = getSessionStatusSummary(session).primary;
  const statusHtml = liveStatus?.key && liveStatus.key !== "idle"
    ? renderSessionStatusHtml(liveStatus)
    : "";
  if (statusHtml) parts.push(statusHtml);
  const countHtml = renderSessionMessageCount(session);
  if (countHtml) parts.push(countHtml);
  return parts;
}

function renderSessionScopeContext(session) {
  const parts = [];
  const sourceName = typeof getEffectiveSessionSourceName === "function"
    ? getEffectiveSessionSourceName(session)
    : "";
  if (sourceName) {
    parts.push(`<span title="${esc(t("session.scope.source"))}">${esc(sourceName)}</span>`);
  }

  const templateAppId = typeof getEffectiveSessionTemplateAppId === "function"
    ? getEffectiveSessionTemplateAppId(session)
    : "";
  if (templateAppId) {
    const appEntry = typeof getSessionAppCatalogEntry === "function"
      ? getSessionAppCatalogEntry(templateAppId)
      : null;
    const appName = appEntry?.name || session?.appName || "App";
    parts.push(`<span title="${esc(t("session.scope.app"))}">${esc(t("session.scope.appLabel", { name: appName }))}</span>`);
  }

  if (session?.visitorId) {
    const visitorLabel = typeof session?.visitorName === "string" && session.visitorName.trim()
      ? t("session.scope.visitorNamed", { name: session.visitorName.trim() })
      : (session?.visitorId ? t("session.scope.visitor") : t("session.scope.owner"));
    parts.push(`<span title="${esc(t("session.scope.ownerTitle"))}">${esc(visitorLabel)}</span>`);
  }

  return parts;
}

function getFilteredSessionEmptyText({ archived = false } = {}) {
  if (archived) return t("sidebar.noArchived");
  if (
    activeSourceFilter !== FILTER_ALL_VALUE
    || activeSessionAppFilter !== FILTER_ALL_VALUE
    || activeUserFilter !== ADMIN_USER_FILTER_VALUE
  ) {
    return t("sidebar.noSessionsFiltered");
  }
  return t("sidebar.noSessions");
}

function getSessionGroupInfo(session) {
  const group = typeof session?.group === "string" ? session.group.trim() : "";
  if (group) {
    return {
      key: `group:${group}`,
      label: group,
      title: group,
    };
  }

  const folder = session?.folder || "?";
  const shortFolder = getShortFolder(folder);
  return {
    key: `folder:${folder}`,
    label: getFolderLabel(folder),
    title: shortFolder,
  };
}

function renderSessionStatusHtml(statusInfo) {
  if (!statusInfo?.label) return "";
  const title = statusInfo.title ? ` title="${esc(statusInfo.title)}"` : "";
  if (!statusInfo.className) {
    return `<span${title}>${esc(statusInfo.label)}</span>`;
  }
  return `<span class="${statusInfo.className}"${title}>● ${esc(statusInfo.label)}</span>`;
}

function createActiveSessionItem(session, options = {}) {
  const statusInfo = getSessionMetaStatusInfo(session);
  const completeRead = isSessionCompleteAndReviewed(session);
  const extraClassName = typeof options.extraClassName === "string" && options.extraClassName.trim()
    ? ` ${options.extraClassName.trim()}`
    : "";
  const div = document.createElement("div");
  div.className =
    "session-item"
    + (session.pinned ? " pinned" : "")
    + (session.id === currentSessionId ? " active" : "")
    + (completeRead ? " is-complete-read" : "")
    + (statusInfo.itemClass ? ` ${statusInfo.itemClass}` : "")
    + extraClassName;

  const displayName = getSessionDisplayName(session);
  const metaHtml = typeof options.metaOverrideHtml === "string"
    ? options.metaOverrideHtml
    : buildSessionMetaParts(session).join(" · ");
  const pinTitle = session.pinned ? t("action.unpin") : t("action.pin");
  const hideActions = options.hideActions === true;

  div.innerHTML = `
    <div class="session-item-info">
      <div class="session-item-name">${session.pinned ? `<span class="session-pin-badge" title="${esc(t("sidebar.pinned"))}">${renderUiIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
      ${metaHtml ? `<div class="session-item-meta">${metaHtml}</div>` : ""}
    </div>
    ${hideActions ? "" : `<div class="session-item-actions">
      <button class="session-action-btn pin${session.pinned ? " pinned" : ""}" type="button" title="${pinTitle}" aria-label="${pinTitle}" data-id="${session.id}">${renderUiIcon(session.pinned ? "pinned" : "pin")}</button>
      <button class="session-action-btn rename" type="button" title="${esc(t("action.rename"))}" aria-label="${esc(t("action.rename"))}" data-id="${session.id}">${renderUiIcon("edit")}</button>
      <button class="session-action-btn archive" type="button" title="${esc(t("action.archive"))}" aria-label="${esc(t("action.archive"))}" data-id="${session.id}">${renderUiIcon("archive")}</button>
    </div>`}`;

  div.addEventListener("click", (e) => {
    if (e.target.closest(".session-action-btn")) {
      return;
    }
    if (typeof options.onClick === "function") {
      options.onClick(e, div);
    } else {
      attachSession(session.id, session);
    }
    if (!isDesktop) closeSidebarFn();
  });

  const metaNode = div.querySelector(".session-item-meta");
  if (metaNode && typeof options.onMetaReady === "function") {
    options.onMetaReady(metaNode, div);
  }

  if (!hideActions) {
    div.querySelector(".pin").addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchAction({ action: session.pinned ? "unpin" : "pin", sessionId: session.id });
    });

    div.querySelector(".rename").addEventListener("click", (e) => {
      e.stopPropagation();
      startRename(div, session);
    });

    div.querySelector(".archive").addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchAction({ action: "archive", sessionId: session.id });
    });
  }

  return div;
}

function createTaskClusterItem(rootSession, branchSessions = [], options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-cluster";

  const normalizedBranches = dedupeBranchSessions(branchSessions);
  const currentBranch = normalizedBranches.find((session) => session.id === currentSessionId)
    || normalizedBranches.find((session) => session.id === options.currentBranchSessionId)
    || null;
  const summaryBranch = currentBranch || (normalizedBranches.length === 1 ? normalizedBranches[0] : null);
  const hasBranches = normalizedBranches.length > 0;
  const hasNestedBranches = normalizedBranches.some((session) => Number(session?._branchDepth) > 1);
  const shouldAutoExpand = Boolean(currentBranch) && (normalizedBranches.length > 1 || hasNestedBranches);
  const expanded = hasBranches && (expandedTaskClusters[rootSession.id] === true || shouldAutoExpand);
  if (expanded) wrapper.classList.add("is-expanded");

  let metaOverrideHtml = buildSessionMetaParts(rootSession).join(" · ");
  if (hasBranches) {
    const summaryParts = [];
    if (!expanded && summaryBranch) {
      summaryParts.push(
        `<button type="button" class="task-cluster-link task-cluster-current-branch" data-cluster-action="open-current-branch">${esc(getBranchStatusLabel(summaryBranch))}</button>`,
      );
    }
    const visibleBranchCount = normalizedBranches.length;
    const remainingBranchCount = !expanded && summaryBranch ? Math.max(visibleBranchCount - 1, 0) : visibleBranchCount;
    if (expanded || remainingBranchCount > 0 || !summaryBranch) {
      summaryParts.push(
        `<button type="button" class="task-cluster-link task-cluster-toggle" data-cluster-action="toggle-branches">${esc(expanded ? t("sidebar.branchCount", { count: visibleBranchCount }) : t("sidebar.moreBranches", { count: remainingBranchCount || visibleBranchCount }))}</button>`,
      );
    }
    metaOverrideHtml = summaryParts.join(' · ');
  }

  const mainItem = createActiveSessionItem(rootSession, {
    metaOverrideHtml,
    extraClassName: hasBranches ? "task-cluster-main" : "",
    onMetaReady(metaNode) {
      const currentBranchBtn = metaNode.querySelector('[data-cluster-action="open-current-branch"]');
      if (currentBranchBtn && summaryBranch) {
        currentBranchBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          attachSession(summaryBranch.id, summaryBranch);
          if (!isDesktop) closeSidebarFn();
        });
      }
      const toggleBtn = metaNode.querySelector('[data-cluster-action="toggle-branches"]');
      if (toggleBtn) {
        toggleBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleTaskClusterExpanded(rootSession.id, !expanded);
        });
      }
    },
  });
  wrapper.appendChild(mainItem);

  if (expanded && hasBranches) {
    const branchesWrap = document.createElement("div");
    branchesWrap.className = "task-cluster-branches";

    for (const branchSession of normalizedBranches) {
      const branchDepth = Number.isFinite(branchSession?._branchDepth)
        ? Math.max(1, Number(branchSession._branchDepth))
        : 1;
      const branchItem = createActiveSessionItem(branchSession, {
        hideActions: true,
        extraClassName: "task-branch-item",
        metaOverrideHtml: branchSession?._branchStatus && branchSession._branchStatus !== "active"
          ? `<span class="task-branch-status">${esc(
              branchSession._branchStatus === "resolved"
                ? "已完成"
                : branchSession._branchStatus === "merged"
                  ? "已带回主线"
                  : branchSession._branchStatus === "parked"
                    ? "已暂停"
                    : branchSession._branchStatus,
            )}</span><button type="button" class="task-cluster-link task-branch-reopen" data-branch-action="reopen">继续处理</button>`
          : "",
        onMetaReady(metaNode) {
          const reopenBtn = metaNode.querySelector('[data-branch-action="reopen"]');
          if (reopenBtn && window.MelodySyncWorkbench?.setCurrentBranchStatus) {
            reopenBtn.addEventListener("click", async (event) => {
              event.stopPropagation();
              reopenBtn.disabled = true;
              try {
                await window.MelodySyncWorkbench.setCurrentBranchStatus.call(null, "active", branchSession.id);
                attachSession(branchSession.id, branchSession);
              } finally {
                reopenBtn.disabled = false;
              }
            });
          }
        },
      });
      branchItem.dataset.branchDepth = String(branchDepth);
      branchItem.style.setProperty("--task-branch-depth", String(branchDepth));
      if (currentBranch && branchSession.id === currentBranch.id) {
        branchItem.classList.add("is-current-branch");
      }
      const nameNode = branchItem.querySelector(".session-item-name");
      if (nameNode) {
        if (currentBranch && branchSession.id === currentBranch.id) {
          nameNode.textContent = branchDepth > 1
            ? `当前子任务：${getTaskBranchDisplayName(branchSession)}`
            : getBranchStatusLabel(branchSession);
        } else {
          nameNode.textContent = branchDepth > 1
            ? `子任务：${getTaskBranchDisplayName(branchSession)}`
            : t("sidebar.branch", { name: getTaskBranchDisplayName(branchSession) });
        }
      }
      branchesWrap.appendChild(branchItem);
    }

    wrapper.appendChild(branchesWrap);
  }

  return wrapper;
}
