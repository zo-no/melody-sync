function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

function renderSessionIcon(name, className = "") {
  return window.MelodySyncIcons?.render(name, { className }) || "";
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

function normalizeSessionOrdinal(value) {
  const parsed = typeof value === "number"
    ? value
    : parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function formatSessionOrdinalBadge(value) {
  const ordinal = normalizeSessionOrdinal(value);
  return ordinal ? `#${ordinal}` : "";
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
  const displaySession = typeof getDisplaySession === "function"
    ? getDisplaySession(session)
    : session;
  const name = typeof displaySession?.name === "string" ? displaySession.name.trim() : "";
  const taskGoal = typeof displaySession?.taskCard?.goal === "string" ? displaySession.taskCard.goal.trim() : "";
  const mainGoal = typeof displaySession?.taskCard?.mainGoal === "string" ? displaySession.taskCard.mainGoal.trim() : "";
  const fallbackGoal = taskGoal || mainGoal;
  if (fallbackGoal && (displaySession?.autoRenamePending === true || !name || name === t("session.defaultName"))) {
    return fallbackGoal;
  }
  return name || fallbackGoal || getFolderLabel(displaySession?.folder) || t("session.defaultName");
}

function getSessionDisplayName(session) {
  const ordinalBadge = formatSessionOrdinalBadge(session?.ordinal);
  const displayName = toSingleGoalLabel(getPreferredSessionDisplayName(session), 38);
  if (ordinalBadge && displayName) {
    return clipTaskLabel(`${ordinalBadge} ${displayName}`, 38);
  }
  return ordinalBadge || displayName;
}

function normalizeComparableText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getTaskCardList(taskCard, key) {
  return Array.isArray(taskCard?.[key])
    ? taskCard[key].filter((entry) => typeof entry === "string" && entry.trim())
    : [];
}

function getTaskMapClustersApi() {
  return window.MelodySyncTaskMapClusters
    || globalThis.MelodySyncTaskMapClusters
    || null;
}

function getWorkbenchApiForDisplay() {
  return window.MelodySyncWorkbench
    || globalThis.MelodySyncWorkbench
    || null;
}

function getDisplaySession(session) {
  if (!session || typeof session !== "object") return session || null;
  const workbench = getWorkbenchApiForDisplay();
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  if (sessionId && typeof workbench?.getSessionRecord === "function") {
    const record = workbench.getSessionRecord(sessionId);
    if (record && typeof record === "object") return record;
  }
  if (typeof workbench?.applyLiveTaskCardPreview === "function") {
    return workbench.applyLiveTaskCardPreview(session) || session;
  }
  return session;
}

function getWorkbenchSnapshot() {
  return window.MelodySyncWorkbench?.getSnapshot?.() || null;
}

function getSessionCatalogRecords() {
  if (typeof sessions !== "undefined" && Array.isArray(sessions)) {
    return sessions;
  }
  return [];
}

function getTaskClusters() {
  const snapshot = getWorkbenchSnapshot();
  const taskMapClustersApi = getTaskMapClustersApi();
  if (typeof taskMapClustersApi?.getClusterList === "function") {
    return taskMapClustersApi.getClusterList(snapshot, getSessionCatalogRecords());
  }
  return Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
}

function getTaskClusterForSession(session) {
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  if (!sessionId) return null;
  return getTaskClusters().find((cluster) => {
    if (String(cluster?.mainSessionId || "").trim() === sessionId) return true;
    if (Array.isArray(cluster?.branchSessionIds) && cluster.branchSessionIds.includes(sessionId)) return true;
    return Array.isArray(cluster?.branchSessions)
      && cluster.branchSessions.some((entry) => String(entry?.id || "").trim() === sessionId);
  }) || null;
}

function getTaskClusterCurrentBranchSessionId(cluster, preferredSessionId = "") {
  const normalizedPreferredSessionId = String(preferredSessionId || "").trim();
  const mainSessionId = String(cluster?.mainSessionId || "").trim();
  if (normalizedPreferredSessionId && normalizedPreferredSessionId !== mainSessionId) {
    const branchIds = new Set(
      [
        ...(Array.isArray(cluster?.branchSessionIds) ? cluster.branchSessionIds : []),
        ...(Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.map((entry) => entry?.id) : []),
      ]
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    );
    if (branchIds.has(normalizedPreferredSessionId)) {
      return normalizedPreferredSessionId;
    }
  }
  return String(cluster?.currentBranchSessionId || "").trim();
}

function getTaskClusterCurrentBranchSession(cluster, preferredSessionId = "") {
  const currentBranchSessionId = getTaskClusterCurrentBranchSessionId(cluster, preferredSessionId);
  if (!currentBranchSessionId) return null;
  return getSessionCatalogRecords().find((entry) => entry?.id === currentBranchSessionId)
    || (Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.find((entry) => String(entry?.id || "").trim() === currentBranchSessionId)
      : null)
    || null;
}

function getTaskClusterParentSession(cluster, session) {
  const sessionId = typeof session?.id === "string" ? session.id.trim() : "";
  if (!cluster || !sessionId) return null;
  const branchSession = Array.isArray(cluster?.branchSessions)
    ? cluster.branchSessions.find((entry) => String(entry?.id || "").trim() === sessionId)
    : null;
  if (!branchSession) return null;
  const parentSessionId = String(
    branchSession?._branchParentSessionId
    || session?._branchParentSessionId
    || session?.branchParentSessionId
    || session?.sourceContext?.parentSessionId
    || cluster?.mainSessionId
    || "",
  ).trim();
  if (!parentSessionId) return null;
  if (parentSessionId === String(cluster?.mainSessionId || "").trim()) {
    return getSessionCatalogRecords().find((entry) => entry?.id === parentSessionId)
      || cluster?.mainSession
      || null;
  }
  return getSessionCatalogRecords().find((entry) => entry?.id === parentSessionId)
    || (Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.find((entry) => String(entry?.id || "").trim() === parentSessionId)
      : null)
    || null;
}

function getTaskBranchStatusLabel(session) {
  const model = window.MelodySyncSessionListModel || null;
  const status = typeof model?.getBranchTaskStatus === "function"
    ? model.getBranchTaskStatus(session)
    : "";
  if (status === "parked") return "已挂起";
  if (status === "merged") return "已带回主线";
  if (["resolved", "done", "closed"].includes(status)) return "已关闭";
  if (status === "active") return "进行中";
  return "";
}

function getTaskBranchStatusClassName(session) {
  const model = window.MelodySyncSessionListModel || null;
  const status = typeof model?.getBranchTaskStatus === "function"
    ? model.getBranchTaskStatus(session)
    : "";
  if (status === "parked") return "status-parked";
  if (status === "merged") return "status-done";
  if (["resolved", "done", "closed"].includes(status)) return "status-done";
  if (status === "active") return "status-running";
  return "";
}

function getTaskClusterBranchCountEntries(cluster, currentSessionId = "") {
  const branchSessions = Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [];
  if (branchSessions.length === 0) return [];
  const model = window.MelodySyncSessionListModel || null;
  const counters = {
    active: 0,
    parked: 0,
    closed: 0,
    merged: 0,
  };
  for (const entry of branchSessions) {
    const status = typeof model?.getBranchTaskStatus === "function"
      ? model.getBranchTaskStatus(entry)
      : "";
    if (status === "parked") {
      counters.parked += 1;
    } else if (status === "merged") {
      counters.merged += 1;
    } else if (["resolved", "done", "closed"].includes(status)) {
      counters.closed += 1;
    } else {
      counters.active += 1;
    }
  }
  const currentBranch = getTaskClusterCurrentBranchSession(cluster, currentSessionId);
  if (currentBranch?.id && currentBranch.id !== String(cluster?.mainSessionId || "").trim()) {
    return [];
  }
  const entries = [];
  if (counters.active > 0) {
    entries.push({ key: "active", label: "进行中", count: counters.active, className: "status-running" });
  }
  if (counters.parked > 0) {
    entries.push({ key: "parked", label: "挂起", count: counters.parked, className: "status-parked" });
  }
  if (counters.merged > 0) {
    entries.push({ key: "merged", label: "带回主线", count: counters.merged, className: "status-done" });
  }
  if (counters.closed > 0) {
    entries.push({ key: "closed", label: "已关闭", count: counters.closed, className: "status-done" });
  }
  return entries;
}

function summarizeTaskClusterBranchCounts(cluster, currentSessionId = "") {
  const branchSessions = Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [];
  if (branchSessions.length === 0) return "";
  const currentBranch = getTaskClusterCurrentBranchSession(cluster, currentSessionId);
  if (currentBranch?.id && currentBranch.id !== String(cluster?.mainSessionId || "").trim()) {
    return `当前子任务：${toSingleGoalLabel(getPreferredSessionDisplayName(currentBranch), 28)}`;
  }
  const parts = getTaskClusterBranchCountEntries(cluster, currentSessionId)
    .map((entry) => `${entry.label} ${entry.count}`);
  if (parts.length > 0) return parts.join(" · ");
  return `包含 ${branchSessions.length} 条子任务`;
}

function looksLikeVisibleTaskTitle(session, text) {
  const displaySession = typeof getDisplaySession === "function"
    ? getDisplaySession(session)
    : session;
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) return false;
  return [
    getSessionDisplayName(displaySession),
    getPreferredSessionDisplayName(displaySession),
    displaySession?.taskCard?.goal,
    displaySession?.taskCard?.mainGoal,
    displaySession?.name,
  ]
    .map(normalizeComparableText)
    .filter(Boolean)
    .includes(normalizedText);
}

function getSessionTaskPreview(session) {
  const displaySession = typeof getDisplaySession === "function"
    ? (getDisplaySession(session) || session)
    : session;
  const taskCard = displaySession?.taskCard && typeof displaySession.taskCard === "object" ? displaySession.taskCard : {};
  const model = window.MelodySyncSessionListModel || null;
  const isBranch = typeof model?.isBranchTaskSession === "function"
    ? model.isBranchTaskSession(displaySession)
    : String(taskCard?.lineRole || "").trim().toLowerCase() === "branch";
  const taskCluster = getTaskClusterForSession(displaySession);
  const checkpoint = clipTaskLabel(String(taskCard?.checkpoint || "").trim(), 84);
  const summary = clipTaskLabel(String(taskCard?.summary || "").trim(), 84);
  const firstConclusion = clipTaskLabel(getTaskCardList(taskCard, "knownConclusions")[0] || "", 84);
  let summaryLine = "";
  let summarySegments = [];
  for (const candidate of [checkpoint, summary, firstConclusion]) {
    if (!candidate || looksLikeVisibleTaskTitle(displaySession, candidate)) continue;
    summaryLine = candidate;
    break;
  }

  let hintLine = "";
  let hintSegments = [];
  if (isBranch) {
    const branchStatusLabel = getTaskBranchStatusLabel(displaySession);
    const branchStatusClassName = getTaskBranchStatusClassName(displaySession);
    const parentSession = getTaskClusterParentSession(taskCluster, displaySession);
    const branchFrom = clipTaskLabel(
      getPreferredSessionDisplayName(parentSession)
      || String(taskCard?.branchFrom || "").trim()
      || String(taskCard?.mainGoal || "").trim(),
      30,
    );
    hintLine = [branchStatusLabel, branchFrom ? `来自主线：${branchFrom}` : ""].filter(Boolean).join(" · ");
    if (branchStatusLabel) {
      hintSegments.push({
        variant: "status",
        text: branchStatusLabel,
        className: branchStatusClassName,
      });
    }
    if (branchFrom) {
      hintSegments.push({
        variant: "text",
        text: `来自主线：${branchFrom}`,
      });
    }
  } else if (taskCluster) {
    hintLine = summarizeTaskClusterBranchCounts(taskCluster, displaySession?.id || "");
    const currentBranch = getTaskClusterCurrentBranchSession(taskCluster, displaySession?.id || "");
    if (!currentBranch?.id || currentBranch.id === String(taskCluster?.mainSessionId || "").trim()) {
      hintSegments = getTaskClusterBranchCountEntries(taskCluster, displaySession?.id || "")
        .map((entry) => ({
          variant: "status",
          text: `${entry.label} ${entry.count}`,
          className: entry.className,
        }));
    }
  }

  if (!summaryLine && hintLine) {
    summaryLine = hintLine;
    summarySegments = hintSegments;
    hintLine = "";
    hintSegments = [];
  }

  return {
    summaryLine,
    summarySegments,
    hintLine,
    hintSegments,
  };
}

function renderSessionTaskPreviewLineHtml(lineClassName, lineText, segments = []) {
  if (!lineText) return "";
  const normalizedSegments = Array.isArray(segments)
    ? segments
      .filter((segment) => segment && String(segment.text || "").trim())
      .map((segment) => ({
        variant: String(segment.variant || "text").trim().toLowerCase() || "text",
        text: String(segment.text || "").trim(),
        className: String(segment.className || "").trim(),
      }))
    : [];
  if (normalizedSegments.length === 0) {
    return `<div class="${lineClassName}" title="${esc(lineText)}">${esc(lineText)}</div>`;
  }

  const classNames = [lineClassName, "has-status-chips"].filter(Boolean).join(" ");
  const body = [];
  normalizedSegments.forEach((segment, index) => {
    const isStatus = segment.variant === "status";
    if (!isStatus && index > 0) {
      body.push('<span class="session-item-preview-separator" aria-hidden="true">·</span>');
    }
    if (isStatus) {
      const statusClassName = ["task-branch-status", segment.className].filter(Boolean).join(" ");
      body.push(`<span class="${esc(statusClassName)}">${esc(segment.text)}</span>`);
      return;
    }
    body.push(`<span class="session-item-preview-copy">${esc(segment.text)}</span>`);
  });

  return `<div class="${classNames}" title="${esc(lineText)}">${body.join("")}</div>`;
}

function renderSessionTaskPreviewHtml(session) {
  const preview = getSessionTaskPreview(session);
  const parts = [];
  if (preview.summaryLine) {
    parts.push(renderSessionTaskPreviewLineHtml(
      "session-item-summary",
      preview.summaryLine,
      preview.summarySegments,
    ));
  }
  if (preview.hintLine) {
    parts.push(renderSessionTaskPreviewLineHtml(
      "session-item-hint",
      preview.hintLine,
      preview.hintSegments,
    ));
  }
  return parts.join("");
}

function getSessionDisplayRenderKey(session) {
  const displaySession = typeof getDisplaySession === "function"
    ? (getDisplaySession(session) || session)
    : session;
  const preview = getSessionTaskPreview(displaySession);
  return [
    String(displaySession?.id || "").trim(),
    getSessionDisplayName(displaySession),
    getPreferredSessionDisplayName(displaySession),
    String(preview?.summaryLine || "").trim(),
    String(preview?.hintLine || "").trim(),
    String(displaySession?.activity?.run?.state || "").trim().toLowerCase(),
    String(displaySession?.workflowState || "").trim().toLowerCase(),
  ].join("|");
}

function formatQueuedMessageTimestamp(stamp) {
  if (!stamp) return t("queue.timestamp.default");
  const parsed = new Date(stamp).getTime();
  if (!Number.isFinite(parsed)) return t("queue.timestamp.default");
  return t("queue.timestamp.withTime", { time: messageTimeFormatter.format(parsed) });
}

function isMessagesViewportNearBottom({ threshold = 120 } = {}) {
  if (!messagesEl) return false;
  const scrollHeight = Number(messagesEl.scrollHeight) || 0;
  const scrollTop = Number(messagesEl.scrollTop) || 0;
  const clientHeight = Number(messagesEl.clientHeight) || 0;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

function getQueuedPanelAnchorKey(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "0";
  const latestItem = items[items.length - 1] || null;
  const latestToken = latestItem?.requestId
    || latestItem?.queuedAt
    || latestItem?.id
    || "";
  return `${items.length}:${latestToken}`;
}

function preserveQueuedPanelBottomAnchor() {
  if (typeof scrollToBottom === "function") {
    scrollToBottom();
    return;
  }
  if (!messagesEl || typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function renderQueuedMessagePanel(session) {
  if (!queuedPanel) return;
  const items = Array.isArray(session?.queuedMessages) ? session.queuedMessages : [];
  const shouldShowPanel = !!session?.id && session.id === currentSessionId && items.length > 0;
  const previousVisible = queuedPanel.classList.contains("visible");
  const previousAnchorKey = queuedPanel.dataset?.queueAnchorKey || "0";
  const nextAnchorKey = getQueuedPanelAnchorKey(items);
  const shouldPreserveBottom = session?.id === currentSessionId
    && isMessagesViewportNearBottom()
    && (previousVisible !== shouldShowPanel || previousAnchorKey !== nextAnchorKey);

  if (!shouldShowPanel) {
    queuedPanel.innerHTML = "";
    queuedPanel.classList.remove("visible");
    if (queuedPanel.dataset) {
      delete queuedPanel.dataset.queueAnchorKey;
    }
    if (shouldPreserveBottom) {
      preserveQueuedPanelBottomAnchor();
    }
    return;
  }

  queuedPanel.innerHTML = "";
  queuedPanel.classList.add("visible");
  if (queuedPanel.dataset) {
    queuedPanel.dataset.queueAnchorKey = nextAnchorKey;
  }

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

  if (shouldPreserveBottom) {
    preserveQueuedPanelBottomAnchor();
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
    && window.MelodySyncSessionStateModel
    && typeof window.MelodySyncSessionStateModel.getWorkflowStatusInfo === "function"
    ? window.MelodySyncSessionStateModel.getWorkflowStatusInfo(session?.workflowState)
    : null;
  return workflowStatus || liveStatus;
}

function getSessionReviewStatusInfo(session) {
  return typeof window !== "undefined"
    && window.MelodySyncSessionStateModel
    && typeof window.MelodySyncSessionStateModel.getSessionReviewStatusInfo === "function"
    ? window.MelodySyncSessionStateModel.getSessionReviewStatusInfo(session)
    : null;
}

function getDoneWorkflowStatusInfo(session) {
  const model = typeof window !== "undefined" ? window.MelodySyncSessionStateModel : null;
  if (!model || typeof model.getWorkflowStatusInfo !== "function") return null;
  const workflowStatus = model.getWorkflowStatusInfo(session?.workflowState);
  return workflowStatus?.key === "done" ? workflowStatus : null;
}

function getSessionListTouchStatusInfo(session) {
  const model = typeof window !== "undefined" ? window.MelodySyncSessionStateModel : null;
  if (!model || !session) return null;
  if (typeof model.isSessionBusy === "function" && model.isSessionBusy(session)) {
    const liveStatus = typeof getSessionStatusSummary === "function"
      ? getSessionStatusSummary(session).primary
      : null;
    return {
      key: "running",
      label: t("status.running"),
      className: "status-running",
      title: liveStatus?.title || t("status.running"),
    };
  }
  const reviewStatus = typeof model.getSessionReviewStatusInfo === "function"
    ? model.getSessionReviewStatusInfo(session)
    : null;
  if (!reviewStatus) return null;
  const doneStatus = getDoneWorkflowStatusInfo(session);
  if (doneStatus) {
    return {
      ...doneStatus,
      label: doneStatus.label || t("workflow.status.done"),
      title: t("workflow.status.finishedTitle") || doneStatus.title || t("workflow.status.doneTitle"),
    };
  }
  return {
    key: "finished",
    label: t("workflow.status.finished") || t("workflow.status.done"),
    className: "status-done",
    itemClass: "is-done-session",
    title: t("workflow.status.finishedTitle") || t("workflow.status.doneTitle"),
  };
}

function isSessionCompleteAndReviewed(session) {
  return typeof window !== "undefined"
    && window.MelodySyncSessionStateModel
    && typeof window.MelodySyncSessionStateModel.isSessionCompleteAndReviewed === "function"
    ? window.MelodySyncSessionStateModel.isSessionCompleteAndReviewed(session)
    : false;
}

function buildSessionMetaParts(session, { touchStatusInfo = null } = {}) {
  const parts = [];
  const touchStatusHtml = renderSessionStatusHtml(touchStatusInfo || getSessionListTouchStatusInfo(session));
  if (touchStatusHtml) parts.push(touchStatusHtml);
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
  const isArchivedSession = options.archived === true || session?.archived === true;
  const isBusySession = typeof isSessionBusy === "function"
    ? isSessionBusy(session)
    : false;
  const hasUnreadUpdate = typeof getSessionReviewStatusInfo === "function"
    ? Boolean(getSessionReviewStatusInfo(session))
    : false;
  const rawWorkflowState = String(session?.workflowState || "").trim().toLowerCase();
  const normalizedWorkflowState = typeof window !== "undefined"
    && window.MelodySyncSessionStateModel
    && typeof window.MelodySyncSessionStateModel.normalizeSessionWorkflowState === "function"
      ? window.MelodySyncSessionStateModel.normalizeSessionWorkflowState(rawWorkflowState)
      : "";
  const fallbackDoneWorkflowState = [
    "done",
    "complete",
    "completed",
    "finished",
    "完成",
    "已完成",
    "运行完毕",
    "运行完成",
  ].includes(rawWorkflowState);
  const isDoneSession = !isBusySession && (normalizedWorkflowState === "done" || fallbackDoneWorkflowState);
  if (isArchivedSession) {
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
    {
      key: session?.pinned === true ? "unpin" : "pin",
      action: session?.pinned === true ? "unpin" : "pin",
      label: session?.pinned === true ? t("action.unpin") : t("action.pin"),
      icon: session?.pinned === true ? "pinned" : "pin",
      className: session?.pinned === true ? "pin pinned" : "pin",
    },
    isDoneSession ? {
      key: "restore_pending",
      action: "restore_pending",
      label: t("action.restorePending"),
      icon: "unarchive",
      className: "restore",
    } : {
      key: "complete_pending",
      action: "complete_pending",
      label: t("action.completePending"),
      icon: "check",
      className: "complete",
    },
    {
      key: "archive",
      action: "archive",
      label: t("action.archive"),
      icon: "archive",
      className: "archive",
    },
    hasUnreadUpdate ? {
      key: "acknowledge",
      action: "acknowledge",
      label: t("action.acknowledge"),
      icon: "check",
      className: "acknowledge",
      onClick(event, currentSession) {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        if (typeof markSessionReviewed !== "function") return;
        return markSessionReviewed(currentSession, { sync: true, render: true });
      },
    } : null,
  ].filter(Boolean);
}

function renderSessionActionButtonHtml(session, entry, options = {}) {
  if (!entry) return "";
  const actionKey = esc(entry.key || entry.action || "");
  const label = esc(entry.label || "");
  const className = esc(
    `session-action-btn ${entry.className || entry.key || "action"}${options.leading === true ? " session-item-leading-action archive-checkbox" : ""}`,
  );
  if (options.leading === true) {
    return `
      <button class="${className}" type="button" title="${label}" aria-label="${label}" data-id="${session.id}" data-action="${actionKey}">
        <span class="session-action-checkbox-ring">${renderSessionIcon("check", "session-action-checkbox-icon")}</span>
      </button>
    `;
  }
  return `
      <button class="${className}" type="button" title="${label}" aria-label="${label}" data-id="${session.id}" data-action="${actionKey}">${renderSessionIcon(entry.icon || "close")}</button>
    `;
}

function createActiveSessionItem(session, options = {}) {
  const statusInfo = getSessionMetaStatusInfo(session);
  const touchStatusInfo = getSessionListTouchStatusInfo(session);
  const completeRead = isSessionCompleteAndReviewed(session);
  const taskPreviewHtml = renderSessionTaskPreviewHtml(session);
  const extraClassName = typeof options.extraClassName === "string" && options.extraClassName.trim()
    ? ` ${options.extraClassName.trim()}`
    : "";
  const div = document.createElement("div");
  div.className =
    "session-item"
    + (session.pinned ? " pinned" : "")
    + (session.id === currentSessionId ? " active" : "")
    + (completeRead ? " is-complete-read" : "")
    + (taskPreviewHtml ? " has-task-preview" : "")
    + (statusInfo.itemClass ? ` ${statusInfo.itemClass}` : "")
    + (touchStatusInfo?.itemClass && touchStatusInfo.itemClass !== statusInfo.itemClass ? ` ${touchStatusInfo.itemClass}` : "")
    + extraClassName;

  const displayName = getSessionDisplayName(session);
  const displayTitle = getPreferredSessionDisplayName(session) || displayName;
  const titlePrefixHtml = typeof options.titlePrefixHtml === "string"
    ? options.titlePrefixHtml
    : "";
  const metaHtml = typeof options.metaOverrideHtml === "string"
    ? options.metaOverrideHtml
    : buildSessionMetaParts(session, { touchStatusInfo }).join(" · ");
  const actionConfigs = options.hideActions === true ? [] : buildSessionActionConfigs(session, options);
  const leadingAction = actionConfigs.find((entry) => (
    entry?.action === "complete_pending"
    || entry?.action === "restore_pending"
    || entry?.action === "archive"
    || entry?.key === "complete_pending"
    || entry?.key === "restore_pending"
    || entry?.key === "archive"
  )) || null;
  const trailingActionConfigs = leadingAction
    ? actionConfigs.filter((entry) => entry !== leadingAction)
    : actionConfigs;
  const leadingActionHtml = leadingAction
    ? renderSessionActionButtonHtml(session, leadingAction, { leading: true })
    : "";
  const actionsHtml = trailingActionConfigs
    .map((entry) => renderSessionActionButtonHtml(session, entry))
    .join("");
  const compactActions = options.compactActions === true && trailingActionConfigs.length > 0;
  const compactActionsLabel = esc(
    typeof options.compactActionsLabel === "string" && options.compactActionsLabel.trim()
      ? options.compactActionsLabel
      : t("action.more"),
  );
  const hasAnyActions = Boolean(leadingAction) || trailingActionConfigs.length > 0;
  if (compactActions) {
    div.classList.add("has-actions-toggle");
  }

  div.innerHTML = `
    ${leadingActionHtml}
    <div class="session-item-info">
      <div class="session-item-name" title="${esc(displayTitle)}">${titlePrefixHtml}${session.pinned ? `<span class="session-pin-badge" title="${esc(t("sidebar.pinned"))}">${renderSessionIcon("pinned")}</span>` : ""}<span class="session-item-name-text">${esc(displayName)}</span></div>
      ${taskPreviewHtml}
      ${metaHtml ? `<div class="session-item-meta">${metaHtml}</div>` : ""}
    </div>
    ${compactActions ? `<button class="session-item-actions-toggle" type="button" title="${compactActionsLabel}" aria-label="${compactActionsLabel}" aria-expanded="false">${renderSessionIcon("menu")}</button>` : ""}
    ${trailingActionConfigs.length === 0 ? "" : `<div class="session-item-actions">${actionsHtml}</div>`}`;

  div.addEventListener("click", (e) => {
    if (e.target.closest(".session-action-btn") || e.target.closest(".session-item-actions-toggle")) {
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

  if (hasAnyActions) {
    const compactActionsToggleBtn = div.querySelector(".session-item-actions-toggle");
    if (compactActionsToggleBtn) {
      compactActionsToggleBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = !div.classList.contains("is-actions-open");
        if (nextOpen) {
          const siblingItems = div.parentElement?.querySelectorAll?.(".session-item.is-actions-open") || [];
          siblingItems.forEach((item) => {
            if (item === div) return;
            item.classList.remove("is-actions-open");
            item.querySelector(".session-item-actions-toggle")?.setAttribute("aria-expanded", "false");
          });
        }
        div.classList.toggle("is-actions-open", nextOpen);
        compactActionsToggleBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      });
    }
    actionConfigs.forEach((entry) => {
      const selector = `.session-action-btn[data-action="${entry.key || entry.action || ""}"]`;
      const actionBtn = div.querySelector(selector);
      if (!actionBtn) return;
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (compactActions) {
          div.classList.remove("is-actions-open");
          div.querySelector(".session-item-actions-toggle")?.setAttribute("aria-expanded", "false");
        }
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
