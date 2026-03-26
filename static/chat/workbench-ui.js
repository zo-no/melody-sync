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
  const STORAGE_SNOOZE_KEY = "melodysyncReminderSnoozeUntil";
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

  function getSnoozeState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_SNOOZE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setSnoozeState(nextState) {
    localStorage.setItem(STORAGE_SNOOZE_KEY, JSON.stringify(nextState || {}));
  }

  function isSnoozed(sessionId) {
    if (!sessionId) return false;
    const state = getSnoozeState();
    const until = Number(state?.[sessionId]) || 0;
    return until > Date.now();
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

  function snoozeCurrentSession() {
    const session = getCurrentSessionSafe();
    if (!session?.id) return;
    const state = getSnoozeState();
    state[session.id] = Date.now() + SNOOZE_MS;
    setSnoozeState(state);
    renderReminder();
  }

  function clearCurrentSessionSnooze() {
    const session = getCurrentSessionSafe();
    if (!session?.id) return;
    const state = getSnoozeState();
    if (state[session.id]) {
      delete state[session.id];
      setSnoozeState(state);
    }
  }

  function pickProject(session) {
    const projects = getProjects();
    if (projects.length === 0) return null;

    const sessionBranch = (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).find(
      (entry) => entry.sessionId === session?.id,
    );
    if (sessionBranch) {
      const node = (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).find((entry) => entry.id === sessionBranch.nodeId);
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
    const activeBranch = branchContexts.find((entry) => entry.sessionId === session.id) || null;
    const rootNode = project?.rootNodeId ? nodesById.get(project.rootNodeId) || null : (nodes.find((entry) => !entry.parentId) || null);
    const activeNode = activeBranch ? nodesById.get(activeBranch.nodeId) || null : null;
    const returnNode = activeBranch ? nodesById.get(activeBranch.returnToNodeId) || null : null;

    const cardSummary = clipText(taskCard?.summary || "", 160);
    const cardGoal = clipText(taskCard?.goal || "", 100);
    const nextSteps = getTaskCardList(taskCard, "nextSteps");
    const memory = getTaskCardList(taskCard, "memory");
    const focusTitle = cardGoal || clipText(session.name || session.id, 100);
    const focusSummary = cardSummary || clipText((taskCard?.knownConclusions || []).join(" · "), 160) || "保持当前对话在同一目标上持续推进。";
    const nextStep = clipText(
      nextSteps[0]
      || activeNode?.nextAction
      || returnNode?.nextAction
      || rootNode?.nextAction
      || "继续把当前问题收成更清楚的一句话。",
      140,
    );

    const mainlineLabel = clipText(rootNode?.title || project?.title || focusTitle, 80);
    const currentBranchLabel = clipText(activeBranch?.goal || activeNode?.title || "", 80);
    const rememberedBranches = branchContexts
      .filter((entry) => entry.sessionId !== session.id)
      .slice(0, 3)
      .map((entry) => clipText(entry.goal || nodesById.get(entry.nodeId)?.title || entry.sessionId, 72));
    const memoryItems = rememberedBranches.length > 0
      ? rememberedBranches
      : memory.slice(0, 3);

    const memoryHint = rememberedBranches.length > 0
      ? `已替你记住 ${rememberedBranches.length} 个相关旁支。`
      : (memory.length > 0
        ? `已带上 ${memory.length} 条可复用上下文。`
        : "旁支暂时不展开，系统会先替你记住。");

    const returnHint = clipText(
      (returnNode && (returnNode.nextAction || returnNode.summary || returnNode.title))
      || activeBranch?.checkpointSummary
      || rootNode?.nextAction
      || "当前主线还没有明确回收点。",
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
      branchEmptyEl.textContent = "No explicit branch needs to be shown yet. If the conversation drifts, the system will remember it quietly.";
      return;
    }

    branchEmptyEl.hidden = true;
    branchMapEl.appendChild(createBranchRow({ label: `Main line: ${reminder.mainlineLabel}` }));
    if (reminder.currentBranchLabel) {
      const connector = document.createElement("div");
      connector.className = "workbench-branch-line";
      branchMapEl.appendChild(connector);
      branchMapEl.appendChild(createBranchRow({
        label: `Current branch: ${reminder.currentBranchLabel}`,
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
      hintEl.textContent = "This view only wakes up when there is an active conversation to continue.";
      focusTitleEl.textContent = "Open a session";
      focusSummaryEl.textContent = "This panel stays passive. It only surfaces the minimum context needed to keep momentum.";
      nextStepEl.textContent = "Create or choose a session, then continue through chat.";
      returnHintEl.textContent = "Resume hints will appear once the conversation has a stable direction.";
      memoryHintEl.textContent = "Branch drift, checkpoints, and reusable context will accumulate quietly in the background.";
      memoryListEl.hidden = true;
      branchMapEl.innerHTML = "";
      branchEmptyEl.hidden = false;
      branchEmptyEl.textContent = "No session yet, so there is no branch path to show.";
      continueBtn.disabled = true;
      laterBtn.disabled = true;
      return;
    }

    if (isSnoozed(sessionId)) {
      panel.hidden = true;
      return;
    }

    clearCurrentSessionSnooze();
    panel.hidden = false;
    emptyStateEl.hidden = true;
    continueBtn.disabled = false;
    laterBtn.disabled = false;

    hintEl.textContent = reminder.project
      ? `Project context: ${reminder.project.title}`
      : "No explicit project is attached. The panel is using the carried goal and next step from the conversation itself.";
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
    clearCurrentSessionSnooze();
    renderReminder();
    focusComposer();
  });

  laterBtn?.addEventListener("click", () => {
    snoozeCurrentSession();
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
