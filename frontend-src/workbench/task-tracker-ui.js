(function taskTrackerUiModule() {
  function createFallbackTrackerRenderer({
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
    trackerCandidateBranchesRowEl = null,
    trackerCandidateBranchesListEl = null,
    getPersistentActionsEl = () => null,
    getCurrentSessionSafe = () => null,
    isSuppressed = () => false,
    enterBranchFromCurrentSession = async () => null,
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
        return { key: "", label: "", dotClassName: "", summary: "" };
      }
      if (state?.taskMapVisualStatus?.label) {
        return {
          key: String(state.taskMapVisualStatus.key || "").trim(),
          label: String(state.taskMapVisualStatus.label || "").trim(),
          dotClassName: String(state.taskMapVisualStatus.dotClassName || "").trim(),
          summary: String(state.taskMapVisualStatus.summary || "").trim(),
        };
      }
      const taskRunStatus = getTaskRunStatusApi()?.getTaskRunStatusPresentation?.({
        status: state?.branchStatus || "",
        workflowState: state?.session?.workflowState || "",
        activityState: state?.session?.activity?.run?.state || "",
        isCurrent: true,
        showIdle: true,
      }) || getTaskRunStatusApi()?.getTaskRunStatusUi?.({
        status: state?.branchStatus || "",
        workflowState: state?.session?.workflowState || "",
        activityState: state?.session?.activity?.run?.state || "",
        isCurrent: true,
        showIdle: true,
      }) || { key: "", label: "", summary: "", dotClassName: "" };
      const label = String(taskRunStatus?.label || "").trim();
      if (!label) {
        return { key: "", label: "", dotClassName: "", summary: "" };
      }
      return {
        key: String(taskRunStatus?.key || "").trim(),
        label,
        dotClassName: String(taskRunStatus?.dotClassName || "").trim(),
        summary: String(taskRunStatus?.summary || "").trim(),
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
      trackerStatusDotEl.className = `quest-tracker-status-dot${visualStatus.dotClassName ? ` ${visualStatus.dotClassName}` : ""}`;
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
      if (!isRedundantTrackerText(currentGoal, state.session?.name, state.mainGoal)) {
        return currentGoal;
      }
      return clipText(
        String(getTrackerVisualStatus(state)?.summary || ""),
        isMobileQuestTracker() ? 84 : 112,
      );
    }

    function getSecondaryDetail(state, primaryDetail = "") {
      if (!state?.hasSession) return "";
      if (!state.isBranch) {
        const candidateCount = Number(state?.candidateBranchCount || 0);
        return candidateCount > 0 ? `${candidateCount} 个建议` : "";
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

    function listVisibleCandidateBranches(taskCard, session = null) {
      const sourceSession = session?.id ? session : getCurrentSessionSafe();
      const sessionId = String(sourceSession?.id || "").trim();
      return Array.isArray(taskCard?.candidateBranches)
        ? taskCard.candidateBranches
          .filter((entry) => typeof entry === "string" && entry.trim())
          .filter((entry) => !sessionId || !isSuppressed(sessionId, entry))
        : [];
    }

    function renderCandidateBranchActions(container, candidateBranches, session = null) {
      if (!container) return;
      container.innerHTML = "";
      const sourceSession = session?.id ? session : getCurrentSessionSafe();
      if (!sourceSession?.id) return;
      for (const branchTitle of candidateBranches) {
        const row = documentRef.createElement("div");
        row.className = "quest-branch-suggestion-item";

        const main = documentRef.createElement("div");
        main.className = "quest-branch-suggestion-main";

        const title = documentRef.createElement("div");
        title.className = "quest-branch-suggestion-title";
        title.textContent = branchTitle;
        main.appendChild(title);

        const actions = documentRef.createElement("div");
        actions.className = "quest-branch-suggestion-actions";

        const enterBtn = documentRef.createElement("button");
        enterBtn.type = "button";
        enterBtn.className = "quest-branch-btn quest-branch-btn-primary";
        enterBtn.textContent = "开启";
        enterBtn.addEventListener("click", async () => {
          enterBtn.disabled = true;
          try {
            await enterBranchFromCurrentSession(branchTitle, {
              checkpointSummary: branchTitle,
            });
          } finally {
            enterBtn.disabled = false;
          }
        });

        actions.appendChild(enterBtn);
        row.appendChild(main);
        row.appendChild(actions);
        container.appendChild(row);
      }
    }

    function renderDetail(taskCard, expanded, session = null) {
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

      const candidateBranches = listVisibleCandidateBranches(taskCard, session);
      renderCandidateBranchActions(trackerCandidateBranchesListEl, candidateBranches, session);
      if (trackerCandidateBranchesRowEl) trackerCandidateBranchesRowEl.hidden = candidateBranches.length === 0;

      const hasAny = showGoal || conclusions.length > 0 || memory.length > 0 || candidateBranches.length > 0;
      if (trackerDetailToggleBtn) {
        trackerDetailToggleBtn.hidden = !hasAny;
        trackerDetailToggleBtn.textContent = expanded ? "详情 ▾" : "详情 ▸";
      }
      trackerDetailEl.hidden = !hasAny || !expanded;
    }

    function createPersistentActionButton(label, onClick, { secondary = false } = {}) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = `quest-tracker-btn${secondary ? " quest-tracker-btn-secondary" : ""}`;
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      });
      return button;
    }

    function renderPersistentActions(session, {
      onPromote = null,
      onRun = null,
      onToggle = null,
      onConfigure = null,
    } = {}) {
      const host = getPersistentActionsEl();
      if (!host) return;
      host.innerHTML = "";
      const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
      if (!session?.id) {
        host.hidden = true;
        return;
      }
      if (!kind) {
        if (session?.archived === true) {
          host.hidden = true;
          return;
        }
        host.appendChild(createPersistentActionButton("沉淀为长期项", onPromote));
        host.hidden = false;
        return;
      }
      if (kind === "recurring_task") {
        host.appendChild(createPersistentActionButton("立即执行", onRun));
        host.appendChild(createPersistentActionButton(
          String(session?.persistent?.state || "").trim().toLowerCase() === "paused" ? "恢复周期" : "暂停周期",
          onToggle,
          { secondary: true },
        ));
        host.appendChild(createPersistentActionButton("设置", onConfigure, { secondary: true }));
        host.hidden = false;
        return;
      }
      if (kind === "skill") {
        host.appendChild(createPersistentActionButton("触发AI快捷按钮", onRun));
        host.appendChild(createPersistentActionButton("设置", onConfigure, { secondary: true }));
        host.hidden = false;
        return;
      }
      host.hidden = true;
    }

    return {
      getPrimaryDetail,
      getPrimaryTitle,
      getSecondaryDetail,
      renderDetail,
      renderPersistentActions,
      renderStatus,
    };
  }

  function getWorkbenchReactUi(windowRef = window) {
    return globalThis?.MelodySyncWorkbenchReactUi
      || windowRef?.MelodySyncWorkbenchReactUi
      || windowRef?.window?.MelodySyncWorkbenchReactUi
      || null;
  }

  function canUseReactTrackerRenderer(options = {}) {
    const documentRef = options?.documentRef || globalThis?.document || document;
    return Boolean(
      documentRef
      && typeof documentRef.querySelector === "function"
      && typeof options?.trackerStatusEl?.appendChild === "function",
    );
  }

  function createTrackerRenderer(options = {}) {
    const windowRef = options?.windowRef || globalThis?.window || window;
    const reactFactory = getWorkbenchReactUi(windowRef)?.createTrackerRenderer;
    if (typeof reactFactory === "function" && canUseReactTrackerRenderer(options)) {
      return reactFactory(options);
    }
    return createFallbackTrackerRenderer(options);
  }

  window.MelodySyncTaskTrackerUi = Object.freeze({
    createTrackerRenderer,
  });
})();
