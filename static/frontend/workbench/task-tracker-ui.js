(function taskTrackerUiModule() {
  function createTrackerRenderer({
    documentRef = document,
    trackerStatusEl = null,
    trackerStatusDotEl = null,
    trackerStatusTextEl = null,
    trackerDetailEl = null,
    trackerDetailToggleBtn = null,
    trackerGoalRowEl = null,
    trackerGoalValEl = null,
    trackerConclusionsRowEl = null,
    trackerConclusionsListEl = null,
    trackerMemoryRowEl = null,
    trackerMemoryListEl = null,
    clipText = (value) => String(value || "").trim(),
    toConciseGoal = (value) => String(value || "").trim(),
    isMobileQuestTracker = () => false,
    isRedundantTrackerText = () => false,
    getCurrentTaskSummary = () => "",
    getBranchDisplayName = (session) => String(session?.name || "").trim(),
  } = {}) {
    function getTaskRunStatusApi() {
      return globalThis?.MelodySyncTaskRunStatus
        || globalThis?.window?.MelodySyncTaskRunStatus
        || null;
    }

    function getTrackerVisualStatus(state) {
      if (!state?.hasSession || !state?.session) {
        return { label: "", dotClass: "" };
      }
      const taskRunStatus = getTaskRunStatusApi()?.getTaskRunStatusUi?.({
        status: state?.branchStatus || "",
        isCurrent: true,
      }) || { label: "", summary: "" };
      const label = String(taskRunStatus?.label || "").trim();
      if (!label) {
        return { label: "", dotClass: "" };
      }
      return {
        label,
        dotClass: label === "运行完成" ? "status-completed" : "status-running",
      };
    }

    function renderStatus(state) {
      if (!trackerStatusEl || !trackerStatusDotEl || !trackerStatusTextEl) return;
      if (!state?.hasSession || !state?.session) {
        trackerStatusEl.hidden = true;
        trackerStatusDotEl.className = "quest-tracker-status-dot";
        trackerStatusTextEl.textContent = "";
        return;
      }
      const visualStatus = getTrackerVisualStatus(state);
      trackerStatusEl.hidden = !visualStatus.label;
      trackerStatusTextEl.textContent = visualStatus.label || "";
      trackerStatusDotEl.className = `quest-tracker-status-dot${visualStatus.dotClass ? ` ${visualStatus.dotClass}` : ""}`;
    }

    function getPrimaryTitle(state) {
      if (!state?.hasSession) return "当前任务";
      const baseTitle = state.isBranch
        ? (getBranchDisplayName(state.session) || state.currentGoal || state.session?.name || state.mainGoal)
        : (state.session?.name || state.mainGoal || state.currentGoal);
      return toConciseGoal(baseTitle, isMobileQuestTracker() ? 44 : 64) || "当前任务";
    }

    function getPrimaryDetail(state) {
      if (!state?.hasSession) return "";
      if (state.isBranch) {
        return clipText(`来自主线：${state.branchFrom || state.mainGoal || "当前主线"}`, isMobileQuestTracker() ? 84 : 112);
      }
      const summary = clipText(getCurrentTaskSummary(state), isMobileQuestTracker() ? 80 : 112);
      if (summary) return summary;
      const currentGoal = clipText(state.currentGoal || "", isMobileQuestTracker() ? 80 : 112);
      return isRedundantTrackerText(currentGoal, state.session?.name, state.mainGoal) ? "" : currentGoal;
    }

    function getSecondaryDetail(state, primaryDetail = "") {
      if (!state?.hasSession) return "";
      if (!state.isBranch) {
        const candidateCount = Number(state?.candidateBranchCount || 0);
        return candidateCount > 0 ? `发现 ${candidateCount} 条建议支线` : "";
      }
      const nextStep = clipText(state.nextStep || "", isMobileQuestTracker() ? 72 : 96);
      if (!nextStep) return "";
      return isRedundantTrackerText(nextStep, state.currentGoal, primaryDetail) ? "" : nextStep;
    }

    function renderDetailItems(container, items) {
      if (!container) return;
      container.innerHTML = "";
      for (const entry of items) {
        const item = documentRef.createElement("div");
        item.className = "quest-tracker-detail-item";
        item.textContent = entry;
        container.appendChild(item);
      }
    }

    function renderDetail(taskCard, expanded) {
      if (!trackerDetailEl) return;
      const goal = taskCard?.goal || "";
      const showGoal = Boolean(goal);
      if (trackerGoalValEl) trackerGoalValEl.textContent = goal;
      if (trackerGoalRowEl) trackerGoalRowEl.hidden = !showGoal;

      const conclusions = Array.isArray(taskCard?.knownConclusions) ? taskCard.knownConclusions : [];
      renderDetailItems(trackerConclusionsListEl, conclusions);
      if (trackerConclusionsRowEl) trackerConclusionsRowEl.hidden = conclusions.length === 0;

      const memory = Array.isArray(taskCard?.memory) ? taskCard.memory : [];
      renderDetailItems(trackerMemoryListEl, memory);
      if (trackerMemoryRowEl) trackerMemoryRowEl.hidden = memory.length === 0;

      const hasAny = showGoal || conclusions.length > 0 || memory.length > 0;
      if (trackerDetailToggleBtn) {
        trackerDetailToggleBtn.hidden = !hasAny;
        trackerDetailToggleBtn.textContent = expanded ? "详情 ▾" : "详情 ▸";
      }
      trackerDetailEl.hidden = !hasAny || !expanded;
    }

    return {
      getPrimaryDetail,
      getPrimaryTitle,
      getSecondaryDetail,
      renderDetail,
      renderStatus,
    };
  }

  window.MelodySyncTaskTrackerUi = Object.freeze({
    createTrackerRenderer,
  });
})();
