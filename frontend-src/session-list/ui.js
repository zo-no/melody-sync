// ---- Session list ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

// ---- Sessions tab project binding ----
// The "sessions" tab displays the content of a specific long-term project (the "daily project").
// By default this is the system project. Users can rebind it to any long-term project.
const SESSIONS_TAB_PROJECT_STORAGE_KEY = "melodysyncSessionsTabProjectId";

// The system project ID received from the backend workbench snapshot
let systemProjectId = "";

function getSystemProjectId() {
  return systemProjectId;
}

function setSystemProjectId(id) {
  const normalized = typeof id === "string" ? id.trim() : "";
  if (normalized && normalized !== systemProjectId) {
    systemProjectId = normalized;
  }
}

function getSessionsTabProjectOverride() {
  try {
    return localStorage.getItem(SESSIONS_TAB_PROJECT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setSessionsTabProject(projectId) {
  const normalized = typeof projectId === "string" ? projectId.trim() : "";
  try {
    if (normalized) {
      localStorage.setItem(SESSIONS_TAB_PROJECT_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(SESSIONS_TAB_PROJECT_STORAGE_KEY);
    }
  } catch {}
}

function getSessionsTabProjectId() {
  return getSessionsTabProjectOverride() || systemProjectId;
}

globalThis.getSessionsTabProjectId = getSessionsTabProjectId;
globalThis.setSessionsTabProject = setSessionsTabProject;
globalThis.getSystemProjectId = getSystemProjectId;
globalThis.setSystemProjectId = setSystemProjectId;

// Expose attachSession for use in React bundles (IIFE scope can't access non-global functions)
// This runs after attachSession is defined below, so the reference is valid at call time
globalThis._melodySyncAttachSession = (id, session) => attachSession(id, session);

// Bucket definitions and inference — single source in core/task-type-constants.js
const LONG_TERM_BUCKET_DEFS = (
  globalThis.MelodySyncTaskTypeConstants?.BUCKET_DEFS ||
  [
    { key: "long_term",  label: t("bucket.longTerm"),  order: 0 },
    { key: "short_term", label: t("bucket.shortTerm"), order: 1 },
    { key: "waiting",    label: t("bucket.waiting"),   order: 2 },
    { key: "inbox",      label: t("bucket.inbox"),    order: 3 },
    { key: "skill",      label: t("bucket.skill"),    order: 4 },
  ]
);

// Derived map: bucket key → label. Excludes skill (not a valid move-to target for tasks).
const BUCKET_KEY_TO_LABEL = LONG_TERM_BUCKET_DEFS
  .filter((b) => b.key !== "skill")
  .reduce((acc, b) => { acc[b.key] = b.label; return acc; }, {});

function inferLongTermSessionBucket(session) {
  if (globalThis.MelodySyncTaskTypeConstants?.inferSessionBucket) {
    return globalThis.MelodySyncTaskTypeConstants.inferSessionBucket(session);
  }
  // Fallback (should not be reached if task-type-constants.js is loaded)
  const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
  if (kind === "recurring_task") return "long_term";
  if (kind === "scheduled_task") return "short_term";
  if (kind === "waiting_task") return "waiting";
  if (kind === "skill") return "skill";
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
        // project badge is shown in titlePrefixHtml (before the title), not in meta
        .filter((badge) => badge?.key !== "project")
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
  const _wf = String(session?.workflowState || '').trim().toLowerCase();
  const _isDone = _wf === 'done' || _wf === 'complete' || _wf === 'completed';
  if (archived || _isDone) return false;
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
  // "Completed" = workflowState done/complete (archived field no longer used for this)
  const doneWorkflowState = String(session?.workflowState || '').trim().toLowerCase();
  const isArchivedSession = archived
    || doneWorkflowState === 'done'
    || doneWorkflowState === 'complete'
    || doneWorkflowState === 'completed';
  // Resolve current tab early — used by multiple actions below
  const currentTab = typeof getActiveSidebarTabForList === "function" ? getActiveSidebarTabForList() : "";
  const ltMembership = !isArchivedSession ? session?.taskPoolMembership?.longTerm : null;
  const ltProjectId = ltMembership?.projectSessionId
    ? String(ltMembership.projectSessionId).trim() : "";
  const ltRole = ltMembership?.role
    ? String(ltMembership.role).trim().toLowerCase() : "";
  const isLtMember = Boolean(ltProjectId && ltRole === "member");
  const currentBucket = isLtMember
    ? String(ltMembership?.bucket || "inbox").trim().toLowerCase() : "";
  const baseActions = typeof buildSessionActionConfigs === "function"
    ? buildSessionActionConfigs(session, { archived: isArchivedSession })
    : [];
  // All actions including delete are now shown for both archived and active sessions
  const visibleBaseActions = baseActions;
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

  // ── Assign to long-term project ─────────────────────────────────
  const assignToProjectAction = !isArchivedSession ? {
    key: "assign-to-project",
    label: t("action.assignToProject") || "归入项目",
    className: "assign-to-project",
    // Show inline in Tasks tab for tasks not yet in a project
    inlineHidden: !(currentTab === "sessions" && !isLtMember),
    onClick(event, currentSession) {
      event?.preventDefault?.();
      if (!currentSession?.id) return;
      if (typeof window.openProjectPicker === "function") {
        window.openProjectPicker(currentSession);
      }
    },
  } : null;

  // ── Long-term project member actions ────────────────────────────


  // Merge all bucket-move options into a single entry that opens a choice dialog
  const moveToBucketActions = isLtMember
    ? [{
        key: "move-to-bucket",
        label: t("action.moveToBucket") || "转移分类",
        className: "move-bucket",
        inlineHidden: true,
        async onClick(event, currentSession) {
          event?.preventDefault?.();
          if (!currentSession?.id) return;
          const choices = Object.entries(BUCKET_KEY_TO_LABEL)
            .filter(([key]) => key !== currentBucket)
            .map(([key, label]) => ({ label, value: key }));
          const targetBucket = typeof showChoice === "function"
            ? await showChoice(
                t("action.moveToBucketDesc") || "选择目标分类",
                {
                  title: t("action.moveToBucket") || "转移分类",
                  cancelLabel: t("action.cancel") || "取消",
                  choices,
                }
              )
            : null;
          if (!targetBucket) return;
          void (typeof fetchJsonOrRedirect === "function"
            ? fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSession.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  taskPoolMembership: { longTerm: { ...ltMembership, bucket: targetBucket } },
                }),
              })
            : Promise.reject(new Error("no fetch"))
          ).then(() => {
            if (typeof renderSessionList === "function") renderSessionList();
          }).catch((err) => {
            console.error("[lt] move bucket failed:", err);
            if (typeof showAlert === "function") showAlert(t("action.saveFailed") || "操作失败，请重试。");
          });
        },
      }]
    : [];

  const removeFromProjectAction = isLtMember ? {
    key: "remove-from-project",
    label: t("action.removeFromProject") || "移出项目",
    icon: "unarchive",
    className: "remove-from-project",
    // Show inline in Tasks tab (where users manage tasks); hidden in overflow elsewhere
    inlineHidden: currentTab !== "sessions",
    onClick(event, currentSession) {
      event?.preventDefault?.();
      if (!currentSession?.id) return;
      
      void (typeof fetchJsonOrRedirect === "function"
        ? fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSession.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskPoolMembership: { longTerm: null } }),
          })
        : Promise.reject(new Error("no fetch"))
      ).then(() => {
        if (typeof renderSessionList === "function") renderSessionList();
      }).catch((err) => {
        console.error("[lt] remove from project failed:", err);
        if (typeof showAlert === "function") showAlert(t("action.saveFailed") || "操作失败，请重试。");
      });
    },
  } : null;

  // ── Demote persistent task to regular session ────────────────────
  const persistentKind = getSidebarPersistentKind(session);
  const isPersistentTask = !isArchivedSession
    && (persistentKind === "recurring_task"
      || persistentKind === "scheduled_task"
      || persistentKind === "waiting_task");
  const demoteAction = isPersistentTask ? {
    key: "demote-persistent",
    label: t("action.demote") || "降级为普通任务",
    className: "demote-persistent",
    inlineHidden: true,
    onClick(event, currentSession) {
      event?.preventDefault?.();
      if (!currentSession?.id) return;
      
      void (typeof fetchJsonOrRedirect === "function"
        ? fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSession.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ persistent: null }),
          })
        : Promise.reject(new Error("no fetch"))
      ).then(() => {
        if (typeof renderSessionList === "function") renderSessionList();
      }).catch((err) => {
        console.error("[lt] demote failed:", err);
        if (typeof showAlert === "function") showAlert(t("action.saveFailed") || "操作失败，请重试。");
      });
    },
  } : null;

  // ── Promote to persistent kind ───────────────────────────────────
  const isRegularSession = !isArchivedSession && !persistentKind;
  function makePromoteAction(targetKind, label) {
    return {
      key: `promote-${targetKind}`,
      label,
      className: `promote-${targetKind}`,
      inlineHidden: true,
      async onClick(event, currentSession) {
        event?.preventDefault?.();
        if (!currentSession?.id) return;
        // Confirm before promoting to auto-running types (recurring/scheduled)
        if (targetKind === "recurring_task" || targetKind === "scheduled_task") {
          const confirmed = typeof showConfirm === "function"
            ? await showConfirm(label, { title: t("action.confirm") || "确定", confirmLabel: t("action.confirm") || "确定", cancelLabel: t("action.cancel") || "取消" })
            : true;
          if (!confirmed) return;
        }
        const body = { kind: targetKind };
        // recurring_task and scheduled_task require time fields
        if (targetKind === "recurring_task") {
          body.recurring = { cadence: "daily", timeOfDay: "09:00" };
        } else if (targetKind === "scheduled_task") {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          body.scheduled = { runAt: tomorrow.toISOString() };
        }
        void (typeof fetchJsonOrRedirect === "function"
          ? fetchJsonOrRedirect(
              `/api/sessions/${encodeURIComponent(currentSession.id)}/promote-persistent`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            )
          : Promise.reject(new Error("no fetch"))
        ).then(() => {
          if (typeof renderSessionList === "function") renderSessionList();
          // Open settings for time-based tasks so user can configure schedule
          if (targetKind !== "skill" && targetKind !== "waiting_task") {
            window.MelodySyncWorkbench?.openPersistentEditor?.({ mode: "configure", kind: targetKind });
          }
        }).catch((err) => {
          console.error(`[lt] promote to ${targetKind} failed:`, err);
          if (typeof showAlert === "function") showAlert(t("action.saveFailed") || "操作失败，请重试。");
        });
      },
    };
  }
  // Merge all promote options into a single "升级任务类型" entry that opens a choice dialog
  const promoteActions = isRegularSession ? [
    {
      key: "promote",
      label: t("action.promote") || "升级任务类型",
      className: "promote",
      inlineHidden: true,
      async onClick(event, currentSession) {
        event?.preventDefault?.();
        if (!currentSession?.id) return;
        const chosen = typeof showChoice === "function"
          ? await showChoice(
              t("action.promoteChoiceDesc") || "选择升级后的任务类型",
              {
                title: t("action.promote") || "升级任务类型",
                cancelLabel: t("action.cancel") || "取消",
                choices: [
                  { label: t("action.promoteRecurringShort") || "长期任务", value: "recurring_task" },
                  { label: t("action.promoteScheduledShort") || "短期任务", value: "scheduled_task" },
                  { label: t("action.promoteWaitingShort") || "等待任务",  value: "waiting_task" },
                  { label: t("action.promoteSkill") || "快捷按钮",         value: "skill" },
                ],
              }
            )
          : null;
        if (!chosen) return;
        // Delegate to the individual action handler
        await makePromoteAction(chosen, "").onClick(event, currentSession);
      },
    },
  ] : [];

  const actionList = [
    renameAction,
    ...visibleBaseActions,
  ].filter(Boolean);

  if (!canRunSidebarQuickAction(session, { archived })) {
    return actionList;
  }
  return [
    {
      key: "quick-run",
      label: t("action.triggerSkill") || "触发快捷按钮",
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
  const projectBadge = Array.isArray(entry?.badges)
    ? entry.badges.find((badge) => badge?.key === "project" && badge?.label)
    : null;
  const titlePrefixHtml = [
    isBranch
      ? `<span class="session-title-badge session-title-badge-branch" title="${esc(branchBadge?.label || t("sidebar.branchTag"))}">${esc(branchBadge?.label || t("sidebar.branchTag"))}</span>`
      : "",
    projectBadge
      ? `<span class="session-title-badge session-title-badge-project" title="${esc(projectBadge.title || projectBadge.label)}">${esc(projectBadge.label)}</span>`
      : "",
  ].join("");
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
  const ltRole = String(session?.taskPoolMembership?.longTerm?.role || "").trim().toLowerCase();
  // Explicit project role
  if (ltRole === "project") return true;
  // Fallback: recurring_task that is NOT a member of another project
  if (ltRole !== "member" && getSidebarPersistentKind(session) === "recurring_task") return true;
  return false;
}

function isLongTermLineSessionForList(session) {
  const model = getSessionListModel();
  if (typeof model?.isLongTermLineSession === "function") {
    return model.isLongTermLineSession(session);
  }
  if (isLongTermProjectSessionForList(session)) return true;
  const ltMembership = session?.taskPoolMembership?.longTerm;
  return Boolean(ltMembership?.projectSessionId && ltMembership?.role === "member");
}

function isSkillSessionForList(session) {
  return getSidebarPersistentKind(session) === "skill";
}

function shouldIncludeSessionInSidebarTab(session, tab = getActiveSidebarTabForList()) {
  if (tab === "sessions") {
    // Sessions tab = 今日聚合视图：所有活跃任务，按项目分组
    // 排除：project roots、自动化任务（recurring/scheduled/waiting persistent tasks）
    // Skill 快捷按钮：保留，放入 daily-inbox 的 skill bucket
    if (isLongTermProjectSessionForList(session)) return false;
    // 自动化任务（recurring/scheduled/waiting）是后台执行的，不在日常任务列表显示
    const kind = getSidebarPersistentKind(session);
    if (kind === "recurring_task" || kind === "scheduled_task" || kind === "waiting_task") return false;
    return true;
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
  const showGroupingFolderControls = false;
  // Pinned sessions only shown in the sessions tab, not in the long-term projects tab
  const pinnedSessions = isLongTermTab
    ? []
    : filterSessionsForSidebarTab(
        getVisiblePinnedSessions().filter((session) => shouldShowSessionInSidebarForList(session)),
        activeSidebarTab,
      );
  // Sessions tab is a project bucket view — no isTasksTab flag (eye button doesn't apply here)
  const sessionFilterOptions = {};
  const visibleSessions = filterSessionsForSidebarTab(
    getVisibleActiveSessions().filter((session) => shouldShowSessionInSidebarForList(session, sessionFilterOptions)),
    activeSidebarTab,
  );
  const groups = new Map();
  if (isSessionsTab) {
    // Sessions tab = 按任务类型跨项目聚合视图
    // 眼睛打开：显示所有任务（含已归属长期项目的）
    // 眼睛关闭：只显示未归属任何长期项目的任务
    const branchVisibilityMode = window.MelodySyncSessionListModel?.getBranchTaskVisibilityMode?.()
      || (typeof getBranchTaskVisibilityModeForSidebar === "function" ? getBranchTaskVisibilityModeForSidebar() : "show");
    // 眼睛关闭 = 隐藏已归属"其他长期项目"的任务（日常任务项目的任务始终显示）
    const hideOtherProjectTasks = branchVisibilityMode === "hide";
    const systemProjectId = getSessionsTabProjectId(); // 日常任务项目 ID
    const model = getSessionListModel();

    // Single group with buckets — all tasks aggregated by type
    const groupKey = "group:all-by-type";
    groups.set(groupKey, {
      key: groupKey,
      label: t("sidebar.tasks.allTasks") || "全部任务",
      title: t("sidebar.tasks.allTasks") || "全部任务",
      order: 0,
      type: "daily-inbox",
      projectId: "",
      sessions: [],
      buckets: Object.fromEntries(LONG_TERM_BUCKET_DEFS.map((b) => [b.key, { ...b, sessions: [] }])),
    });
    const groupEntry = groups.get(groupKey);

    // Pinned sessions are shown in a separate pinned section at top — exclude from buckets
    const pinnedIdSet = new Set(pinnedSessions.map((s) => s?.id).filter(Boolean));

    for (const session of visibleSessions) {
      if (!session?.id) continue;
      // Skip pinned — already shown in pinned section above buckets
      if (pinnedIdSet.has(session.id)) continue;
      const membership = typeof model?.getLongTermTaskPoolMembership === "function"
        ? model.getLongTermTaskPoolMembership(session)
        : null;
      const sessionProjectId = membership?.projectSessionId || "";
      // 日常任务项目成员 or 无归属 = 始终显示
      const isDailyMember = !sessionProjectId || sessionProjectId === systemProjectId;
      // 其他项目成员 = 眼睛控制
      const isOtherProjectMember = !isDailyMember && Boolean(sessionProjectId);

      if (hideOtherProjectTasks && isOtherProjectMember) continue;

      groupEntry.sessions.push(session);
      const bucket = inferLongTermSessionBucket(session);
      const bucketKey = groupEntry.buckets[bucket] ? bucket : "inbox";
      groupEntry.buckets[bucketKey].sessions.push(session);
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
        const isSystemProject = String(projectSession?.taskListOrigin || "").trim().toLowerCase() === "system";
        // Skip orphaned groups where the project session can't be found
        if (!projectSession) continue;
        // System project (全局任务) is shown in the tasks tab — skip it in the projects tab
        if (isSystemProject) continue;
        const projectTitle = String(projectSession?.name || projectSession?.description || "").trim() || "未命名项目";
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
  // Archived folder always visible on Tasks/Projects tabs (even when empty)
  const shouldRenderArchivedSection = (isLongTermTab || isSessionsTab)
    ? true
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
        ? (isLongTermTab ? t("sidebar.longTerm.empty") || "还没有长期项目" : (isSessionsTab ? t("sidebar.tasks.empty") || "没有任务" : t("sidebar.noSessions") || "还没有任务"))
        : t("sidebar.loadingSessions") || "加载任务中…",
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
        ...((groupEntry.type === "long-term-project" || groupEntry.type === "sessions-project" || groupEntry.type === "daily-inbox") ? {
          type: groupEntry.type,
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
        ...(groupEntry.type === "today-project" ? {
          type: "today-project",
          projectId: groupEntry.projectId,
          isSystem: groupEntry.isSystem === true,
          projectSession: groupEntry.projectSession || null,
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
        hint: shouldShowSessionListEmptyState && sessionsLoaded
          ? (isSessionsTab
              ? t("sidebar.tasks.emptyHint") || "点击「开始任务」记录第一件事。"
              : isLongTermTab
                ? t("sidebar.longTerm.emptyHint") || "点击右上角「+」新建项目。"
                : "")
          : "",
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
  // Archived folder always visible on Tasks/Projects tabs (even when empty)
  const shouldRenderSection = (isLongTermTab || isSessionsTab)
    ? true
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
    <span class="folder-count">${count}</span>
    <button class="archived-clear-btn" type="button" title="${esc(t("sidebar.clearArchived"))}" data-action="clear-archived">${esc(t("sidebar.clearArchived"))}</button>`;
  header.addEventListener("click", (e) => {
    // Don't toggle if clicking the clear button
    if (e.target.closest("[data-action='clear-archived']")) return;
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
  const clearBtn = header.querySelector("[data-action='clear-archived']");
  // Disable only when we know for certain there's nothing archived
  // archivedSessionCount comes from backend; archivedSessions may be empty before lazy-load
  const hasArchivedItems = archivedSessions.length > 0 || archivedSessionCount > 0 || isArchivedSessionsLoading;
  if (clearBtn && !hasArchivedItems) clearBtn.disabled = true;
  clearBtn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!hasArchivedItems) return;
    const totalCount = archivedSessions.length || archivedSessionCount || 0;
    const msg = t("sidebar.clearArchivedConfirm").replace("{count}", totalCount);
    const confirmed = typeof showConfirm === "function"
      ? await showConfirm(msg, { title: t("sidebar.archive") || "清空归档", danger: true, confirmLabel: t("action.delete") || "全部删除", cancelLabel: t("action.cancel") || "取消" })
      : window.confirm(msg);
    if (!confirmed) return;
    clearBtn.disabled = true;
    clearBtn.textContent = "…";
    void fetchJsonOrRedirect("/api/sessions/archived/bulk", { method: "DELETE" })
      .then((data) => {
        const ids = data?.deletedSessionIds || [];
        if (typeof removeSessionsFromClientState === "function") removeSessionsFromClientState(ids);
        renderSessionList();
      })
      .catch((err) => {
        console.error("[sessions] Failed to clear archived:", err?.message || err);
        clearBtn.disabled = false;
        clearBtn.textContent = t("sidebar.clearArchived") || "清空";
        if (typeof showAlert === "function") showAlert(t("action.deleteFailed") || "清空归档失败");
      });
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
  // Returns true for project root sessions — they open the control panel, not chat.
  // Project roots are identified by taskPoolMembership.longTerm.role === 'project'
  // and fixedNode === true (self-referential: projectSessionId === session.id).
  // NOTE: We no longer rely on persistent.kind because project roots are pure
  // containers with no persistent field (decoupled from task execution).
  const membership = session?.taskPoolMembership?.longTerm;
  if (!membership) return false;
  const role = String(membership.role || "").trim().toLowerCase();
  if (role !== "project") return false;
  // Self-referential: the project root's projectSessionId points to itself
  const sessionId = String(session?.id || "").trim();
  const projectSessionId = String(membership.projectSessionId || "").trim();
  return sessionId === projectSessionId && membership.fixedNode === true;
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
    // Still render the session list so the sidebar shows the correct project tab
    if (typeof renderSessionList === "function") {
      renderSessionList();
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
  // Re-render session list so the active highlight follows the selected session
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
}
