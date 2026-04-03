(function sessionListModelModule(root) {
  const sessionListContract = root.MelodySyncSessionListContract || null;
  const TASK_LIST_GROUPS = Array.isArray(sessionListContract?.listTaskListGroups?.())
    ? sessionListContract.listTaskListGroups()
    : [
        { id: "inbox", key: "group:inbox", storageValue: "收集箱", labelKey: "sidebar.group.inbox", aliases: ["收集箱", "收件箱", "capture", "inbox"], order: 0 },
        { id: "long_term", key: "group:long-term", storageValue: "长期任务", labelKey: "sidebar.group.longTerm", aliases: ["长期任务", "long-term", "long term"], order: 1 },
        { id: "short_term", key: "group:short-term", storageValue: "短期任务", labelKey: "sidebar.group.shortTerm", aliases: ["短期任务", "short-term", "short term"], order: 2 },
        { id: "knowledge_base", key: "group:knowledge-base", storageValue: "知识库内容", labelKey: "sidebar.group.knowledgeBase", aliases: ["知识库内容", "knowledge-base", "knowledge base"], order: 3 },
        { id: "waiting", key: "group:waiting", storageValue: "等待任务", labelKey: "sidebar.group.waiting", aliases: ["等待任务", "waiting"], order: 4 },
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

  function resolveTaskListGroup(groupValue = "") {
    if (typeof sessionListContract?.resolveTaskListGroup === "function") {
      return sessionListContract.resolveTaskListGroup(groupValue);
    }
    const normalized = normalizeKey(groupValue);
    return TASK_LIST_GROUPS.find((entry) => entry.aliases.includes(normalized)) || TASK_LIST_GROUPS[0];
  }

  function getSessionGroupInfo(session) {
    const group = resolveTaskListGroup(trimText(session?.group));
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

  function getSessionListBadges(session) {
    if (!isBranchTaskSession(session)) return [];
    return [
      {
        key: "branch",
        label: translate("sidebar.branchTag"),
        className: "session-list-badge session-list-badge-branch",
      },
    ];
  }

  root.MelodySyncSessionListModel = {
    TASK_LIST_GROUPS,
    resolveTaskListGroup,
    getSessionGroupInfo,
    isBranchTaskSession,
    getSessionListBadges,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
