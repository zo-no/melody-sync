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
  return Boolean(
    (typeof session?._branchParentSessionId === "string" && session._branchParentSessionId.trim())
    || (typeof session?.sourceContext?.parentSessionId === "string" && session.sourceContext.parentSessionId.trim())
  );
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

function getSessionCreatedTimestamp(session) {
  const value = session?.createdAt || session?.created || session?.updatedAt || session?.lastEventAt || "";
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
  return [...branches].sort((a, b) => {
    const leftCreated = getSessionCreatedTimestamp(a);
    const rightCreated = getSessionCreatedTimestamp(b);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
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
  return parts;
}

function getFilteredSessionEmptyText({ archived = false } = {}) {
  if (archived) return t("sidebar.noArchived");
  return t("sidebar.noSessions");
}

const TASK_LIST_GROUPS = [
  { id: "inbox", key: "group:inbox", label: () => t("sidebar.group.inbox"), aliases: ["收集箱", "收件箱", "capture", "inbox"] },
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

function buildSessionActionConfigs(session, options = {}) {
  if (Array.isArray(options.actions)) {
    return options.actions.filter(Boolean);
  }
  const activity = typeof getSessionActivity === "function"
    ? getSessionActivity(session)
    : {
        run: { state: "idle" },
        compact: { state: "idle" },
        queue: { count: 0 },
      };
  const canOrganize = session?.archived !== true
    && activity.run.state !== "running"
    && activity.compact.state !== "pending"
    && (!Number.isInteger(activity.queue.count) || activity.queue.count === 0);
  if (session?.archived === true) {
    return [
      {
        key: "restore",
        action: "unarchive",
        label: t("action.restore"),
        icon: "unarchive",
        className: "restore",
      },
      {
        key: "delete",
        action: "delete",
        label: t("action.delete"),
        icon: "trash",
        className: "delete",
      },
    ];
  }
  return [
    canOrganize ? {
      key: "organize",
      action: "organize",
      label: t("action.organize"),
      icon: "refresh",
      className: "organize",
    } : null,
    {
      key: "archive",
      action: "archive",
      label: t("action.archive"),
      icon: "archive",
      className: "archive",
    },
  ].filter(Boolean);
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
  const actionConfigs = options.hideActions === true ? [] : buildSessionActionConfigs(session, options);
  const hideActions = actionConfigs.length === 0;
  const actionsHtml = actionConfigs.map((entry) => `
      <button class="session-action-btn ${esc(entry.className || entry.key || "action")}" type="button" title="${esc(entry.label || "")}" aria-label="${esc(entry.label || "")}" data-id="${session.id}" data-action="${esc(entry.key || entry.action || "")}">${renderUiIcon(entry.icon || "close")}</button>
    `).join("");

  div.innerHTML = `
    <div class="session-item-info">
      <div class="session-item-name" title="${esc(displayTitle)}">${session.pinned ? `<span class="session-pin-badge" title="${esc(t("sidebar.pinned"))}">${renderUiIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
      ${metaHtml ? `<div class="session-item-meta">${metaHtml}</div>` : ""}
    </div>
    ${hideActions ? "" : `<div class="session-item-actions">${actionsHtml}</div>`}`;

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
    actionConfigs.forEach((entry) => {
      const selector = `.session-action-btn[data-action="${entry.key || entry.action || ""}"]`;
      const actionBtn = div.querySelector(selector);
      if (!actionBtn) return;
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof entry.onClick === "function") {
          entry.onClick(e, session, div);
          return;
        }
        if (entry.action) {
          dispatchAction({ action: entry.action, sessionId: session.id });
        }
      });
    });
  }

  return div;
}

function createTaskClusterNodes(rootSession, branchSessions = [], options = {}) {
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
    const focusText = activeBranch
      ? compactMeta(activePath || getTaskBranchDisplayName(activeBranch), 52)
      : compactMeta(rootCheckpoint || rootNextStep || rootDisplayName, 52);
    const focusHtml = activeBranch
      ? `<button type="button" class="task-cluster-link task-root-current-link" data-cluster-action="open-current-branch"><span class="task-root-dot is-active"></span><span class="task-root-current-copy">${esc(focusText)}</span></button>`
      : `<span class="task-root-current-text"><span class="task-root-dot is-active"></span><span class="task-root-current-copy">${esc(focusText)}</span></span>`;
    metaOverrideHtml = `
      <span class="task-root-meta-line">
        ${focusHtml}
      </span>
    `;
  }

  const mainItem = createActiveSessionItem(rootSession, {
    metaOverrideHtml,
    extraClassName: hasBranches ? "task-cluster-main task-cluster-root-card task-tree-root-row" : "",
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
  if (expanded) {
    mainItem.classList.add("is-expanded");
  }
  const expanderSlot = hasBranches
    ? (() => {
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
        return expanderBtn;
      })()
    : (() => {
        const placeholder = document.createElement("span");
        placeholder.className = "task-cluster-expander task-cluster-expander-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        return placeholder;
      })();
  const infoNode = mainItem.querySelector(".session-item-info");
  if (infoNode) {
    mainItem.insertBefore(expanderSlot, infoNode);
  } else {
    mainItem.appendChild(expanderSlot);
  }
  const nodes = [mainItem];

  if (expanded && hasBranches) {
    const branchById = new Map(
      normalizedBranches
        .filter((session) => session?.id)
        .map((session) => [session.id, session]),
    );
    const branchOrderMap = new Map(
      normalizedBranches
        .filter((session) => session?.id)
        .map((session, index) => [session.id, index]),
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

    const compareBranches = (left, right) => {
      const leftOrder = branchOrderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = branchOrderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = getSessionCreatedTimestamp(left);
      const rightCreated = getSessionCreatedTimestamp(right);
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return String(left?.id || "").localeCompare(String(right?.id || ""));
    };
    for (const [parentId, children] of childrenByParent.entries()) {
      childrenByParent.set(parentId, [...children].sort(compareBranches));
    }

    const createBranchTreeNode = (branchSession, depth = 1) => {
      const item = document.createElement("div");
      item.className = `task-cluster-tree-item depth-${Math.min(depth, 6)}`;

      const children = childrenByParent.get(branchSession.id) || [];
      const branchStatus = getBranchStatusValue(branchSession);
      const isCurrentBranch = activeBranch && branchSession.id === activeBranch.id;
      const isCurrentChain = currentLineageIds.has(branchSession.id);

      const summary = compactMeta(
        (Array.isArray(branchSession?.taskCard?.nextSteps) && typeof branchSession.taskCard.nextSteps[0] === "string"
          ? branchSession.taskCard.nextSteps[0]
          : "")
        || (typeof branchSession?.taskCard?.checkpoint === "string" ? branchSession.taskCard.checkpoint : ""),
        38,
      );
      const metaParts = [
        `<span class="task-branch-inline-meta"><span class="task-branch-dot is-${esc(branchStatus || "active")}"></span></span>`,
      ];
      if (summary) {
        metaParts.push(`<span class="task-branch-inline-summary">${esc(summary)}</span>`);
      }

      const row = createActiveSessionItem(branchSession, {
        hideActions: false,
        extraClassName: "task-cluster-tree-row",
        metaOverrideHtml: metaParts.join(""),
      });
      const nameNode = row.querySelector(".session-item-name");
      if (nameNode) {
        nameNode.textContent = getTaskBranchDisplayName(branchSession);
      }
      if (isCurrentChain) {
        row.classList.add("is-current-chain");
        item.classList.add("is-current-chain");
      }
      if (isCurrentBranch) {
        row.classList.add("is-current-branch");
        item.classList.add("is-current-branch");
      }
      if (branchStatus === "resolved" || branchStatus === "merged") {
        row.classList.add("is-resolved");
      }

      item.appendChild(row);

      if (children.length > 0) {
        const childrenWrap = document.createElement("div");
        childrenWrap.className = "task-cluster-tree-children";
        for (const childSession of children) {
          childrenWrap.appendChild(createBranchTreeNode(childSession, depth + 1));
        }
        item.appendChild(childrenWrap);
      }

      return item;
    };

    const treeCard = document.createElement("div");
    treeCard.className = "task-cluster-tree-card";
    const tree = document.createElement("div");
    tree.className = "task-cluster-tree";
    for (const branchSession of childrenByParent.get(rootSession.id) || []) {
      tree.appendChild(createBranchTreeNode(branchSession, 1));
    }
    treeCard.appendChild(tree);
    nodes.push(treeCard);
  }

  return nodes;
}

function createTaskClusterItem(rootSession, branchSessions = [], options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-cluster";
  const nodes = createTaskClusterNodes(rootSession, branchSessions, options);
  for (const node of nodes) {
    wrapper.appendChild(node);
  }
  const normalizedBranches = dedupeBranchSessions(branchSessions);
  const expanded = normalizedBranches.length > 0 && expandedTaskClusters[rootSession.id] === true;
  if (expanded) {
    wrapper.classList.add("is-expanded");
  }
  return wrapper;
}
