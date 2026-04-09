(function sessionListModelModule(root) {
  const sessionListContract = root.MelodySyncSessionListContract || null;
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

  function isVoiceSession(session) {
    const sourceId = normalizeKey(session?.sourceId || "");
    return sourceId === "voice";
  }

  function resolveTaskListGroup(groupValue = "") {
    if (typeof sessionListContract?.resolveTaskListGroup === "function") {
      return sessionListContract.resolveTaskListGroup(groupValue);
    }
    const normalized = normalizeKey(groupValue);
    return TASK_LIST_GROUPS.find((entry) => entry.aliases.includes(normalized)) || TASK_LIST_GROUPS[0];
  }

  function getSessionGroupInfo(session) {
    const persistentKind = normalizeKey(session?.persistent?.kind || "");
    const effectiveGroupValue = persistentKind === "skill"
      ? "快捷按钮"
      : (persistentKind === "recurring_task" ? "长期任务" : trimText(session?.group));
    const group = resolveTaskListGroup(effectiveGroupValue);
    const label = translate(group.labelKey);
    return {
      key: group.key,
      label,
      title: label,
      order: Number.isInteger(group.order)
        ? group.order
        : TASK_LIST_GROUPS.findIndex((entry) => entry.key === group.key),
    };
  }

  function getSidebarPersistentKind(session) {
    const kind = normalizeKey(session?.persistent?.kind || "");
    return kind === "recurring_task" ? "recurring_task" : (kind === "skill" ? "skill" : "");
  }

  function getPersistentDockGroupKey(session) {
    const persistentKind = getSidebarPersistentKind(session);
    if (persistentKind === "recurring_task") return "group:long-term";
    if (persistentKind === "skill") return "group:quick-actions";
    return "";
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
    return workflowState === "parked";
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
    if (kind === "skill") {
      return {
        key: "persistent-skill",
        label: translate("persistent.kind.skill"),
        className: "session-list-badge session-list-badge-persistent-skill",
      };
    }
    return null;
  }

  function getSessionListBadges(session, entry = null) {
    const badges = [];
    const persistentBadge = getPersistentBadge(session);
    if (persistentBadge) badges.push(persistentBadge);
    if (isVoiceSession(session)) {
      badges.push({
        key: "voice",
        label: "语音",
        className: "session-list-badge session-list-badge-source-voice",
      });
    }
    if ((entry?.branch ?? isBranchTaskSession(session)) === true) {
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
    const branch = isBranchTaskSession(session);
    const branchStatus = branch ? getBranchTaskStatus(session) : "";
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    const persistentKind = getSidebarPersistentKind(session);
    const persistentDockGroupKey = getPersistentDockGroupKey(session);
    const groupInfo = getSessionGroupInfo(session);
    const needsReview = isSidebarCompletionReviewSession(session, options);

    let hiddenReason = "";
    if (!session?.id) {
      hiddenReason = "missing_id";
    } else if (branch && ["parked", "resolved", "merged", "done", "closed"].includes(branchStatus)) {
      hiddenReason = "closed_branch";
    } else if (!archived && workflowState === "parked") {
      hiddenReason = "parked_mainline";
    }

    const entry = {
      visible: hiddenReason === "",
      hiddenReason,
      archived,
      branch,
      branchStatus,
      workflowState,
      persistentKind,
      persistentDockGroupKey,
      groupInfo,
      needsReview,
    };
    return {
      ...entry,
      badges: getSessionListBadges(session, entry),
    };
  }

  root.MelodySyncSessionListModel = {
    TASK_LIST_GROUPS,
    resolveTaskListGroup,
    getSessionGroupInfo,
    getSidebarPersistentKind,
    getPersistentDockGroupKey,
    isBranchTaskSession,
    getBranchTaskStatus,
    isClosedBranchTaskSession,
    shouldShowSessionInSidebar,
    getSessionListBadges,
    getSessionListEntry,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
