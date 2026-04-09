(function workbenchTaskRunStatusModule() {
  function normalizeStatusToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  function normalizeWorkflowState(value) {
    const normalized = normalizeStatusToken(value);
    if (!normalized) return "";
    if (["done", "complete", "completed", "finished", "closed"].includes(normalized)) return "done";
    if (["运行完毕", "已完成", "完成"].includes(normalized)) return "done";
    if (["parked", "paused", "pause", "backlog", "todo"].includes(normalized)) return "parked";
    if (["waiting", "waiting_user", "waiting_for_user", "waiting_on_user", "needs_user", "needs_input", "等待", "待输入", "等待用户", "等待用户输入", "等待中"].includes(normalized)) {
      return "waiting_user";
    }
    return "";
  }

  function normalizeActivityState(value) {
    const normalized = normalizeStatusToken(value);
    if (!normalized) return "";
    if (["running", "运行中", "执行中"].includes(normalized)) return "running";
    if (normalized === "queued") return "queued";
    if (["pending", "处理中", "排队中", "等待执行"].includes(normalized)) return "pending";
    if (normalized === "renaming") return "renaming";
    if (normalized === "重命名中") return "renaming";
    if (["rename_failed", "重命名失败"].includes(normalized)) return "rename_failed";
    return "";
  }

  function resolveBranchLikeStatus(...values) {
    let sawActive = false;
    let sawParked = false;
    let sawResolved = false;
    let sawMerged = false;

    for (const value of values) {
      const normalized = normalizeStatusToken(value);
      if (!normalized) continue;
      if (normalized === "merged") {
        sawMerged = true;
        continue;
      }
      if (["resolved", "done", "closed", "complete", "completed", "finished", "完成", "已完成", "运行完毕"].includes(normalized)) {
        sawResolved = true;
        continue;
      }
      if (["parked", "paused", "pause", "backlog", "todo", "待处理", "挂起"].includes(normalized)) {
        sawParked = true;
        continue;
      }
      if (["active", "running", "current", "main", "waiting", "等待", "等待用户", "等待用户输入"].includes(normalized)) {
        sawActive = true;
      }
    }

    if (sawMerged) return "merged";
    if (sawResolved) return "resolved";
    if (sawParked) return "parked";
    if (sawActive) return "active";
    return "active";
  }

  function getTaskRunStateKey({
    status = "",
    workflowState = "",
    activityState = "",
    activity = null,
    busy = false,
    isCurrent = false,
    showIdle = false,
  } = {}) {
    const normalizedStatus = normalizeStatusToken(status);
    const normalizedWorkflowState = normalizeWorkflowState(workflowState);
    const normalizedActivityState = normalizeActivityState(activityState);
    const normalizedRunState = normalizedActivityState === "running"
      ? "running"
      : normalizeActivityState(activity?.run?.state || "");
    const normalizedQueueState = normalizedActivityState === "queued"
      ? "queued"
      : normalizeStatusToken(activity?.queue?.state || "");
    const normalizedCompactState = normalizedActivityState === "pending"
      ? "pending"
      : normalizeStatusToken(activity?.compact?.state || "");
    const normalizedRenameState = ["renaming", "rename_failed"].includes(normalizedActivityState)
      ? normalizedActivityState
      : normalizeActivityState(activity?.rename?.state || "");
    const isBusy = busy === true
      || normalizedRunState === "running"
      || normalizedQueueState === "queued"
      || normalizedCompactState === "pending";

    if (["resolved", "merged", "done", "closed", "complete", "completed", "finished"].includes(normalizedStatus)) {
      return "completed";
    }
    if (normalizedWorkflowState === "done") return "completed";
    if (normalizedStatus === "parked" || normalizedWorkflowState === "parked") return "parked";
    if (normalizedWorkflowState === "waiting_user" || normalizedStatus === "waiting_user" || normalizedStatus === "waiting") {
      return "waiting_user";
    }
    if (normalizedRunState === "running") return "running";
    if (normalizedQueueState === "queued") return "queued";
    if (normalizedCompactState === "pending") return "pending";
    if (normalizedRenameState === "renaming") return "renaming";
    if (normalizedRenameState === "rename_failed") return "rename_failed";
    if (isBusy) return "running";
    if (showIdle || isCurrent) return "idle";
    return "";
  }

  function getTaskRunStatusUi({
    status = "",
    workflowState = "",
    activityState = "",
    activity = null,
    busy = false,
    isCurrent = false,
    showIdle = false,
  } = {}) {
    switch (getTaskRunStateKey({
      status,
      workflowState,
      activityState,
      activity,
      busy,
      isCurrent,
      showIdle,
    })) {
      case "completed":
        return { key: "completed", label: "已完成", summary: "当前任务已执行完成。" };
      case "parked":
        return { key: "parked", label: "已挂起", summary: "当前任务已暂时挂起。" };
      case "waiting_user":
        return { key: "waiting_user", label: "等待输入", summary: "当前任务正在等待用户输入。" };
      case "running":
        return { key: "running", label: "运行中", summary: "当前任务正在执行中。" };
      case "queued":
        return { key: "queued", label: "排队中", summary: "当前任务正在等待执行。" };
      case "pending":
        return { key: "pending", label: "处理中", summary: "当前任务正在处理中。" };
      case "renaming":
        return { key: "renaming", label: "重命名中", summary: "当前任务正在同步标题。" };
      case "rename_failed":
        return { key: "rename_failed", label: "重命名失败", summary: "当前任务标题同步失败。" };
      case "idle":
        return { key: "idle", label: "", summary: "" };
      default:
        return { key: "", label: "", summary: "" };
    }
  }

  function getTaskRunStatusClassName(key, prefix = "status") {
    const normalizedKey = normalizeStatusToken(key).replace(/_/g, "-");
    if (!normalizedKey) return "";
    return `${String(prefix || "status").trim()}-${normalizedKey}`;
  }

  function getTaskRunStatusResolvedNodeClassName(key, prefix = "is-") {
    const normalizedKey = normalizeStatusToken(key).replace(/_/g, "-");
    if (!normalizedKey) return "";
    if (["completed", "resolved", "merged", "done"].includes(normalizedKey)) {
      return `${String(prefix || "is-").trim()}resolved`;
    }
    if (normalizedKey === "parked") {
      return `${String(prefix || "is-").trim()}parked`;
    }
    return "";
  }

  function getTaskRunStatusPresentation(options = {}) {
    const statusUi = getTaskRunStatusUi(options);
    const key = String(statusUi?.key || "").trim();
    return {
      ...statusUi,
      statusClassName: getTaskRunStatusClassName(key, "status"),
      dotClassName: getTaskRunStatusClassName(key, "status"),
      nodeClassName: getTaskRunStatusClassName(key, "is-status"),
    };
  }

  window.MelodySyncTaskRunStatus = Object.freeze({
    getTaskRunStatusClassName,
    getTaskRunStatusResolvedNodeClassName,
    getTaskRunStatusPresentation,
    getTaskRunStateKey,
    getTaskRunStatusUi,
    resolveBranchLikeStatus,
    normalizeActivityState,
    normalizeStatusToken,
    normalizeWorkflowState,
  });
})();
