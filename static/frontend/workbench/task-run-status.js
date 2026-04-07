(function workbenchTaskRunStatusModule() {
  function normalizeStatusToken(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getTaskRunStatusUi({
    status = "",
    isCurrent = false,
  } = {}) {
    const normalizedStatus = normalizeStatusToken(status);
    if (["resolved", "merged", "done"].includes(normalizedStatus)) {
      return { label: "运行完成", summary: "当前任务已执行完成。" };
    }
    if (isCurrent) {
      return { label: "运行中", summary: "当前任务正在执行中。" };
    }
    return { label: "", summary: "" };
  }

  window.MelodySyncTaskRunStatus = Object.freeze({
    getTaskRunStatusUi,
  });
})();
