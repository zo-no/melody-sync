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

function isSessionCompleteAndReviewed(session) {
  return typeof window !== "undefined"
    && window.MelodySyncSessionStateModel
    && typeof window.MelodySyncSessionStateModel.isSessionCompleteAndReviewed === "function"
    ? window.MelodySyncSessionStateModel.isSessionCompleteAndReviewed(session)
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
      <button class="session-action-btn ${esc(entry.className || entry.key || "action")}" type="button" title="${esc(entry.label || "")}" aria-label="${esc(entry.label || "")}" data-id="${session.id}" data-action="${esc(entry.key || entry.action || "")}">${renderSessionIcon(entry.icon || "close")}</button>
    `).join("");

  div.innerHTML = `
    <div class="session-item-info">
      <div class="session-item-name" title="${esc(displayTitle)}">${session.pinned ? `<span class="session-pin-badge" title="${esc(t("sidebar.pinned"))}">${renderSessionIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
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
