(function sessionListModelModule(root) {
  const TASK_LIST_GROUPS = [
    { id: "inbox", key: "group:inbox", labelKey: "sidebar.group.inbox", aliases: ["收集箱", "收件箱", "capture", "inbox"] },
    { id: "long_term", key: "group:long-term", labelKey: "sidebar.group.longTerm", aliases: ["长期任务", "long-term", "long term"] },
    { id: "short_term", key: "group:short-term", labelKey: "sidebar.group.shortTerm", aliases: ["短期任务", "short-term", "short term"] },
    { id: "knowledge_base", key: "group:knowledge-base", labelKey: "sidebar.group.knowledgeBase", aliases: ["知识库内容", "knowledge-base", "knowledge base"] },
    { id: "waiting", key: "group:waiting", labelKey: "sidebar.group.waiting", aliases: ["等待任务", "waiting"] },
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
      order: TASK_LIST_GROUPS.findIndex((entry) => entry.key === group.key),
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
