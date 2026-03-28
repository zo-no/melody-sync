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

function clipTaskLabel(value, max = 42) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toSingleGoalLabel(value, max = 42) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const firstSegment = compact
    .replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, "")
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return clipTaskLabel(firstSegment || compact, max);
}

function getPreferredSessionDisplayName(session) {
  const name = typeof session?.name === "string" ? session.name.trim() : "";
  const taskGoal = typeof session?.taskCard?.goal === "string" ? session.taskCard.goal.trim() : "";
  const mainGoal = typeof session?.taskCard?.mainGoal === "string" ? session.taskCard.mainGoal.trim() : "";
  const fallbackGoal = taskGoal || mainGoal;
  if (fallbackGoal && (session?.autoRenamePending === true || !name || name === t("session.defaultName"))) {
    return fallbackGoal;
  }
  return name || fallbackGoal || getFolderLabel(session?.folder) || t("session.defaultName");
}

function getSessionDisplayName(session) {
  return toSingleGoalLabel(getPreferredSessionDisplayName(session), 38);
}

function getTaskBranchDisplayName(session) {
  const raw = getPreferredSessionDisplayName(session);
  return toSingleGoalLabel(raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, "").trim() || raw, 34);
}

function renderTaskChevronIcon(expanded, className = "") {
  if (typeof renderUiIcon === "function") {
    return renderUiIcon(expanded ? "chevron-down" : "chevron-right", className);
  }
  return expanded ? "▾" : "▸";
}

function getBranchStatusLabel(session) {
  const status = String(session?._branchStatus || "").toLowerCase();
  const name = getTaskBranchDisplayName(session);
  if (status === "resolved") return `已关闭：${name}`;
  if (status === "merged") return `已带回主线：${name}`;
  if (status === "parked") return `已挂起：${name}`;
  return t("sidebar.currentBranch", { name });
}

function getBranchLineageNames(rootSession, branchSession, branchSessions = []) {
  const rootName = getSessionDisplayName(rootSession);
  const branchMap = new Map((Array.isArray(branchSessions) ? branchSessions : [])
    .filter((session) => session?.id)
    .map((session) => [session.id, session]));
  const lineage = [];
  const visited = new Set();
  let current = branchSession || null;

  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.unshift(getTaskBranchDisplayName(current));
    const parentId = typeof current?._branchParentSessionId === "string" ? current._branchParentSessionId.trim() : "";
    if (!parentId || parentId === rootSession?.id) break;
    current = branchMap.get(parentId) || null;
  }

  return [rootName, ...lineage].filter(Boolean);
}

function getBranchStatusValue(session) {
  return String(session?._branchStatus || "active").toLowerCase();
}

function buildBranchStatusCounts(branches = []) {
  const counts = {
    active: 0,
    parked: 0,
    resolved: 0,
    merged: 0,
  };
  for (const session of Array.isArray(branches) ? branches : []) {
    const status = getBranchStatusValue(session);
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

function buildBranchStatusSummary(counts) {
  const parts = [];
  if (counts.active > 0) parts.push(`进行中 ${counts.active}`);
  if (counts.parked > 0) parts.push(`已挂起 ${counts.parked}`);
  if (counts.resolved > 0) parts.push(`已关闭 ${counts.resolved}`);
  if (counts.merged > 0) parts.push(`已带回主线 ${counts.merged}`);
  return parts.join(" · ");
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

function getResolvedTaskListGroupKey(session) {
  return resolveTaskListGroup(typeof session?.group === "string" ? session.group.trim() : "").key;
}

function shouldRenderSnapshotBranchAsStandalone(branchSession, rootSession, cluster = null) {
  if (!branchSession?.id) return true;
  const currentBranchSessionId = typeof cluster?.currentBranchSessionId === "string"
    ? cluster.currentBranchSessionId.trim()
    : "";
  if (branchSession.id === currentBranchSessionId) return false;
  const branchStatus = String(branchSession?._branchStatus || "active").trim().toLowerCase();
  if (branchStatus === "active") return false;
  return getResolvedTaskListGroupKey(branchSession) !== getResolvedTaskListGroupKey(rootSession);
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
    const branchCandidates = branchIds.length > 0
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
    const branches = branchCandidates.filter((branch) => !shouldRenderSnapshotBranchAsStandalone(branch, root, cluster));
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
  const visibleItems = items.slice(-3);
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

const TASK_LIST_GROUPS = [
  { id: "inbox", key: "group:inbox", label: () => t("sidebar.group.inbox"), aliases: ["收件箱", "inbox"] },
  { id: "long_term", key: "group:long-term", label: () => t("sidebar.group.longTerm"), aliases: ["长期任务", "long-term", "long term"] },
  { id: "short_term", key: "group:short-term", label: () => t("sidebar.group.shortTerm"), aliases: ["短期任务", "short-term", "short term"] },
  { id: "knowledge_base", key: "group:knowledge-base", label: () => t("sidebar.group.knowledgeBase"), aliases: ["知识库内容", "knowledge-base", "knowledge base"] },
  { id: "waiting", key: "group:waiting", label: () => t("sidebar.group.waiting"), aliases: ["等待任务", "waiting"] },
];

function resolveTaskListGroup(groupValue = "") {
  const normalized = String(groupValue || "").replace(/\s+/g, " ").trim().toLowerCase();
  return TASK_LIST_GROUPS.find((entry) => entry.aliases.includes(normalized)) || TASK_LIST_GROUPS[0];
}

function getSessionGroupInfo(session) {
  const group = resolveTaskListGroup(typeof session?.group === "string" ? session.group.trim() : "");
  return {
    key: group.key,
    label: group.label(),
    title: group.label(),
    order: TASK_LIST_GROUPS.findIndex((entry) => entry.key === group.key),
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
  const displayTitle = getPreferredSessionDisplayName(session) || displayName;
  const metaHtml = typeof options.metaOverrideHtml === "string"
    ? options.metaOverrideHtml
    : buildSessionMetaParts(session).join(" · ");
  const hideActions = options.hideActions === true;

  div.innerHTML = `
    <div class="session-item-info">
      <div class="session-item-name" title="${esc(displayTitle)}">${session.pinned ? `<span class="session-pin-badge" title="${esc(t("sidebar.pinned"))}">${renderUiIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
      ${metaHtml ? `<div class="session-item-meta">${metaHtml}</div>` : ""}
    </div>
    ${hideActions ? "" : `<div class="session-item-actions">
      <button class="session-action-btn delete" type="button" title="${esc(t("action.delete"))}" aria-label="${esc(t("action.delete"))}" data-id="${session.id}">${renderUiIcon("trash")}</button>
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
    div.querySelector(".delete").addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchAction({ action: "delete", sessionId: session.id });
    });
  }

  return div;
}

function createTaskClusterItem(rootSession, branchSessions = [], options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-cluster";
  const compactMeta = (value, max = 40) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const firstSegment = text.split(/[。！？.!?\n]/).map((entry) => entry.trim()).find(Boolean);
    const compact = firstSegment || text;
    return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
  };

  const normalizedBranches = dedupeBranchSessions(branchSessions);
  const currentBranch = normalizedBranches.find((session) => session.id === currentSessionId)
    || normalizedBranches.find((session) => session.id === options.currentBranchSessionId)
    || null;
  const activeBranch = currentBranch
    || normalizedBranches.find((session) => getBranchStatusValue(session) === "active")
    || null;
  const hasBranches = normalizedBranches.length > 0;
  const expanded = hasBranches && expandedTaskClusters[rootSession.id] === true;
  if (expanded) wrapper.classList.add("is-expanded");

  let metaOverrideHtml = buildSessionMetaParts(rootSession).join(" · ");
  if (hasBranches) {
    const rootCheckpoint = typeof rootSession?.taskCard?.checkpoint === "string"
      ? rootSession.taskCard.checkpoint.trim()
      : "";
    const rootNextStep = Array.isArray(rootSession?.taskCard?.nextSteps)
      && typeof rootSession.taskCard.nextSteps[0] === "string"
      ? rootSession.taskCard.nextSteps[0].trim()
      : "";
    const rootDisplayName = getSessionDisplayName(rootSession) || "继续主线";
    const activePath = activeBranch
      ? getBranchLineageNames(rootSession, activeBranch, normalizedBranches).slice(1).map((entry) => compactMeta(entry, 18)).join(" / ")
      : "";
    const focusLabel = activeBranch ? "当前路径" : "当前焦点";
    const focusText = activeBranch
      ? compactMeta(activePath || getTaskBranchDisplayName(activeBranch), 52)
      : compactMeta(rootCheckpoint || rootNextStep || rootDisplayName, 52);
    const focusHtml = activeBranch
      ? `<button type="button" class="task-cluster-link task-cluster-current-branch" data-cluster-action="open-current-branch">${esc(focusText)}</button>`
      : `<span class="task-cluster-current-branch-text">${esc(focusText)}</span>`;
    metaOverrideHtml = `
      <span class="task-cluster-meta">
        <span class="task-cluster-focus">
          <span class="task-cluster-focus-label">${esc(focusLabel)}</span>
          ${focusHtml}
        </span>
      </span>
    `;
  }

  const mainItem = createActiveSessionItem(rootSession, {
    metaOverrideHtml,
    extraClassName: hasBranches ? "task-cluster-main" : "",
    onMetaReady(metaNode) {
      const currentBranchBtn = metaNode.querySelector('[data-cluster-action="open-current-branch"]');
      if (currentBranchBtn && activeBranch) {
        currentBranchBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          attachSession(activeBranch.id, activeBranch);
          if (!isDesktop) closeSidebarFn();
        });
      }
    },
  });
  if (hasBranches) {
    const expanderBtn = document.createElement("button");
    expanderBtn.type = "button";
    expanderBtn.className = "task-cluster-expander" + (expanded ? " is-expanded" : "");
    expanderBtn.innerHTML = renderTaskChevronIcon(expanded, "task-cluster-expander-icon");
    expanderBtn.setAttribute("aria-label", expanded ? "收起任务树" : "展开任务树");
    expanderBtn.title = expanded ? "收起任务树" : "展开任务树";
    expanderBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTaskClusterExpanded(rootSession.id, !expanded);
    });
    const infoNode = mainItem.querySelector(".session-item-info");
    if (infoNode) {
      mainItem.insertBefore(expanderBtn, infoNode);
    } else {
      mainItem.appendChild(expanderBtn);
    }
  }
  wrapper.appendChild(mainItem);

  if (expanded && hasBranches) {
    const branchesWrap = document.createElement("div");
    branchesWrap.className = "task-cluster-branches task-mindmap-branches";

    const branchById = new Map(
      normalizedBranches
        .filter((session) => session?.id)
        .map((session) => [session.id, session]),
    );
    const currentLineageIds = new Set();
    let lineageCursor = activeBranch;
    while (lineageCursor?.id && !currentLineageIds.has(lineageCursor.id)) {
      currentLineageIds.add(lineageCursor.id);
      const parentId = typeof lineageCursor?._branchParentSessionId === "string"
        ? lineageCursor._branchParentSessionId.trim()
        : "";
      if (!parentId || parentId === rootSession?.id) break;
      lineageCursor = branchById.get(parentId) || null;
    }

    const childrenByParent = new Map();
    for (const branchSession of normalizedBranches) {
      const parentId = typeof branchSession?._branchParentSessionId === "string" && branchSession._branchParentSessionId.trim()
        ? branchSession._branchParentSessionId.trim()
        : rootSession.id;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId).push(branchSession);
    }

    const statusOrder = { active: 0, parked: 1, resolved: 2, merged: 3 };
    const compareBranches = (left, right) => {
      const leftInLineage = currentLineageIds.has(left?.id) ? 0 : 1;
      const rightInLineage = currentLineageIds.has(right?.id) ? 0 : 1;
      if (leftInLineage !== rightInLineage) return leftInLineage - rightInLineage;

      const leftCurrent = activeBranch?.id === left?.id ? 0 : 1;
      const rightCurrent = activeBranch?.id === right?.id ? 0 : 1;
      if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;

      const leftStatus = statusOrder[getBranchStatusValue(left)] ?? 99;
      const rightStatus = statusOrder[getBranchStatusValue(right)] ?? 99;
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;

      return String(getTaskBranchDisplayName(left)).localeCompare(String(getTaskBranchDisplayName(right)));
    };

    const visitedBranchIds = new Set();
    const branchPaths = [];
    const appendPaths = (parentId, lineage = []) => {
      const children = [...(childrenByParent.get(parentId) || [])].sort(compareBranches);
      if (!children.length) {
        if (lineage.length > 0) {
          branchPaths.push(lineage);
        }
        return;
      }
      for (const child of children) {
        if (!child?.id) continue;
        visitedBranchIds.add(child.id);
        appendPaths(child.id, [...lineage, child]);
      }
    };
    appendPaths(rootSession.id, []);

    for (const branchSession of [...normalizedBranches].sort(compareBranches)) {
      if (!branchSession?.id || visitedBranchIds.has(branchSession.id)) continue;
      const lineage = [];
      const seen = new Set();
      let cursor = branchSession;
      while (cursor?.id && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        lineage.unshift(cursor);
        const parentId = typeof cursor?._branchParentSessionId === "string" && cursor._branchParentSessionId.trim()
          ? cursor._branchParentSessionId.trim()
          : "";
        if (!parentId || parentId === rootSession.id) break;
        cursor = branchById.get(parentId) || null;
      }
      branchPaths.push(lineage.length > 0 ? lineage : [branchSession]);
    }

    const seenPathKeys = new Set();
    const uniquePaths = branchPaths.filter((path) => {
      const key = path.map((session) => session?.id || "").filter(Boolean).join(">");
      if (!key || seenPathKeys.has(key)) return false;
      seenPathKeys.add(key);
      return true;
    });

    const board = document.createElement("div");
    board.className = "task-mindmap-board";

    for (const path of uniquePaths) {
      const pathRow = document.createElement("div");
      const pathHasCurrent = path.some((session) => session?.id && currentLineageIds.has(session.id));
      pathRow.className = "task-mindmap-path" + (pathHasCurrent ? " is-current-path" : "");

      const rootLink = document.createElement("span");
      rootLink.className = "task-mindmap-link task-mindmap-root-link" + (pathHasCurrent ? " is-current" : "");
      pathRow.appendChild(rootLink);

      for (let index = 0; index < path.length; index += 1) {
        const branchSession = path[index];
        if (!branchSession?.id) continue;
        const parentSession = index === 0 ? rootSession : path[index - 1];
        const branchStatus = getBranchStatusValue(branchSession);
        const isCurrentBranch = activeBranch && branchSession.id === activeBranch.id;
        const isCurrentChain = currentLineageIds.has(branchSession.id);
        const metaParts = [];

        let statusLabel = "进行中";
        if (branchStatus === "parked") statusLabel = "已挂起";
        if (branchStatus === "resolved") statusLabel = "已关闭";
        if (branchStatus === "merged") statusLabel = "已带回";
        if (isCurrentChain) statusLabel = isCurrentBranch ? "当前位置" : "当前路径";

        if (index > 0 && parentSession) {
          metaParts.push(`<span class="task-branch-parent">${esc(`上级：${getTaskBranchDisplayName(parentSession)}`)}</span>`);
        }
        metaParts.push(`<span class="task-branch-status${isCurrentBranch ? " is-current" : ""}">${esc(statusLabel)}</span>`);
        const nodeHint = Array.isArray(branchSession?.taskCard?.nextSteps) && typeof branchSession.taskCard.nextSteps[0] === "string"
          ? branchSession.taskCard.nextSteps[0].trim()
          : "";
        if (nodeHint && !isCurrentBranch) {
          metaParts.push(`<span class="task-branch-path">${esc(compactMeta(nodeHint, 34))}</span>`);
        }
        if (branchStatus !== "active") {
          metaParts.push(`<button type="button" class="task-cluster-link task-branch-reopen" data-branch-action="reopen">继续处理</button>`);
        }

        const branchItem = createActiveSessionItem(branchSession, {
          hideActions: true,
          extraClassName: "task-branch-item task-mindmap-node",
          metaOverrideHtml: metaParts.join(""),
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
        if (isCurrentChain) {
          branchItem.classList.add("is-current-chain");
        }
        if (isCurrentBranch) {
          branchItem.classList.add("is-current-branch");
        }
        if (branchStatus === "resolved") {
          branchItem.classList.add("is-resolved");
        }
        const nameNode = branchItem.querySelector(".session-item-name");
        if (nameNode) {
          nameNode.textContent = getTaskBranchDisplayName(branchSession);
        }
        pathRow.appendChild(branchItem);

        if (index < path.length - 1) {
          const link = document.createElement("span");
          const nextSession = path[index + 1];
          const nextInCurrentPath = nextSession?.id && currentLineageIds.has(nextSession.id);
          link.className = "task-mindmap-link" + (nextInCurrentPath ? " is-current" : "");
          pathRow.appendChild(link);
        }
      }

      board.appendChild(pathRow);
    }

    branchesWrap.appendChild(board);

    wrapper.appendChild(branchesWrap);
  }

  return wrapper;
}
