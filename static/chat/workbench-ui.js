(function workbenchModule() {
  const tracker = document.getElementById("questTracker");
  const trackerLabelEl = document.getElementById("questTrackerLabel");
  const trackerTitleEl = document.getElementById("questTrackerTitle");
  const trackerBranchEl = document.getElementById("questTrackerBranch");
  const trackerBranchLabelEl = document.getElementById("questTrackerBranchLabel");
  const trackerBranchTitleEl = document.getElementById("questTrackerBranchTitle");
  const trackerNextEl = document.getElementById("questTrackerNext");
  const trackerAltBtn = document.getElementById("questTrackerAltBtn");
  const trackerBackBtn = document.getElementById("questTrackerBackBtn");
  if (!tracker) return;

  const SUPPRESSED_PREFIX = "melodysyncSuppressedBranch";

  let snapshot = {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [],
    skills: [],
    summaries: [],
  };
  let refreshInFlight = null;

  function clipText(value, max = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function normalizeTitle(value) {
    return clipText(value, 96);
  }

  function shouldHideTrackerNext(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return true;
    return [
      /等待用户.*决定/i,
      /保留还是撤回/i,
      /是否保留/i,
      /是否撤回/i,
      /等待.*确认/i,
      /继续当前任务/i,
    ].some((pattern) => pattern.test(text));
  }

  function stripBranchTitleNoise(value) {
    return String(value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#>*_[\\]-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCurrentSessionSafe() {
    if (typeof getCurrentSession === "function") return getCurrentSession();
    return null;
  }

  function getSessionRecords() {
    if (typeof sessions !== "undefined" && Array.isArray(sessions)) {
      return sessions;
    }
    if (Array.isArray(window.sessions)) {
      return window.sessions;
    }
    return [];
  }

  function getSessionRecord(sessionId) {
    if (!sessionId) return null;
    return getSessionRecords().find((entry) => entry.id === sessionId) || null;
  }

  function getTaskCard(session) {
    return session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : null;
  }

  function getTaskCardList(taskCard, key) {
    return Array.isArray(taskCard?.[key])
      ? taskCard[key].filter((entry) => typeof entry === "string" && entry.trim())
      : [];
  }

  function getClusterForSession(sessionId) {
    if (!sessionId) return null;
    const clusters = Array.isArray(snapshot.taskClusters) ? snapshot.taskClusters : [];
    return clusters.find((cluster) => (
      cluster?.mainSessionId === sessionId
      || cluster?.currentBranchSessionId === sessionId
      || (Array.isArray(cluster?.branchSessionIds) && cluster.branchSessionIds.includes(sessionId))
    )) || null;
  }

  function getActiveSessionContext(sessionId) {
    return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).find((entry) => (
      entry?.sessionId === sessionId
      && String(entry?.status || "active").toLowerCase() === "active"
    )) || null;
  }

  function getLatestSessionContext(sessionId) {
    const matches = (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).filter((entry) => (
      entry?.sessionId === sessionId
    ));
    if (!matches.length) return null;
    return [...matches].sort((a, b) => {
      const left = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
      const right = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
      return right - left;
    })[0] || null;
  }

  function getSuppressedStorageKey(sessionId, branchTitle) {
    return `${SUPPRESSED_PREFIX}:${sessionId}:${String(branchTitle || "").trim().toLowerCase()}`;
  }

  function isSuppressed(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return false;
    const session = getSessionRecord(sessionId) || getCurrentSessionSafe();
    const persisted = Array.isArray(session?.suppressedBranchTitles)
      ? session.suppressedBranchTitles.some((entry) => String(entry || "").trim().toLowerCase() === String(branchTitle || "").trim().toLowerCase())
      : false;
    return persisted || localStorage.getItem(getSuppressedStorageKey(sessionId, branchTitle)) === "1";
  }

  function suppressCandidate(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return;
    localStorage.setItem(getSuppressedStorageKey(sessionId, branchTitle), "1");
  }

  function clearSuppressed(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return;
    localStorage.removeItem(getSuppressedStorageKey(sessionId, branchTitle));
  }

  function deriveBranchTitleFromText(value) {
    const text = clipText(stripBranchTitleNoise(value), 72);
    if (!text) return "继续这条支线";
    const firstSegment = text.split(/[。！？.!?\n]/).map((entry) => entry.trim()).find(Boolean);
    return normalizeTitle(firstSegment || text);
  }

  function replaceSessionRecord(nextSession) {
    if (!nextSession?.id) return;
    const records = getSessionRecords();
    if (Array.isArray(records)) {
      const index = records.findIndex((entry) => entry.id === nextSession.id);
      if (index !== -1) {
        records[index] = nextSession;
      } else {
        records.unshift(nextSession);
      }
    }
    if (typeof getCurrentSession === "function") {
      const current = getCurrentSession();
      if (current?.id === nextSession.id) {
        Object.assign(current, nextSession);
      }
    }
  }

  async function persistCandidateSuppression(sessionId, branchTitle, suppressed = true) {
    if (!sessionId || !branchTitle) return null;
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/candidate-suppression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchTitle,
          suppressed,
        }),
      });
      if (response?.session) {
        replaceSessionRecord(response.session);
      }
      if (response?.snapshot) {
        snapshot = response.snapshot;
      }
      return response;
    } catch (error) {
      console.warn("[quest] Failed to persist branch suppression:", error?.message || error);
      return null;
    }
  }

  function deriveQuestState() {
    const session = getCurrentSessionSafe();
    const liveSession = session?.id ? getSessionRecord(session.id) : null;
    if (!session?.id || !liveSession) {
      return { hasSession: false };
    }
    const taskCard = getTaskCard(liveSession);
    const activeContext = getActiveSessionContext(liveSession.id);
    const latestContext = getLatestSessionContext(liveSession.id);
    const cluster = getClusterForSession(liveSession.id);
    const clusterMainSession = cluster?.mainSessionId ? (getSessionRecord(cluster.mainSessionId) || cluster?.mainSession || null) : null;
    const clusterBranchSession = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.find((entry) => entry?.id === liveSession.id)
      : null;
    const fallbackIsBranch = Boolean(cluster && cluster.mainSessionId && cluster.mainSessionId !== liveSession.id);
    const isBranch = String(
      activeContext?.lineRole
      || latestContext?.lineRole
      || taskCard?.lineRole
      || (fallbackIsBranch ? "branch" : "main"),
    ).toLowerCase() === "branch";
    const branchStatus = String(
      latestContext?.status
      || clusterBranchSession?._branchStatus
      || (isBranch ? "active" : ""),
    ).toLowerCase();
    const mainGoal = normalizeTitle(
      activeContext?.mainGoal
      || latestContext?.mainGoal
      || taskCard?.mainGoal
      || cluster?.mainGoal
      || clusterMainSession?.taskCard?.mainGoal
      || clusterMainSession?.taskCard?.goal
      || taskCard?.goal
      || liveSession.name
      || "当前主线",
    );
    const currentGoal = normalizeTitle(
      activeContext?.goal
      || latestContext?.goal
      || taskCard?.goal
      || clusterBranchSession?.taskCard?.goal
      || clusterBranchSession?.name
      || liveSession.name
      || mainGoal,
    );
    const rawNextStep = clipText(
      activeContext?.nextStep
      || (getTaskCardList(taskCard, "nextSteps")[0] || "")
      || (getTaskCardList(clusterBranchSession?.taskCard, "nextSteps")[0] || "")
      || activeContext?.resumeHint
      || activeContext?.checkpointSummary
      || "继续把当前目标再推进一步。",
      120,
    );
    const nextStep = shouldHideTrackerNext(rawNextStep) ? "" : rawNextStep;
    const branchFrom = normalizeTitle(activeContext?.branchFrom || taskCard?.branchFrom || mainGoal);
    const parentSessionId = String(
      activeContext?.parentSessionId
      || latestContext?.parentSessionId
      || clusterBranchSession?._branchParentSessionId
      || (fallbackIsBranch ? cluster?.mainSessionId : "")
      || "",
    ).trim();
    const parentSession = parentSessionId
      ? (getSessionRecord(parentSessionId) || clusterMainSession)
      : null;
    return {
      hasSession: true,
      session: liveSession,
      taskCard,
      activeContext,
      latestContext,
      isBranch,
      branchStatus,
      mainGoal,
      currentGoal,
      nextStep,
      branchFrom,
      parentSessionId,
      parentSession,
    };
  }

  function getEmptyStateNode() {
    if (typeof emptyState !== "undefined" && emptyState) return emptyState;
    return document.getElementById("emptyState");
  }

  function syncQuestEmptyState(state) {
    const emptyNode = getEmptyStateNode();
    if (!emptyNode) return;
    const titleEl = emptyNode.querySelector("h2");
    const bodyEl = emptyNode.querySelector("p");
    if (titleEl && !titleEl.dataset.defaultText) {
      titleEl.dataset.defaultText = titleEl.textContent || "";
    }
    if (bodyEl && !bodyEl.dataset.defaultText) {
      bodyEl.dataset.defaultText = bodyEl.textContent || "";
    }

    if (!state?.hasSession) {
      emptyNode.classList.remove("quest-empty-state");
      emptyNode.hidden = true;
      return;
    }

    emptyNode.hidden = false;
    emptyNode.classList.add("quest-empty-state");
    if (titleEl) {
      titleEl.textContent = state.isBranch ? state.currentGoal : state.mainGoal;
    }
    if (bodyEl) {
      bodyEl.textContent = state.isBranch
        ? "直接从输入框继续当前任务。需要返回时，用上方按钮回到主线任务。"
        : "直接从输入框继续当前任务。系统只会在消息流里轻提示可开启的支线任务。";
    }
  }

  function renderTracker() {
    const state = deriveQuestState();
    if (!state.hasSession) {
      tracker.hidden = true;
      syncQuestEmptyState(state);
      return;
    }

    tracker.hidden = false;
    syncQuestEmptyState(state);
    const showBranch = Boolean(state.isBranch && state.currentGoal);
    trackerLabelEl.textContent = showBranch ? "当前任务" : "主线任务";
    trackerTitleEl.textContent = showBranch ? state.currentGoal : "开始和agent对话吧";
    if (trackerBranchEl) {
      trackerBranchEl.hidden = !showBranch;
      if (trackerBranchLabelEl) {
        trackerBranchLabelEl.textContent = showBranch ? "来自主线" : "";
      }
      if (trackerBranchTitleEl) {
        trackerBranchTitleEl.textContent = showBranch ? state.mainGoal : "";
      }
    }
    trackerNextEl.hidden = !showBranch;
    trackerNextEl.hidden = !showBranch || !state.nextStep;
    trackerNextEl.textContent = showBranch ? state.nextStep : "";
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (trackerAltBtn) {
      trackerAltBtn.hidden = true;
      trackerAltBtn.textContent = "";
      trackerAltBtn.title = "";
      trackerAltBtn.removeAttribute("aria-label");
    }
    trackerBackBtn.hidden = !state.isBranch || !state.parentSessionId;
    if (showBranch && branchStatus === "active") {
      if (trackerAltBtn) {
        trackerAltBtn.hidden = false;
        trackerAltBtn.textContent = "完成但不回主线";
        trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
        trackerAltBtn.title = trackerAltBtn.textContent;
      }
      trackerBackBtn.textContent = "完成并回主线";
    } else if (showBranch && ["resolved", "merged", "parked"].includes(branchStatus)) {
      if (trackerAltBtn) {
        trackerAltBtn.hidden = !state.parentSessionId;
        trackerAltBtn.textContent = "返回主线任务";
        trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
        trackerAltBtn.title = trackerAltBtn.textContent;
      }
      trackerBackBtn.textContent = "继续处理";
    } else {
      trackerBackBtn.textContent = showBranch ? "完成当前任务" : "返回主线任务";
    }
    trackerBackBtn.setAttribute("aria-label", trackerBackBtn.textContent);
    trackerBackBtn.title = trackerBackBtn.textContent;
  }

  function renderPathPanel() {
    // Path-cluster UI has been removed from the user-facing surface.
  }

  async function refreshSnapshot() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        snapshot = await fetchJsonOrRedirect("/api/workbench");
      } catch {
        snapshot = {
          captureItems: [],
          projects: [],
          nodes: [],
          branchContexts: [],
          taskClusters: [],
          skills: [],
          summaries: [],
        };
      }
      renderTracker();
      renderPathPanel();
      if (typeof renderSessionList === "function") {
        renderSessionList();
      }
      refreshInFlight = null;
      return snapshot;
    })();
    return refreshInFlight;
  }

  async function enterBranchFromCurrentSession(branchTitle, options = {}) {
    const session = getCurrentSessionSafe();
    if (!session?.id || !branchTitle) return null;
    clearSuppressed(session.id, branchTitle);
    void persistCandidateSuppression(session.id, branchTitle, false);
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(session.id)}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: branchTitle,
        branchReason: options.branchReason || "",
        checkpointSummary: options.checkpointSummary || "",
      }),
    });
    snapshot = response?.snapshot || snapshot;
    if (response?.session) {
      replaceSessionRecord(response.session);
    }
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    if (response?.session && typeof attachSession === "function") {
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function openManualBranchFromText(text, options = {}) {
    const state = deriveQuestState();
    if (!state.hasSession) return null;
    const branchTitle = normalizeTitle(options.branchTitle || deriveBranchTitleFromText(text));
    if (!branchTitle) return null;
    return enterBranchFromCurrentSession(branchTitle, {
      branchReason: options.branchReason || (state.isBranch ? "从当前支线继续拆出子任务" : "从当前对话另开一条支线"),
      checkpointSummary: options.checkpointSummary || state.nextStep || "",
    });
  }

  function canOpenManualBranch() {
    const state = deriveQuestState();
    return Boolean(state.hasSession);
  }

  async function returnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch || !state.session?.id) return null;
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(state.session.id)}/merge-return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    snapshot = response?.snapshot || snapshot;
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    if (response?.session && typeof attachSession === "function") {
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function setCurrentBranchStatus(status, sessionIdOverride = "") {
    const state = deriveQuestState();
    const targetSessionId = sessionIdOverride || state.session?.id || "";
    const isBranchTarget = sessionIdOverride ? true : state.isBranch;
    if (!targetSessionId || !isBranchTarget) return null;
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/branch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    snapshot = response?.snapshot || snapshot;
    if (response?.session) {
      replaceSessionRecord(response.session);
    }
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function reopenCurrentBranch() {
    return setCurrentBranchStatus("active");
  }

  function returnToParentSession() {
    const state = deriveQuestState();
    if (!state.parentSessionId || typeof attachSession !== "function") return null;
    attachSession(state.parentSessionId, state.parentSession || null);
    renderTracker();
    return state.parentSessionId;
  }

  function createBranchSuggestionItem(evt) {
    const session = getCurrentSessionSafe();
    if (!session?.id || !evt?.branchTitle || isSuppressed(session.id, evt.branchTitle)) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "quest-branch-suggestion-item";

    const main = document.createElement("div");
    main.className = "quest-branch-suggestion-main";

    const title = document.createElement("div");
    title.className = "quest-branch-suggestion-title";
    title.textContent = evt.branchTitle;
    main.appendChild(title);

    if (evt.branchReason) {
      const summary = document.createElement("div");
      summary.className = "quest-branch-suggestion-summary";
      summary.textContent = evt.branchReason;
      main.appendChild(summary);
    }

    const actions = document.createElement("div");
    actions.className = "quest-branch-suggestion-actions";

    const enterBtn = document.createElement("button");
    enterBtn.type = "button";
    enterBtn.className = "quest-branch-btn quest-branch-btn-primary";
    enterBtn.textContent = "开启支线任务";
    enterBtn.addEventListener("click", async () => {
      enterBtn.disabled = true;
      try {
        await enterBranchFromCurrentSession(evt.branchTitle, {
          branchReason: evt.branchReason || "",
        });
      } finally {
        enterBtn.disabled = false;
      }
    });

    row.appendChild(main);
    actions.appendChild(enterBtn);
    row.appendChild(actions);
    return row;
  }

  function createMergeNoteCard(evt) {
    if (!evt) return null;
    const card = document.createElement("div");
    card.className = "quest-merge-note";

    const label = document.createElement("div");
    label.className = "quest-merge-note-label";
    label.textContent = evt.mergeType === "conclusion" ? "支线结论已带回主线" : "支线线索已带回主线";
    card.appendChild(label);

    const title = document.createElement("div");
    title.className = "quest-merge-note-title";
    title.textContent = evt.branchTitle || "支线";
    card.appendChild(title);

    const summary = document.createElement("div");
    summary.className = "quest-merge-note-summary";
    summary.textContent = clipText(evt.broughtBack || evt.content || "", 180);
    card.appendChild(summary);

    if (evt.nextStep) {
      const next = document.createElement("div");
      next.className = "quest-merge-note-next";
      next.textContent = `主线下一步：${evt.nextStep}`;
      card.appendChild(next);
    }
    return card;
  }

  function createBranchEnteredCard(evt) {
    if (!evt?.branchTitle) return null;
    const card = document.createElement("div");
    card.className = "quest-merge-note quest-branch-entered-note";

    const label = document.createElement("div");
    label.className = "quest-merge-note-label";
    label.textContent = "已开启支线任务";
    card.appendChild(label);

    const title = document.createElement("div");
    title.className = "quest-merge-note-title";
    title.textContent = evt.branchTitle;
    card.appendChild(title);

    if (evt.branchFrom) {
      const summary = document.createElement("div");
      summary.className = "quest-merge-note-summary";
      summary.textContent = `来自主线：${evt.branchFrom}`;
      card.appendChild(summary);
    }

    return card;
  }

  trackerBackBtn?.addEventListener("click", () => {
    const state = deriveQuestState();
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (branchStatus === "active") {
      void returnToMainline();
      return;
    }
    void reopenCurrentBranch();
  });

  trackerAltBtn?.addEventListener("click", () => {
    const state = deriveQuestState();
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (branchStatus === "active") {
      void setCurrentBranchStatus("resolved");
      return;
    }
    returnToParentSession();
  });

  document.addEventListener("melodysync:session-change", () => {
    void refreshSnapshot();
  });

  window.addEventListener("focus", () => {
    void refreshSnapshot();
  });

  window.MelodySyncWorkbench = {
    surfaceMode: "quest_tracker",
    refresh: refreshSnapshot,
    getSnapshot: () => snapshot,
    canOpenManualBranch,
    createBranchSuggestionItem,
    createBranchEnteredCard,
    createMergeNoteCard,
    enterBranchFromCurrentSession,
    openManualBranchFromText,
    returnToMainline,
    reopenCurrentBranch,
    setCurrentBranchStatus,
  };

  void refreshSnapshot();
})();
