(function workbenchModule() {
  const panel = document.getElementById("workbenchPanel");
  if (!panel) return;

  const hintEl = document.getElementById("workbenchSessionHint");
  const focusTitleEl = document.getElementById("workbenchFocusTitle");
  const focusSummaryEl = document.getElementById("workbenchFocusSummary");
  const nextStepEl = document.getElementById("workbenchNextStep");
  const branchMapEl = document.getElementById("workbenchBranchMap");
  const branchEmptyEl = document.getElementById("workbenchBranchEmpty");
  const returnHintEl = document.getElementById("workbenchReturnHint");
  const memoryHintEl = document.getElementById("workbenchMemoryHint");
  const memoryListEl = document.getElementById("workbenchMemoryList");
  const emptyStateEl = document.getElementById("workbenchEmptyState");
  const continueBtn = document.getElementById("workbenchContinueBtn");
  const laterBtn = document.getElementById("workbenchLaterBtn");

  const STORAGE_PROJECT_KEY = "melodysyncReminderProjectId";
  const SNOOZE_MS = 30 * 60 * 1000;

  let snapshot = {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    skills: [],
    summaries: [],
  };

  function clipText(value, max = 160) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function getCurrentSessionSafe() {
    if (typeof getCurrentSession === "function") return getCurrentSession();
    return null;
  }

  function getTaskCard(session) {
    if (!session?.taskCard || typeof session.taskCard !== "object") return null;
    return session.taskCard;
  }

  function getTaskCardList(taskCard, key) {
    const value = taskCard?.[key];
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
  }

  function getProjects() {
    return Array.isArray(snapshot.projects) ? snapshot.projects : [];
  }

  function getNodes(projectId) {
    return (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).filter((entry) => entry.projectId === projectId);
  }

  function getBranchContexts(projectId) {
    const nodeIds = new Set(getNodes(projectId).map((entry) => entry.id));
    return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).filter((entry) => nodeIds.has(entry.nodeId));
  }

  function getActiveSessionContext(sessionId) {
    return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).find((entry) => (
      entry?.sessionId === sessionId
      && String(entry?.status || "active").toLowerCase() === "active"
    )) || null;
  }

  function getProjectById(projectId) {
    return getProjects().find((entry) => entry.id === projectId) || null;
  }

  function getRememberedProjectId() {
    return localStorage.getItem(STORAGE_PROJECT_KEY) || "";
  }

  function rememberProjectId(projectId) {
    if (projectId) {
      localStorage.setItem(STORAGE_PROJECT_KEY, projectId);
    }
  }

  function isSnoozed(sessionId) {
    if (!sessionId) return false;
    const activeContext = getActiveSessionContext(sessionId);
    if (!activeContext?.snoozedUntil) return false;
    const until = Date.parse(activeContext.snoozedUntil);
    return Number.isFinite(until) && until > Date.now();
  }

  function focusComposer() {
    if (typeof msgInput !== "undefined" && msgInput) {
      msgInput.focus();
      const value = msgInput.value || "";
      const end = value.length;
      if (typeof msgInput.setSelectionRange === "function") {
        msgInput.setSelectionRange(end, end);
      }
    }
  }

  async function snoozeCurrentSession() {
    const session = getCurrentSessionSafe();
    if (!session?.id) return;
    const until = new Date(Date.now() + SNOOZE_MS).toISOString();
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(session.id)}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until }),
      });
      snapshot = response?.snapshot || snapshot;
    } catch {
      return;
    }
    renderReminder();
  }

  function pickProject(session) {
    const projects = getProjects();
    if (projects.length === 0) return null;

    const sessionContext = getActiveSessionContext(session?.id);
    if (sessionContext) {
      const node = (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).find((entry) => entry.id === sessionContext.nodeId);
      if (node) {
        const project = getProjectById(node.projectId);
        if (project) {
          rememberProjectId(project.id);
          return project;
        }
      }
    }

    const remembered = getRememberedProjectId();
    if (remembered) {
      const project = getProjectById(remembered);
      if (project) return project;
    }

    const groupName = String(session?.group || "").trim().toLowerCase();
    if (groupName) {
      const matched = projects.find((entry) => String(entry.title || "").trim().toLowerCase() === groupName);
      if (matched) {
        rememberProjectId(matched.id);
        return matched;
      }
    }

    const fallback = projects[0] || null;
    if (fallback) rememberProjectId(fallback.id);
    return fallback;
  }

  function deriveReminder() {
    const session = getCurrentSessionSafe();
    if (!session?.id) {
      return {
        hasSession: false,
      };
    }

    const taskCard = getTaskCard(session);
    const project = pickProject(session);
    const nodes = project ? getNodes(project.id) : [];
    const nodesById = new Map(nodes.map((entry) => [entry.id, entry]));
    const branchContexts = project ? getBranchContexts(project.id) : [];
    const activeContext = getActiveSessionContext(session.id);
    const rootNode = activeContext?.mainNodeId
      ? nodesById.get(activeContext.mainNodeId) || null
      : (project?.rootNodeId ? nodesById.get(project.rootNodeId) || null : (nodes.find((entry) => !entry.parentId) || null));
    const activeNode = activeContext ? nodesById.get(activeContext.nodeId) || null : null;
    const returnNode = activeContext?.returnToNodeId ? nodesById.get(activeContext.returnToNodeId) || null : null;

    const cardSummary = clipText(taskCard?.summary || "", 160);
    const cardGoal = clipText(taskCard?.goal || "", 100);
    const nextSteps = getTaskCardList(taskCard, "nextSteps");
    const memory = getTaskCardList(taskCard, "memory");
    const focusTitle = cardGoal || clipText(session.name || session.id, 100);
    const focusSummary = cardSummary || clipText((taskCard?.knownConclusions || []).join(" · "), 160) || "Keep the conversation moving on one clear line until the next checkpoint is stable.";
    const nextStep = clipText(
      nextSteps[0]
      || activeNode?.nextAction
      || returnNode?.nextAction
      || rootNode?.nextAction
      || "Make the current question one notch clearer before opening another branch.",
      140,
    );

    const mainlineLabel = clipText(activeContext?.mainGoal || rootNode?.title || taskCard?.mainGoal || project?.title || focusTitle, 80);
    const currentBranchLabel = String(activeContext?.lineRole || "").toLowerCase() === "branch"
      ? clipText(activeContext?.goal || activeNode?.title || cardGoal || "", 80)
      : "";
    const rememberedBranches = branchContexts
      .filter((entry) => entry.sessionId !== session.id && String(entry?.status || "active").toLowerCase() === "active" && String(entry?.lineRole || "").toLowerCase() === "branch")
      .slice(0, 3)
      .map((entry) => clipText(entry.goal || nodesById.get(entry.nodeId)?.title || entry.sessionId, 72));
    const memoryItems = rememberedBranches.length > 0
      ? rememberedBranches
      : memory.slice(0, 3);

    const memoryHint = rememberedBranches.length > 0
      ? `已替你记住 ${rememberedBranches.length} 条支线。`
      : (memory.length > 0
        ? `已带上 ${memory.length} 条可复用上下文。`
        : "其他支线先收在后台，不打断当前任务。");

    const returnHint = clipText(
      (returnNode && (returnNode.nextAction || returnNode.summary || returnNode.title))
      || activeContext?.resumeHint
      || activeContext?.checkpointSummary
      || rootNode?.nextAction
      || "主线恢复点还在形成中。",
      120,
    );

    return {
      hasSession: true,
      session,
      taskCard,
      project,
      focusTitle,
      focusSummary,
      nextStep,
      mainlineLabel,
      currentBranchLabel,
      returnHint,
      memoryHint,
      rememberedBranches,
      memoryItems,
      activeContext,
      showBranchMap: Boolean(project || currentBranchLabel),
    };
  }

  function createBranchRow({ label, tone = "main", indented = false }) {
    const row = document.createElement("div");
    row.className = `workbench-branch-row${indented ? " is-indented" : ""}`;

    const marker = document.createElement("div");
    marker.className = `workbench-branch-marker is-${tone}`;
    row.appendChild(marker);

    const text = document.createElement("div");
    text.className = "workbench-branch-text";
    text.textContent = label;
    row.appendChild(text);

    return row;
  }

  function renderBranchMap(reminder) {
    if (!branchMapEl || !branchEmptyEl) return;
    branchMapEl.innerHTML = "";

    if (!reminder?.showBranchMap) {
      branchEmptyEl.hidden = false;
      branchEmptyEl.textContent = "当前还没有偏离主线。";
      return;
    }

    branchEmptyEl.hidden = true;
    branchMapEl.appendChild(createBranchRow({ label: `主线：${reminder.mainlineLabel}` }));
    if (reminder.currentBranchLabel) {
      const connector = document.createElement("div");
      connector.className = "workbench-branch-line";
      branchMapEl.appendChild(connector);
      branchMapEl.appendChild(createBranchRow({
        label: `支线：${reminder.currentBranchLabel}`,
        tone: "active",
        indented: true,
      }));
    }
  }

  function renderMemory(reminder) {
    if (!memoryHintEl || !memoryListEl) return;
    memoryHintEl.textContent = reminder.memoryHint;
    memoryListEl.innerHTML = "";
    for (const item of reminder.memoryItems || []) {
      const li = document.createElement("li");
      li.textContent = item;
      memoryListEl.appendChild(li);
    }
    memoryListEl.hidden = (reminder.memoryItems || []).length === 0;
  }

  function renderReminder() {
    const reminder = deriveReminder();
    const sessionId = reminder.session?.id || "";
    const disabledMode = typeof getBootstrapAuthInfo === "function"
      && getBootstrapAuthInfo()?.role === "visitor";
    const shareMode = typeof getBootstrapShareSnapshot === "function" && Boolean(getBootstrapShareSnapshot());
    if (disabledMode || shareMode) {
      panel.hidden = true;
      return;
    }

    if (!reminder.hasSession) {
      panel.hidden = false;
      emptyStateEl.hidden = false;
      hintEl.textContent = "这里只追踪你当前最该继续的一步。";
      focusTitleEl.textContent = "先进入一个会话";
      focusSummaryEl.textContent = "任务追踪会自动出现，不要求你手动管理任务树。";
      nextStepEl.textContent = "创建或选择一个会话后开始继续。";
      returnHintEl.textContent = "恢复点会在对话逐渐稳定后自动出现。";
      memoryHintEl.textContent = "支线、恢复点和可复用上下文会在后台逐渐沉淀。";
      memoryListEl.hidden = true;
      branchMapEl.innerHTML = "";
      branchEmptyEl.hidden = false;
      branchEmptyEl.textContent = "当前还没有任务路径。";
      continueBtn.disabled = true;
      laterBtn.disabled = true;
      return;
    }

    if (isSnoozed(sessionId)) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    emptyStateEl.hidden = true;
    continueBtn.disabled = false;
    laterBtn.disabled = false;

    hintEl.textContent = reminder.project
      ? `当前任务域：${reminder.project.title}`
      : "当前还没有显式任务域，先用对话里的目标和下一步保持连续性。";
    focusTitleEl.textContent = reminder.focusTitle;
    focusSummaryEl.textContent = reminder.focusSummary;
    nextStepEl.textContent = reminder.nextStep;
    returnHintEl.textContent = reminder.returnHint;
    renderBranchMap(reminder);
    renderMemory(reminder);
  }

  async function refreshSnapshot() {
    try {
      snapshot = await fetchJsonOrRedirect("/api/workbench");
    } catch {
      snapshot = {
        captureItems: [],
        projects: [],
        nodes: [],
        branchContexts: [],
        skills: [],
        summaries: [],
      };
    }
    renderReminder();
  }

  continueBtn?.addEventListener("click", () => {
    renderReminder();
    focusComposer();
  });

  laterBtn?.addEventListener("click", async () => {
    laterBtn.disabled = true;
    try {
      await snoozeCurrentSession();
    } finally {
      laterBtn.disabled = false;
    }
  });

  document.addEventListener("melodysync:session-change", () => {
    void refreshSnapshot();
  });

  window.addEventListener("focus", () => {
    void refreshSnapshot();
  });

  window.MelodySyncWorkbench = {
    surfaceMode: "reminder",
    refresh: refreshSnapshot,
    focusInput: focusComposer,
    snoozeCurrentSession,
  };

  void refreshSnapshot();
})();
