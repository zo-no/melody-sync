(function taskTrackerUiModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function formatMemoryCandidateMeta(candidate = {}) {
    const type = trimText(candidate?.type || "").toLowerCase();
    const target = trimText(candidate?.target || "");
    const confidence = Number(candidate?.confidence);
    const typeLabel = (
      type === "profile" ? "习惯"
        : type === "skill" ? "技能"
          : type === "corpus" ? "语料"
            : type === "project" ? "项目"
              : type === "episode" ? "过程"
                : trimText(candidate?.type || "")
    );
    const confidenceLabel = Number.isFinite(confidence)
      ? `置信 ${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
      : "";
    return [typeLabel, target, confidenceLabel].filter(Boolean).join(" · ");
  }

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
    trackerMemoryCandidateRowEl = null,
    trackerMemoryCandidateListEl = null,
    trackerCandidateBranchesRowEl = null,
    trackerCandidateBranchesListEl = null,
    getPersistentActionsEl = () => null,
    getHandoffActionsEl = () => null,
    getCurrentSessionSafe = () => null,
    getPendingMemoryCandidates = () => [],
    reviewMemoryCandidate = async () => null,
    isSuppressed = () => false,
    enterBranchFromCurrentSession = async () => null,
    clipText = (value) => String(value || "").trim(),
    toConciseGoal = (value) => String(value || "").trim(),
    isMobileQuestTracker = () => false,
    isRedundantTrackerText = () => false,
    getCurrentTaskSummary = () => "",
    getBranchDisplayName = (session) => String(session?.name || "").trim(),
    listTaskHandoffTargets = () => [],
    buildTaskHandoffPreview = null,
    handoffSessionTaskData = async () => null,
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
        // For persistent tasks that have run at least once, show a green "run done" status
        // instead of hiding the status box entirely. This is distinct from "completed" (workflowState: done).
        const persistent = state.session?.persistent;
        const persistentKind = trimText(persistent?.kind || "").toLowerCase();
        if (persistentKind && persistentKind !== "skill") {
          const lastRunAt = persistent?.execution?.lastTriggerAt
            || persistent?.recurring?.lastRunAt
            || persistent?.scheduled?.lastRunAt
            || "";
          const runState = trimText(state.session?.activity?.run?.state || "").toLowerCase();
          const isRunning = runState === "running";
          const workflowState = trimText(state.session?.workflowState || "").toLowerCase();
          const isDone = ["done", "complete", "completed", "finished"].includes(workflowState);
          if (lastRunAt && !isRunning && !isDone) {
            return {
              key: "run-done",
              label: "本次完成",
              dotClassName: "status-run-done",
              summary: "本轮执行已完成，等待下次触发。",
            };
          }
        }
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
      trackerStatusEl.classList.toggle("has-status-run-done", visualStatus.key === "run-done");
    }

    function getPrimaryTitle(state) {
      if (!state?.hasSession) return "当前任务";
      const baseTitle = state.isBranch
        ? (state.currentGoal || getBranchDisplayName(state.session) || state.mainGoal || state.session?.name)
        : (state.currentGoal || state.mainGoal || state.session?.name);
      return toConciseGoal(baseTitle, isMobileQuestTracker() ? 72 : 160) || "当前任务";
    }

    function getPrimaryDetail(state) {
      // Summary text is visible in the task map and conversation — no need to repeat here
      return "";
    }

    function getSecondaryDetail(state, primaryDetail = "") {
      return "";
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

    function getLongTermTrackerState(session) {
      const longTerm = session?.sessionState?.longTerm;
      if (!longTerm || typeof longTerm !== "object" || Array.isArray(longTerm)) return null;
      const suggestion = longTerm?.suggestion && typeof longTerm.suggestion === "object" && !Array.isArray(longTerm.suggestion)
        ? longTerm.suggestion
        : null;
      return {
        lane: trimText(longTerm?.lane || "").toLowerCase() === "long-term" ? "long-term" : "sessions",
        role: trimText(longTerm?.role || "").toLowerCase(),
        rootSessionId: trimText(longTerm?.rootSessionId || ""),
        suggestionRootSessionId: trimText(suggestion?.rootSessionId || ""),
      };
    }

    function getPersistentActionButtons(session, {
      onPromote = null,
      onRun = null,
      onToggle = null,
      onConfigure = null,
      onAttachToLongTerm = null,
      onDismissLongTermSuggestion = null,
      onOpenProjectPicker = null,
      onMoveBucket = null,
      onRemoveFromProject = null,
    } = {}) {
      const kind = trimText(session?.persistent?.kind || "").toLowerCase();
      const longTermState = getLongTermTrackerState(session);
      const ltMembership = session?.taskPoolMembership?.longTerm || null;
      const currentBucket = trimText(ltMembership?.bucket || "inbox").toLowerCase();
      const BUCKET_LABELS = { long_term: "长期任务", short_term: "短期任务", waiting: "等待任务", inbox: "收集箱", skill: "快捷按钮" };
      if (!session?.id || session?.archived === true) {
        return [];
      }
      if (!kind && longTermState?.suggestionRootSessionId) {
        return [
          createPersistentActionButton("归入长期项目", () => onAttachToLongTerm?.(longTermState.suggestionRootSessionId)),
          createPersistentActionButton("稍后", () => onDismissLongTermSuggestion?.(longTermState.suggestionRootSessionId), { secondary: true }),
        ];
      }
      if (!kind && longTermState?.lane === "long-term" && longTermState?.role === "member") {
        // In project but no execution type — show project management actions
        const moveBucketBtn = createPersistentActionButton("转移分类", async () => {
          const choices = Object.entries(BUCKET_LABELS)
            .filter(([key]) => key !== currentBucket)
            .map(([key, label]) => ({ label, value: key }));
          const target = typeof showChoice === "function"
            ? await showChoice("选择目标分类", { title: "转移分类", cancelLabel: "取消", choices })
            : null;
          if (target) onMoveBucket?.(target);
        }, { secondary: true });
        return [
          createPersistentActionButton("设置执行方式", onConfigure),
          moveBucketBtn,
          createPersistentActionButton("移出项目", onRemoveFromProject, { secondary: true }),
        ];
      }
      if (!kind) {
        return [
          createPersistentActionButton("归入项目", onOpenProjectPicker),
          createPersistentActionButton("设置执行方式", onConfigure, { secondary: true }),
        ];
      }
      if (isMobileQuestTracker()) {
        return [
          createPersistentActionButton("长期项目设置", onConfigure),
        ];
      }
      if (kind === "skill") {
        return [
          createPersistentActionButton("触发AI快捷按钮", onRun),
          createPersistentActionButton("设置", onConfigure, { secondary: true }),
        ];
      }
      // For recurring_task, scheduled_task, waiting_task: unified three-trigger layout
      const isPaused = String(session?.persistent?.state || "").trim().toLowerCase() === "paused";
      const hasScheduled = Boolean(session?.persistent?.scheduled?.runAt || session?.persistent?.scheduled?.nextRunAt);
      const hasRecurring = Boolean(session?.persistent?.recurring?.cadence);
      const scheduledEnabled = hasScheduled && !isPaused;
      const recurringEnabled = hasRecurring && !isPaused;
      return [
        createPersistentActionButton("一键触发", onRun),
        createPersistentActionButton(
          scheduledEnabled ? "暂停定时" : "定时触发",
          onToggle,
          { secondary: true, active: scheduledEnabled },
        ),
        createPersistentActionButton(
          recurringEnabled ? "暂停循环" : "循环触发",
          onToggle,
          { secondary: true, active: recurringEnabled },
        ),
        createPersistentActionButton("设置", onConfigure, { secondary: true }),
      ];
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

    function renderMemoryCandidateActions(container, memoryCandidates, session = null) {
      if (!container) return;
      container.innerHTML = "";
      const sourceSession = session?.id ? session : getCurrentSessionSafe();
      if (!sourceSession?.id) return;
      for (const candidate of Array.isArray(memoryCandidates) ? memoryCandidates : []) {
        const candidateId = trimText(candidate?.id || "");
        const candidateText = trimText(candidate?.text || "");
        if (!candidateId || !candidateText) continue;

        const row = documentRef.createElement("div");
        row.className = "quest-memory-candidate-item";

        const main = documentRef.createElement("div");
        main.className = "quest-memory-candidate-main";

        const text = documentRef.createElement("div");
        text.className = "quest-memory-candidate-text";
        text.textContent = candidateText;
        main.appendChild(text);

        const metaText = formatMemoryCandidateMeta(candidate);
        if (metaText) {
          const meta = documentRef.createElement("div");
          meta.className = "quest-memory-candidate-meta";
          meta.textContent = metaText;
          main.appendChild(meta);
        }

        row.appendChild(main);

        const actions = documentRef.createElement("div");
        actions.className = "quest-memory-candidate-actions";

        const approveBtn = documentRef.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "quest-branch-btn quest-branch-btn-primary";
        approveBtn.textContent = "采纳";

        const rejectBtn = documentRef.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "quest-branch-btn quest-branch-btn-secondary";
        rejectBtn.textContent = "忽略";

        async function applyDecision(status) {
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
          try {
            await reviewMemoryCandidate(candidate, status, sourceSession);
          } finally {
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
          }
        }

        approveBtn.addEventListener("click", async () => {
          await applyDecision("approved");
        });
        rejectBtn.addEventListener("click", async () => {
          await applyDecision("rejected");
        });

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        row.appendChild(actions);
        container.appendChild(row);
      }
    }

    function renderDetail(taskCard, expanded, session = null, context = {}) {
      if (!trackerDetailEl) return;
      const primaryDetail = trimText(context?.primaryDetail || "");
      const resumePoint = trimText(
        String(taskCard?.checkpoint || "").trim()
        || (Array.isArray(taskCard?.nextSteps) ? String(taskCard.nextSteps.find((entry) => trimText(entry)) || "").trim() : "")
        || String(taskCard?.goal || "").trim(),
      );
      const showResumePoint = Boolean(resumePoint)
        && !isRedundantTrackerText(resumePoint, taskCard?.goal, taskCard?.mainGoal);
      const showDistinctResumePoint = showResumePoint
        && !isRedundantTrackerText(resumePoint, primaryDetail);
      if (trackerGoalValEl) trackerGoalValEl.textContent = showDistinctResumePoint ? resumePoint : "";
      if (trackerGoalRowEl) trackerGoalRowEl.hidden = !showDistinctResumePoint;

      const conclusions = Array.isArray(taskCard?.knownConclusions)
        ? taskCard.knownConclusions.filter((entry) => typeof entry === "string" && trimText(entry))
        : [];
      renderDetailItems(trackerConclusionsListEl, conclusions);
      if (trackerConclusionsRowEl) trackerConclusionsRowEl.hidden = conclusions.length === 0;

      renderDetailItems(trackerMemoryListEl, []);
      if (trackerMemoryRowEl) trackerMemoryRowEl.hidden = true;

      renderMemoryCandidateActions(trackerMemoryCandidateListEl, [], session);
      if (trackerMemoryCandidateRowEl) trackerMemoryCandidateRowEl.hidden = true;

      renderCandidateBranchActions(trackerCandidateBranchesListEl, [], session);
      if (trackerCandidateBranchesRowEl) trackerCandidateBranchesRowEl.hidden = true;

      // Detail section (conclusions, checkpoint) is not shown in the tracker bar.
      // Users read this information in the conversation itself.
      if (trackerDetailToggleBtn) trackerDetailToggleBtn.hidden = true;
      if (trackerDetailEl) trackerDetailEl.hidden = true;
    }

    function createPersistentActionButton(label, onClick, { secondary = false, active = false } = {}) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = `quest-tracker-btn${secondary ? " quest-tracker-btn-secondary" : ""}${active ? " is-active" : ""}`;
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      });
      return button;
    }

    function createHandoffTargetOptionLabel(target = {}) {
      const title = trimText(target?.title || "") || "未命名任务";
      const detail = trimText(target?.displayPath || target?.path || "");
      if (!detail || detail === title) return title;
      return `${title} · ${detail}`;
    }

    function renderHandoffActions(session = null, {
      targets = [],
      buildPreview = null,
      onHandoff = null,
    } = {}) {
      const host = getHandoffActionsEl?.();
      if (!host) return;
      host.innerHTML = "";
      const sourceSessionId = trimText(session?.id || "");
      const validTargets = Array.isArray(targets)
        ? targets.filter((entry) => trimText(entry?.sessionId || ""))
        : [];
      if (!sourceSessionId || session?.archived === true || validTargets.length === 0 || typeof onHandoff !== "function") {
        host.hidden = true;
        return;
      }

      host.hidden = false;
      const row = documentRef.createElement("div");
      row.className = "quest-tracker-handoff-row";

      // Add a blank first option so the select starts in "unselected" state
      const blankOption = documentRef.createElement("option");
      blankOption.value = "";
      blankOption.textContent = "传递到…";
      blankOption.disabled = true;
      blankOption.selected = true;

      const select = documentRef.createElement("select");
      select.className = "quest-tracker-handoff-select";
      select.setAttribute("aria-label", "选择传递目标");
      select.appendChild(blankOption);
      for (const target of validTargets) {
        const option = documentRef.createElement("option");
        option.value = trimText(target?.sessionId || "");
        option.textContent = createHandoffTargetOptionLabel(target);
        select.appendChild(option);
      }
      row.appendChild(select);

      let handoffBusy = false;

      select.addEventListener("change", async () => {
        const targetSessionId = trimText(select.value || "");
        if (!targetSessionId || handoffBusy) return;
        handoffBusy = true;
        select.disabled = true;
        const originalText = blankOption.textContent;
        blankOption.textContent = "传递中…";
        select.value = "";
        try {
          await onHandoff(targetSessionId, { detailLevel: "balanced" });
        } finally {
          handoffBusy = false;
          select.disabled = false;
          blankOption.textContent = originalText;
        }
      });

      host.appendChild(row);
    }

    function renderPersistentActions(session, {
      onPromote = null,
      onRun = null,
      onToggle = null,
      onConfigure = null,
      onAttachToLongTerm = null,
      onDismissLongTermSuggestion = null,
      onOpenProjectPicker = null,
      onMoveBucket = null,
      onRemoveFromProject = null,
    } = {}) {
      const host = getPersistentActionsEl();
      if (!host) return;
      host.innerHTML = "";
      const buttons = getPersistentActionButtons(session, {
        onPromote,
        onRun,
        onToggle,
        onConfigure,
        onAttachToLongTerm,
        onDismissLongTermSuggestion,
        onOpenProjectPicker,
        onMoveBucket,
        onRemoveFromProject,
      });
      for (const button of buttons) {
        host.appendChild(button);
      }
      host.hidden = buttons.length === 0;
    }

    return {
      getPrimaryDetail,
      getPrimaryTitle,
      getSecondaryDetail,
      renderDetail,
      renderHandoffActions,
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
