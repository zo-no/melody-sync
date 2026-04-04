(function sessionListModelModule(root) {
  const sessionListContract = root.MelodySyncSessionListContract || null;
  const TASK_LIST_GROUPS = Array.isArray(sessionListContract?.listTaskListGroups?.())
    ? sessionListContract.listTaskListGroups()
    : [
        { id: "inbox", key: "group:inbox", storageValue: "收集箱", labelKey: "sidebar.group.inbox", aliases: ["收集箱", "收件箱", "capture", "inbox"], order: 0 },
        { id: "long_term", key: "group:long-term", storageValue: "长期任务", labelKey: "sidebar.group.longTerm", aliases: ["长期任务", "long-term", "long term"], order: 1 },
        { id: "quick_actions", key: "group:quick-actions", storageValue: "快捷按钮", labelKey: "sidebar.group.quickActions", aliases: ["快捷按钮", "快捷动作", "quick-actions", "quick actions"], order: 2 },
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

  function isVoiceSession(session) {
    const sourceId = normalizeKey(session?.sourceId || session?.appId || "");
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

  function isBranchTaskSession(session) {
    const lineRole = normalizeKey(session?.taskCard?.lineRole || session?.lineRole || "");
    if (lineRole === "branch") return true;
    return Boolean(
      trimText(session?._branchParentSessionId)
      || trimText(session?.branchParentSessionId)
      || trimText(session?.sourceContext?.parentSessionId)
    );
  }

  function getPersistentBadge(session) {
    const kind = normalizeKey(session?.persistent?.kind || "");
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

  function getSessionListBadges(session) {
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
    if (isBranchTaskSession(session)) {
      badges.push({
        key: "branch",
        label: translate("sidebar.branchTag"),
        className: "session-list-badge session-list-badge-branch",
      });
    }
    return badges;
  }

  root.MelodySyncSessionListModel = {
    TASK_LIST_GROUPS,
    resolveTaskListGroup,
    getSessionGroupInfo,
    isBranchTaskSession,
    getSessionListBadges,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
