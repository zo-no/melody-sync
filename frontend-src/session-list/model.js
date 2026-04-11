(function sessionListModelModule(root) {
  const sessionListContract = root.MelodySyncSessionListContract || null;
  const LEGACY_SESSION_GROUPING_MODE_STORAGE_KEY = "melodysyncSessionGroupingMode";
  const SESSION_GROUPING_TEMPLATE_GROUPS_STORAGE_KEY = "melodysyncSessionGroupingTemplateGroups";
  const SESSION_GROUPING_MODE_USER = "user";
  const BRANCH_TASK_VISIBILITY_STORAGE_KEY = "melodysyncBranchTaskVisibility";
  const BRANCH_TASK_VISIBILITY_SHOW = "show";
  const BRANCH_TASK_VISIBILITY_HIDE = "hide";
  const SESSION_GROUPING_TEMPLATE_GROUP_MAX_ITEMS = 12;
  const SESSION_GROUPING_TEMPLATE_GROUP_MAX_CHARS = 32;
  const TASK_LIST_GROUPS = Array.isArray(sessionListContract?.listTaskListGroups?.())
    ? sessionListContract.listTaskListGroups()
    : [
        { id: "inbox", key: "group:inbox", storageValue: "收集箱", labelKey: "sidebar.group.inbox", aliases: ["收集箱", "收件箱", "capture", "inbox"], order: 0 },
        { id: "long_term", key: "group:long-term", storageValue: "长期任务", labelKey: "sidebar.group.longTerm", aliases: ["长期任务", "long-term", "long term"], order: 99998 },
        { id: "quick_actions", key: "group:quick-actions", storageValue: "快捷按钮", labelKey: "sidebar.group.quickActions", aliases: ["快捷按钮", "快捷动作", "quick-actions", "quick actions"], order: 99999 },
        { id: "short_term", key: "group:short-term", storageValue: "短期任务", labelKey: "sidebar.group.shortTerm", aliases: ["短期任务", "short-term", "short term"], order: 3 },
        { id: "knowledge_base", key: "group:knowledge-base", storageValue: "知识库内容", labelKey: "sidebar.group.knowledgeBase", aliases: ["知识库内容", "knowledge-base", "knowledge base"], order: 4 },
        { id: "waiting", key: "group:waiting", storageValue: "等待任务", labelKey: "sidebar.group.waiting", aliases: ["等待任务", "waiting"], order: 5 },
      ];

  function translate(key, vars) {
    return typeof root?.window?.melodySyncT === "function"
      ? root.window.melodySyncT(key, vars)
      : key;
  }

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeKey(value) {
    return trimText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function clipText(value, maxChars = SESSION_GROUPING_TEMPLATE_GROUP_MAX_CHARS) {
    const normalized = trimText(value).replace(/\s+/g, " ");
    if (!normalized) return "";
    return Array.from(normalized).slice(0, maxChars).join("");
  }

  function getStorage() {
    return root?.localStorage
      || root?.window?.localStorage
      || null;
  }

  function normalizeSessionGroupingMode(value) {
    return SESSION_GROUPING_MODE_USER;
  }

  function getSessionGroupingMode() {
    return SESSION_GROUPING_MODE_USER;
  }

  function setSessionGroupingMode() {
    try {
      getStorage()?.removeItem?.(LEGACY_SESSION_GROUPING_MODE_STORAGE_KEY);
    } catch {}
    return SESSION_GROUPING_MODE_USER;
  }

  function normalizeSessionGroupingTemplateGroups(value) {
    const entries = Array.isArray(value)
      ? value
      : (typeof value === "string" ? value.split(/[\n,，]+/u) : []);
    const seen = new Set();
    const groups = [];
    for (const entry of entries) {
      const normalized = clipText(entry);
      if (!normalized) continue;
      const key = normalizeKey(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      groups.push(normalized);
      if (groups.length >= SESSION_GROUPING_TEMPLATE_GROUP_MAX_ITEMS) break;
    }
    return groups;
  }

  function getSessionGroupingTemplateGroups() {
    try {
      const raw = getStorage()?.getItem?.(SESSION_GROUPING_TEMPLATE_GROUPS_STORAGE_KEY);
      if (!raw) return [];
      return normalizeSessionGroupingTemplateGroups(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  function setSessionGroupingTemplateGroups(groups) {
    const normalized = normalizeSessionGroupingTemplateGroups(groups);
    try {
      if (normalized.length === 0) {
        getStorage()?.removeItem?.(SESSION_GROUPING_TEMPLATE_GROUPS_STORAGE_KEY);
      } else {
        getStorage()?.setItem?.(
          SESSION_GROUPING_TEMPLATE_GROUPS_STORAGE_KEY,
          JSON.stringify(normalized),
        );
      }
    } catch {}
    return normalized.slice();
  }

  function normalizeBranchTaskVisibilityMode(value) {
    return normalizeKey(value) === BRANCH_TASK_VISIBILITY_HIDE
      ? BRANCH_TASK_VISIBILITY_HIDE
      : BRANCH_TASK_VISIBILITY_SHOW;
  }

  function getBranchTaskVisibilityMode() {
    try {
      return normalizeBranchTaskVisibilityMode(getStorage()?.getItem?.(BRANCH_TASK_VISIBILITY_STORAGE_KEY));
    } catch {
      return BRANCH_TASK_VISIBILITY_SHOW;
    }
  }

  function setBranchTaskVisibilityMode(mode) {
    const normalized = normalizeBranchTaskVisibilityMode(mode);
    try {
      getStorage()?.setItem?.(BRANCH_TASK_VISIBILITY_STORAGE_KEY, normalized);
    } catch {}
    return normalized;
  }

  function shouldHideBranchTaskSessions() {
    return getBranchTaskVisibilityMode() === BRANCH_TASK_VISIBILITY_HIDE;
  }

  function getUncategorizedTaskListGroup(order = 99997) {
    const label = trimText(translate("sidebar.group.uncategorized")) || "未分类";
    return {
      id: "uncategorized",
      key: "group:uncategorized",
      storageValue: label,
      label,
      title: label,
      aliases: [normalizeKey(label), "未分类", "uncategorized", "other"],
      order,
    };
  }

  function buildTemplateTaskListGroups(groups = []) {
    const normalized = normalizeSessionGroupingTemplateGroups(groups);
    const templateGroups = normalized.map((label, index) => {
      const key = normalizeKey(label) || `group-${index + 1}`;
      return {
        id: `template:${key}`,
        key: `group:template:${key}`,
        storageValue: label,
        label,
        title: label,
        aliases: [key],
        order: index + 1,
      };
    });
    const fallback = getUncategorizedTaskListGroup(templateGroups.length + 1);
    if (!templateGroups.some((entry) => entry.aliases.includes(normalizeKey(fallback.storageValue)))) {
      templateGroups.push(fallback);
    }
    return templateGroups;
  }

  function resolveTemplateTaskListGroup(groupValue = "", templateGroups = []) {
    const definitions = buildTemplateTaskListGroups(templateGroups);
    const normalized = normalizeKey(groupValue);
    return definitions.find((entry) => entry.aliases.includes(normalized))
      || definitions[definitions.length - 1]
      || getUncategorizedTaskListGroup();
  }

  function getWorkbenchSnapshot() {
    return root?.MelodySyncWorkbench?.getSnapshot?.()
      || root?.window?.MelodySyncWorkbench?.getSnapshot?.()
      || null;
  }

  function normalizeBranchStatus(value) {
    const normalized = normalizeKey(value);
    return ["active", "parked", "resolved", "merged", "done", "closed"].includes(normalized)
      ? normalized
      : "";
  }

  function getSessionStateModel() {
    return root?.MelodySyncSessionStateModel
      || root?.window?.MelodySyncSessionStateModel
      || null;
  }

  function getSessionStalenessInfo(session) {
    const stateModel = getSessionStateModel();
    return typeof stateModel?.getSessionStalenessInfo === "function"
      ? stateModel.getSessionStalenessInfo(session)
      : null;
  }

  function normalizeWorkflowState(value) {
    const stateModel = getSessionStateModel();
    if (typeof stateModel?.normalizeSessionWorkflowState === "function") {
      return stateModel.normalizeSessionWorkflowState(value);
    }
    const normalized = normalizeKey(value).replace(/[\s-]+/g, "_");
    if (["parked", "paused", "pause", "backlog", "todo"].includes(normalized)) return "parked";
    if (["done", "complete", "completed", "finished", "完成", "已完成", "运行完毕", "运行完成"].includes(normalized)) return "done";
    if (["waiting", "waiting_user", "waiting_for_user", "waiting_on_user", "needs_user", "needs_input"].includes(normalized)) return "waiting_user";
    return "";
  }

  function getTaskListVisibility(session) {
    const normalized = normalizeKey(session?.taskListVisibility || "");
    if (normalized === "secondary") return "secondary";
    if (normalized === "hidden") return "hidden";
    return "primary";
  }

  function isVoiceSession(session) {
    const sourceId = normalizeKey(session?.sourceId || "");
    return sourceId === "voice";
  }

  function resolveTaskListGroup(groupValue = "", options = {}) {
    if (typeof sessionListContract?.resolveTaskListGroup === "function") {
      return sessionListContract.resolveTaskListGroup(groupValue, options);
    }
    const normalized = normalizeKey(groupValue);
    const matched = TASK_LIST_GROUPS.find((entry) => entry.aliases.includes(normalized));
    if (matched) return matched;
    if (options?.allowCustom === true && normalized) {
      return {
        id: `custom:${normalized}`,
        key: `group:custom:${normalized}`,
        storageValue: trimText(groupValue),
        label: trimText(groupValue),
        title: trimText(groupValue),
        aliases: [normalized],
        order: 100,
      };
    }
    return TASK_LIST_GROUPS[0];
  }

  function getSessionGroupInfo(session, options = {}) {
    return getSessionGroupInfoWithOptions(session, options);
  }

  function getSessionGroupInfoWithOptions(session, options = {}) {
    const persistentKind = normalizeKey(session?.persistent?.kind || "");
    const templateGroups = normalizeSessionGroupingTemplateGroups(
      options?.templateGroups || getSessionGroupingTemplateGroups(),
    );
    const explicitGroupValue = trimText(session?.group);
    const fallbackGroupValue = persistentKind === "skill"
      ? "快捷按钮"
      : (persistentKind === "recurring_task"
        ? "长期任务"
        : (persistentKind === "scheduled_task"
          ? "短期任务"
          : (persistentKind === "waiting_task"
            ? "等待任务"
            : "")));
    const effectiveGroupValue = explicitGroupValue || fallbackGroupValue;
    const group = resolveTemplateTaskListGroup(effectiveGroupValue, templateGroups);
    const label = trimText(group?.label)
      || (trimText(group?.labelKey) ? translate(group.labelKey) : "")
      || trimText(group?.storageValue)
      || translate("sidebar.group.uncategorized");
    return {
      key: group.key,
      label,
      title: trimText(group?.title) || label,
      order: Number.isInteger(group.order)
        ? group.order
        : TASK_LIST_GROUPS.findIndex((entry) => entry.key === group.key),
    };
  }

  function getSidebarPersistentKind(session) {
    const kind = normalizeKey(session?.persistent?.kind || "");
    if (kind === "recurring_task") return "recurring_task";
    if (kind === "scheduled_task") return "scheduled_task";
    if (kind === "waiting_task") return "waiting_task";
    return kind === "skill" ? "skill" : "";
  }

  function getLongTermTaskPoolMembership(session) {
    const membership = session?.taskPoolMembership?.longTerm;
    if (!membership || typeof membership !== "object" || Array.isArray(membership)) return null;
    const sessionId = trimText(session?.id);
    const projectSessionId = trimText(membership?.projectSessionId);
    if (!projectSessionId) return null;
    const requestedRole = normalizeKey(membership?.role || "");
    const role = requestedRole === "project"
      ? "project"
      : (projectSessionId === sessionId ? "project" : "member");
    return {
      role,
      projectSessionId,
      fixedNode: membership?.fixedNode === true || role === "project",
      bucket: normalizeKey(membership?.bucket || ""),
    };
  }

  function getKnownSessions() {
    if (Array.isArray(root?.sessions)) return root.sessions;
    if (Array.isArray(root?.window?.sessions)) return root.window.sessions;
    return [];
  }

  function getKnownSessionById(sessionId = "") {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return null;
    return getKnownSessions().find((entry) => trimText(entry?.id) === normalizedSessionId) || null;
  }

  function resolveLongTermProjectRootSessionId(session, visited = new Set()) {
    const sessionId = trimText(session?.id);
    if (!sessionId || visited.has(sessionId)) return "";
    const membership = getLongTermTaskPoolMembership(session);
    if (membership?.projectSessionId) {
      return membership.projectSessionId;
    }
    if (getSidebarPersistentKind(session) === "recurring_task") {
      return sessionId;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(sessionId);
    const candidateIds = [];
    const rootSessionId = trimText(session?.rootSessionId || session?.sourceContext?.rootSessionId);
    const parentSessionId = trimText(
      session?._branchParentSessionId
      || session?.branchParentSessionId
      || session?.sourceContext?.parentSessionId,
    );
    for (const candidateId of [rootSessionId, parentSessionId]) {
      if (!candidateId || candidateId === sessionId || candidateIds.includes(candidateId)) continue;
      candidateIds.push(candidateId);
    }
    for (const candidateId of candidateIds) {
      const candidate = getKnownSessionById(candidateId);
      if (!candidate) continue;
      const resolvedRootSessionId = resolveLongTermProjectRootSessionId(candidate, nextVisited);
      if (resolvedRootSessionId) return resolvedRootSessionId;
    }
    return "";
  }

  function isLongTermProjectSession(session) {
    const membership = getLongTermTaskPoolMembership(session);
    if (membership) {
      // If we have explicit membership, trust it: only project role is a project
      return membership.role === "project" && membership.fixedNode === true;
    }
    // No membership: recurring_task defaults to being a project root
    return getSidebarPersistentKind(session) === "recurring_task";
  }

  function isLongTermLineSession(session) {
    return Boolean(resolveLongTermProjectRootSessionId(session));
  }

  function isBranchTaskSession(session) {
    const lineRole = normalizeKey(session?.taskCard?.lineRole || session?.lineRole || "");
    if (lineRole === "branch") return true;
    return Boolean(
      trimText(session?._branchParentSessionId)
      || trimText(session?.branchParentSessionId)
      || trimText(session?.sourceContext?.parentSessionId)
    );
  }

  function getBranchContextStatus(sessionId = "") {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return "";
    const snapshot = getWorkbenchSnapshot();
    const matches = (Array.isArray(snapshot?.branchContexts) ? snapshot.branchContexts : [])
      .filter((entry) => trimText(entry?.sessionId) === normalizedSessionId);
    if (!matches.length) return "";

    let latestStatus = "";
    let latestStamp = -1;
    for (const entry of matches) {
      const status = normalizeBranchStatus(entry?.status);
      if (!status) continue;
      const stamp = Date.parse(entry?.updatedAt || entry?.createdAt || "");
      if (!Number.isFinite(stamp)) {
        if (!latestStatus) latestStatus = status;
        continue;
      }
      if (stamp >= latestStamp) {
        latestStamp = stamp;
        latestStatus = status;
      }
    }
    return latestStatus;
  }

  function getBranchTaskStatus(session) {
    if (!isBranchTaskSession(session)) return "";
    return normalizeBranchStatus(
      session?._branchStatus
      || session?.branchStatus
      || session?.taskCard?.branchStatus
      || getBranchContextStatus(session?.id)
      || "active"
    );
  }

  function isClosedBranchTaskSession(session) {
    const branchStatus = getBranchTaskStatus(session);
    return isBranchTaskSession(session) && ["parked", "resolved", "merged", "done", "closed"].includes(branchStatus);
  }

  function isHiddenWorkflowStateSession(session, options = {}) {
    if (options?.archived === true || session?.archived === true) return false;
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    return workflowState === "parked" || workflowState === "done";
  }

  function isSidebarCompletionReviewSession(session, options = {}) {
    const stateModel = getSessionStateModel();
    if (!stateModel) return false;
    if (options?.archived === true || session?.archived === true) return false;
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user" || workflowState === "done") return false;
    if (typeof stateModel.isSessionBusy === "function" && stateModel.isSessionBusy(session)) {
      return false;
    }
    return typeof stateModel.getSessionReviewStatusInfo === "function"
      && Boolean(stateModel.getSessionReviewStatusInfo(session));
  }

  function shouldShowSessionInSidebar(session, options = {}) {
    return getSessionListEntry(session, options).visible;
  }

  function getPersistentBadge(session) {
    const kind = getSidebarPersistentKind(session);
    const state = normalizeKey(session?.persistent?.state || "");
    if (kind === "recurring_task") {
      return {
        key: state === "paused" ? "persistent-recurring-paused" : "persistent-recurring",
        label: translate(state === "paused" ? "persistent.kind.recurringPaused" : "persistent.kind.recurringTask"),
        className: "session-list-badge session-list-badge-persistent-recurring",
      };
    }
    if (kind === "scheduled_task") {
      return {
        key: state === "paused" ? "persistent-scheduled-paused" : "persistent-scheduled",
        label: translate(state === "paused" ? "persistent.kind.scheduledPaused" : "persistent.kind.scheduledTask"),
        className: "session-list-badge session-list-badge-persistent-recurring",
      };
    }
    if (kind === "waiting_task") {
      return {
        key: state === "paused" ? "persistent-waiting-paused" : "persistent-waiting",
        label: translate(state === "paused" ? "persistent.kind.waitingPaused" : "persistent.kind.waitingTask"),
        className: "session-list-badge session-list-badge-persistent-recurring",
      };
    }
    if (kind === "skill") {
      return {
        key: "persistent-skill",
        label: translate("persistent.kind.skill"),
        className: "session-list-badge session-list-badge-persistent-skill",
      };
    }
    return null;
  }

  function formatPersistentBadgeTime(value) {
    const text = trimText(value);
    if (!text) return "";
    const ts = new Date(text).getTime();
    if (!Number.isFinite(ts)) return "";
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${mo}-${dy} ${hh}:${mm}`;
  }

  function formatRecurringCadenceBadge(recurring = {}) {
    const cadence = normalizeKey(recurring?.cadence || "");
    const timeOfDay = trimText(recurring?.timeOfDay || "");
    if (cadence === "hourly") return "每小时";
    if (cadence === "weekly") {
      const labels = ["日", "一", "二", "三", "四", "五", "六"];
      const days = Array.isArray(recurring?.weekdays)
        ? recurring.weekdays
          .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
          .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
          .map((entry) => `周${labels[entry]}`)
        : [];
      const dayText = days.length > 0 ? days.join("/") : "每周";
      return timeOfDay ? `${dayText} ${timeOfDay}` : dayText;
    }
    return timeOfDay ? `每天 ${timeOfDay}` : "每天";
  }

  function getPersistentScheduleBadge(session) {
    const persistentKind = getSidebarPersistentKind(session);
    const titleParts = [];
    let label = "";
    if (persistentKind === "recurring_task") {
      const recurring = session?.persistent?.recurring && typeof session.persistent.recurring === "object"
        ? session.persistent.recurring
        : {};
      label = formatRecurringCadenceBadge(recurring);
      const nextRunAt = formatPersistentBadgeTime(recurring?.nextRunAt || "");
      if (nextRunAt) {
        titleParts.push(`下次执行 ${nextRunAt}`);
      }
      const timezone = trimText(recurring?.timezone || "");
      if (timezone) {
        titleParts.push(`时区 ${timezone}`);
      }
    } else if (persistentKind === "scheduled_task") {
      const scheduled = session?.persistent?.scheduled && typeof session.persistent.scheduled === "object"
        ? session.persistent.scheduled
        : {};
      const runAt = formatPersistentBadgeTime(scheduled?.nextRunAt || scheduled?.runAt || "");
      label = runAt ? `定时 ${runAt}` : "定时任务";
      const timezone = trimText(scheduled?.timezone || "");
      if (timezone) {
        titleParts.push(`时区 ${timezone}`);
      }
    }
    if (!label) return null;
    return {
      key: "persistent-schedule",
      label,
      title: titleParts.join(" · "),
      className: "session-list-badge session-list-badge-persistent-schedule",
    };
  }

  function getSessionListBadges(session, entry = null) {
    const badges = [];
    if ((entry?.isSystem ?? normalizeKey(session?.taskListOrigin || "") === "system") === true) {
      badges.push({
        key: "system",
        label: "内置",
        className: "session-list-badge session-list-badge-system",
      });
    }
    const persistentBadge = getPersistentBadge(session);
    if (persistentBadge) badges.push(persistentBadge);
    const persistentScheduleBadge = getPersistentScheduleBadge(session);
    if (persistentScheduleBadge) badges.push(persistentScheduleBadge);
    if (isVoiceSession(session)) {
      badges.push({
        key: "voice",
        label: "语音",
        className: "session-list-badge session-list-badge-source-voice",
      });
    }
    // Skip branch badge for project members — they have explicit project membership,
    // the branch lineage is just how they were originally created
    const hasProjectMembership = Boolean(getLongTermTaskPoolMembership(session)?.projectSessionId);
    if (!hasProjectMembership && (entry?.branch ?? isBranchTaskSession(session)) === true) {
      badges.push({
        key: "branch",
        label: translate("sidebar.branchTag"),
        className: "session-list-badge session-list-badge-branch",
      });
    }
    return badges;
  }

  function getSessionListEntry(session, options = {}) {
    const archived = options?.archived === true || session?.archived === true;
    // All project members are "branch tasks" in the new sense — they belong to a long-term project
    const hasProjectMembership = Boolean(getLongTermTaskPoolMembership(session)?.projectSessionId);
    // Traditional branch detection (fork lineage), but not for project members (they have explicit home)
    const branch = !hasProjectMembership && isBranchTaskSession(session);
    const branchStatus = branch ? getBranchTaskStatus(session) : "";
    const hideBranchTasks = options?.hideBranchTasks === true
      || (options?.hideBranchTasks !== false && shouldHideBranchTaskSessions());
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    const taskListVisibility = getTaskListVisibility(session);
    const persistentKind = getSidebarPersistentKind(session);
    const groupInfo = getSessionGroupInfoWithOptions(session, options);
    const needsReview = isSidebarCompletionReviewSession(session, options);

    let hiddenReason = "";
    if (!session?.id) {
      hiddenReason = "missing_id";
    } else if (branch && ["parked", "resolved", "merged", "done", "closed"].includes(branchStatus)) {
      hiddenReason = "closed_branch";
    } else if (hideBranchTasks && (branch || hasProjectMembership)) {
      // Eye button: hide both traditional branch tasks AND project members (all "branch tasks")
      hiddenReason = "branch_filtered";
    } else if (!archived && taskListVisibility !== "primary" && !branch) {
      hiddenReason = "secondary_task";
    } else if (!archived && workflowState === "done") {
      hiddenReason = "done_mainline";
    } else if (!archived && workflowState === "parked") {
      hiddenReason = "parked_mainline";
    }

    const isSystem = normalizeKey(session?.taskListOrigin || "") === "system";
    const entry = {
      visible: hiddenReason === "",
      hiddenReason,
      archived,
      branch,
      branchStatus,
      workflowState,
      taskListVisibility,
      persistentKind,
      groupInfo,
      needsReview,
      isSystem,
    };
    return {
      ...entry,
      badges: getSessionListBadges(session, entry),
    };
  }

  root.MelodySyncSessionListModel = {
    TASK_LIST_GROUPS,
    normalizeSessionGroupingMode,
    normalizeSessionGroupingTemplateGroups,
    normalizeBranchTaskVisibilityMode,
    getSessionGroupingMode,
    setSessionGroupingMode,
    getSessionGroupingTemplateGroups,
    setSessionGroupingTemplateGroups,
    getBranchTaskVisibilityMode,
    setBranchTaskVisibilityMode,
    shouldHideBranchTaskSessions,
    buildTemplateTaskListGroups,
    resolveTemplateTaskListGroup,
    getUncategorizedTaskListGroup,
    resolveTaskListGroup,
    getSessionGroupInfo,
    getSessionGroupInfoWithOptions,
    getSidebarPersistentKind,
    getLongTermTaskPoolMembership,
    isLongTermProjectSession,
    isLongTermLineSession,
    getSessionStalenessInfo,
    getTaskListVisibility,
    isBranchTaskSession,
    getBranchTaskStatus,
    isClosedBranchTaskSession,
    shouldShowSessionInSidebar,
    getSessionListBadges,
    getSessionListEntry,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
