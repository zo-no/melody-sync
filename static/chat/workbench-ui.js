(function workbenchModule() {
  const panel = document.getElementById("workbenchPanel");
  if (!panel) return;

  const tabInbox = document.getElementById("workbenchTabInbox");
  const tabTree = document.getElementById("workbenchTabTree");
  const viewInbox = document.getElementById("workbenchViewInbox");
  const viewTree = document.getElementById("workbenchViewTree");
  const sessionHint = document.getElementById("workbenchSessionHint");
  const statusEl = document.getElementById("workbenchStatus");
  const projectForm = document.getElementById("workbenchProjectForm");
  const projectTitleInput = document.getElementById("workbenchProjectTitle");
  const projectBriefInput = document.getElementById("workbenchProjectBrief");
  const projectPathInput = document.getElementById("workbenchProjectPath");
  const inboxCountEl = document.getElementById("workbenchInboxCount");
  const inboxEmptyEl = document.getElementById("workbenchInboxEmpty");
  const inboxListEl = document.getElementById("workbenchInboxList");
  const projectSelect = document.getElementById("workbenchProjectSelect");
  const projectMetaEl = document.getElementById("workbenchProjectMeta");
  const nodeForm = document.getElementById("workbenchNodeForm");
  const nodeTitleInput = document.getElementById("workbenchNodeTitle");
  const nodeTypeSelect = document.getElementById("workbenchNodeType");
  const nodeParentSelect = document.getElementById("workbenchNodeParent");
  const nodeSummaryInput = document.getElementById("workbenchNodeSummary");
  const nodeNextActionInput = document.getElementById("workbenchNodeNextAction");
  const treeCountEl = document.getElementById("workbenchTreeCount");
  const treeEmptyEl = document.getElementById("workbenchTreeEmpty");
  const treeListEl = document.getElementById("workbenchTreeList");
  const summaryMetaEl = document.getElementById("workbenchSummaryMeta");
  const summaryPreviewEl = document.getElementById("workbenchSummaryPreview");
  const generateSummaryBtn = document.getElementById("workbenchGenerateSummaryBtn");
  const writebackBtn = document.getElementById("workbenchWritebackBtn");

  let snapshot = {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    skills: [],
    summaries: [],
  };
  let activeTab = localStorage.getItem("melodysyncWorkbenchTab") === "tree" ? "tree" : "inbox";
  let selectedProjectId = localStorage.getItem("melodysyncWorkbenchProjectId") || "";
  let bootstrapped = false;

  function isWorkbenchDisabledMode() {
    const authInfo = typeof getBootstrapAuthInfo === "function"
      ? getBootstrapAuthInfo()
      : null;
    if (authInfo?.role === "visitor") return true;
    if (typeof getBootstrapShareSnapshot === "function" && getBootstrapShareSnapshot()) return true;
    return false;
  }

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.remove("success", "error");
    if (tone) statusEl.classList.add(tone);
  }

  function clipText(value, max = 240) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function getProjects() {
    return Array.isArray(snapshot.projects) ? snapshot.projects : [];
  }

  function getProject(projectId = selectedProjectId) {
    return getProjects().find((entry) => entry.id === projectId) || null;
  }

  function getNodes(projectId = selectedProjectId) {
    return (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).filter((entry) => entry.projectId === projectId);
  }

  function getBranchContexts(projectId = selectedProjectId) {
    const nodeIds = new Set(getNodes(projectId).map((entry) => entry.id));
    return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).filter((entry) => nodeIds.has(entry.nodeId));
  }

  function getLatestSummary(projectId = selectedProjectId) {
    return (Array.isArray(snapshot.summaries) ? snapshot.summaries : []).find((entry) => entry.projectId === projectId) || null;
  }

  function ensureProjectSelection() {
    const projects = getProjects();
    if (projects.length === 0) {
      selectedProjectId = "";
      return;
    }
    if (!projects.some((entry) => entry.id === selectedProjectId)) {
      selectedProjectId = projects[0].id;
      localStorage.setItem("melodysyncWorkbenchProjectId", selectedProjectId);
    }
  }

  function renderProjectOptions(selectEl, { includeEmpty = false, emptyLabel = "Select project" } = {}) {
    if (!selectEl) return;
    const currentValue = selectEl.value;
    selectEl.innerHTML = "";
    if (includeEmpty) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = emptyLabel;
      selectEl.appendChild(blank);
    }
    for (const project of getProjects()) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.title;
      selectEl.appendChild(option);
    }
    if (currentValue && [...selectEl.options].some((option) => option.value === currentValue)) {
      selectEl.value = currentValue;
      return;
    }
    if (selectEl === projectSelect && selectedProjectId) {
      selectEl.value = selectedProjectId;
      return;
    }
    if (!includeEmpty && selectEl.options.length > 0) {
      selectEl.value = selectEl.options[0].value;
    }
  }

  function renderParentOptions() {
    if (!nodeParentSelect) return;
    const currentValue = nodeParentSelect.value;
    nodeParentSelect.innerHTML = "";
    const topOption = document.createElement("option");
    topOption.value = "";
    topOption.textContent = "Top level";
    nodeParentSelect.appendChild(topOption);
    for (const node of getNodes()) {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = `${node.title} · ${node.type}`;
      nodeParentSelect.appendChild(option);
    }
    if (currentValue && [...nodeParentSelect.options].some((option) => option.value === currentValue)) {
      nodeParentSelect.value = currentValue;
    }
  }

  function switchWorkbenchTab(nextTab) {
    activeTab = nextTab === "tree" ? "tree" : "inbox";
    localStorage.setItem("melodysyncWorkbenchTab", activeTab);
    tabInbox?.classList.toggle("active", activeTab === "inbox");
    tabTree?.classList.toggle("active", activeTab === "tree");
    if (viewInbox) viewInbox.hidden = activeTab !== "inbox";
    if (viewTree) viewTree.hidden = activeTab !== "tree";
  }

  function updateSessionHint() {
    if (!sessionHint) return;
    if (typeof getCurrentSession === "function") {
      const session = getCurrentSession();
      if (session?.id) {
        const label = typeof getSessionDisplayName === "function"
          ? getSessionDisplayName(session)
          : (session.name || session.id);
        sessionHint.textContent = `Current session: ${label}`;
        return;
      }
    }
    sessionHint.textContent = "Capture chat context into Inbox, then file it into a project tree.";
  }

  function createProjectSelect(projectId) {
    const select = document.createElement("select");
    select.className = "workbench-input";
    renderProjectOptions(select, { includeEmpty: true, emptyLabel: "Select project" });
    if (projectId) select.value = projectId;
    return select;
  }

  function createNodeTypeSelect(defaultValue = "insight") {
    const select = document.createElement("select");
    select.className = "workbench-input";
    const options = [
      ["question", "Question"],
      ["insight", "Insight"],
      ["solution", "Solution"],
      ["task", "Task"],
      ["risk", "Risk"],
      ["conclusion", "Conclusion"],
      ["knowledge", "Knowledge"],
    ];
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = defaultValue;
    return select;
  }

  function renderInbox() {
    if (!inboxListEl) return;
    const items = (Array.isArray(snapshot.captureItems) ? snapshot.captureItems : []).filter((entry) => entry.status === "inbox");
    inboxCountEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    inboxEmptyEl.hidden = items.length > 0;
    inboxListEl.innerHTML = "";

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "workbench-capture-item";

      const title = document.createElement("div");
      title.className = "workbench-capture-title";
      title.textContent = item.title || clipText(item.text, 72);

      const meta = document.createElement("div");
      meta.className = "workbench-capture-meta";
      meta.textContent = item.sourceSessionId
        ? `session ${item.sourceSessionId}${item.sourceMessageSeq ? ` · seq ${item.sourceMessageSeq}` : ""}`
        : "manual capture";

      const text = document.createElement("div");
      text.className = "workbench-capture-text";
      text.textContent = clipText(item.text, 480);

      const controls = document.createElement("div");
      controls.className = "workbench-capture-controls";
      const projectPick = createProjectSelect(selectedProjectId);
      const typePick = createNodeTypeSelect(item.kind || "insight");
      const promoteBtn = document.createElement("button");
      promoteBtn.type = "button";
      promoteBtn.className = "workbench-primary-btn";
      promoteBtn.textContent = "File to Tree";
      promoteBtn.disabled = getProjects().length === 0;
      promoteBtn.addEventListener("click", async () => {
        const targetProjectId = projectPick.value;
        if (!targetProjectId) {
          setStatus("Create a project first.", "error");
          return;
        }
        promoteBtn.disabled = true;
        try {
          const response = await fetchJsonOrRedirect(`/api/workbench/captures/${encodeURIComponent(item.id)}/promote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: targetProjectId,
              type: typePick.value,
            }),
          });
          snapshot = response.snapshot || snapshot;
          selectedProjectId = targetProjectId;
          localStorage.setItem("melodysyncWorkbenchProjectId", selectedProjectId);
          switchWorkbenchTab("tree");
          renderWorkbench();
          setStatus("Capture filed into the tree.", "success");
        } catch (error) {
          setStatus(error.message || "Failed to file capture.", "error");
        } finally {
          promoteBtn.disabled = false;
        }
      });

      controls.append(projectPick, typePick, promoteBtn);
      card.append(title, meta, text, controls);
      inboxListEl.appendChild(card);
    }
  }

  function renderTree() {
    const project = getProject();
    renderProjectOptions(projectSelect, { includeEmpty: true, emptyLabel: "Select project" });
    renderParentOptions();
    treeListEl.innerHTML = "";

    if (!project) {
      projectMetaEl.textContent = "No project selected";
      treeCountEl.textContent = "0 nodes";
      treeEmptyEl.hidden = false;
      summaryMetaEl.textContent = "Not generated yet";
      summaryPreviewEl.textContent = "No summary yet.";
      generateSummaryBtn.disabled = true;
      writebackBtn.disabled = true;
      return;
    }

    projectSelect.value = project.id;
    projectMetaEl.textContent = clipText(project.obsidianPath || "No Obsidian path", 120);

    const nodes = getNodes(project.id);
    treeCountEl.textContent = `${nodes.length} node${nodes.length === 1 ? "" : "s"}`;
    treeEmptyEl.hidden = nodes.length > 0;
    generateSummaryBtn.disabled = false;
    writebackBtn.disabled = false;

    const branchContexts = getBranchContexts(project.id);
    const childrenByParent = new Map();
    const branchesByNode = new Map();
    for (const node of nodes) {
      const key = node.parentId || "__root__";
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node);
    }
    for (const branch of branchContexts) {
      const list = branchesByNode.get(branch.nodeId) || [];
      list.push(branch);
      branchesByNode.set(branch.nodeId, list);
    }

    const renderLevel = (parentId, depth) => {
      const entries = childrenByParent.get(parentId || "__root__") || [];
      for (const node of entries) {
        const card = document.createElement("div");
        card.className = "workbench-node-card";
        card.dataset.depth = String(Math.min(depth, 4));

        const title = document.createElement("div");
        title.className = "workbench-node-title";
        title.textContent = node.title;

        const meta = document.createElement("div");
        meta.className = "workbench-node-meta";
        meta.textContent = `${node.type} · ${node.state || "open"}`;

        const summary = document.createElement("div");
        summary.className = "workbench-node-summary";
        summary.textContent = clipText(node.summary || "No summary yet.", 320);

        const actions = document.createElement("div");
        actions.className = "workbench-node-actions";
        const branchBtn = document.createElement("button");
        branchBtn.type = "button";
        branchBtn.className = "workbench-secondary-btn";
        branchBtn.textContent = "Branch Chat";
        branchBtn.disabled = !currentSessionId;
        branchBtn.addEventListener("click", async () => {
          if (!currentSessionId) {
            setStatus("Open a session first, then branch from the node.", "error");
            return;
          }
          branchBtn.disabled = true;
          try {
            const response = await fetchJsonOrRedirect(`/api/workbench/nodes/${encodeURIComponent(node.id)}/branch`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceSessionId: currentSessionId,
                goal: node.nextAction || `Continue node: ${node.title}`,
              }),
            });
            snapshot = response.snapshot || snapshot;
            if (response.session) {
              const session = typeof upsertSession === "function"
                ? (upsertSession(response.session) || response.session)
                : response.session;
              if (typeof renderSessionList === "function") renderSessionList();
              if (typeof attachSession === "function") attachSession(session.id, session);
            }
            renderWorkbench();
            setStatus("Branch session created.", "success");
          } catch (error) {
            setStatus(error.message || "Failed to branch from node.", "error");
          } finally {
            branchBtn.disabled = false;
          }
        });
        const nextActionBtn = document.createElement("button");
        nextActionBtn.type = "button";
        nextActionBtn.className = "workbench-ghost-btn";
        nextActionBtn.textContent = node.nextAction ? clipText(node.nextAction, 42) : "No next action";
        nextActionBtn.disabled = true;
        actions.append(branchBtn, nextActionBtn);

        card.append(title, meta, summary);
        const branchItems = branchesByNode.get(node.id) || [];
        if (branchItems.length > 0) {
          const branchMeta = document.createElement("div");
          branchMeta.className = "workbench-node-meta";
          branchMeta.textContent = `Branches: ${branchItems.map((entry) => clipText(entry.goal || entry.sessionId, 42)).join(" · ")}`;
          card.appendChild(branchMeta);
        }
        card.appendChild(actions);
        treeListEl.appendChild(card);
        renderLevel(node.id, depth + 1);
      }
    };

    renderLevel("", 0);

    const latestSummary = getLatestSummary(project.id);
    summaryMetaEl.textContent = latestSummary?.updatedAt
      ? `Updated ${new Date(latestSummary.updatedAt).toLocaleString()}`
      : "Not generated yet";
    summaryPreviewEl.textContent = latestSummary?.markdown || "No summary yet.";
  }

  function renderWorkbench() {
    ensureProjectSelection();
    switchWorkbenchTab(activeTab);
    updateSessionHint();
    renderInbox();
    renderTree();
  }

  async function refreshWorkbench() {
    if (visitorMode || shareSnapshotMode || isWorkbenchDisabledMode()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const data = await fetchJsonOrRedirect("/api/workbench");
    snapshot = data || snapshot;
    renderWorkbench();
    return snapshot;
  }

  async function captureEvent(eventPayload = {}) {
    const text = String(eventPayload.content || eventPayload.bodyPreview || eventPayload.text || "").trim();
    if (!text) {
      setStatus("Nothing to capture from this message.", "error");
      return null;
    }
    try {
      const response = await fetchJsonOrRedirect("/api/workbench/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceSessionId: eventPayload.sourceSessionId || currentSessionId || "",
          sourceMessageSeq: Number.isInteger(eventPayload.seq) ? eventPayload.seq : null,
          text,
          title: clipText(text, 72),
          kind: eventPayload.role === "user" ? "question" : "insight",
        }),
      });
      snapshot = response.snapshot || snapshot;
      switchWorkbenchTab("inbox");
      renderWorkbench();
      setStatus("Capture added to Inbox.", "success");
      return response.captureItem || null;
    } catch (error) {
      setStatus(error.message || "Failed to capture message.", "error");
      return null;
    }
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    const title = projectTitleInput.value.trim();
    if (!title) {
      setStatus("Project title is required.", "error");
      return;
    }
    try {
      const response = await fetchJsonOrRedirect("/api/workbench/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          brief: projectBriefInput.value.trim(),
          obsidianPath: projectPathInput.value.trim(),
        }),
      });
      snapshot = response.snapshot || snapshot;
      selectedProjectId = response.project?.id || selectedProjectId;
      if (selectedProjectId) {
        localStorage.setItem("melodysyncWorkbenchProjectId", selectedProjectId);
      }
      projectForm.reset();
      renderWorkbench();
      setStatus("Project created.", "success");
    } catch (error) {
      setStatus(error.message || "Failed to create project.", "error");
    }
  }

  async function handleCreateNode(event) {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Create or select a project first.", "error");
      return;
    }
    const title = nodeTitleInput.value.trim();
    if (!title) {
      setStatus("Node title is required.", "error");
      return;
    }
    try {
      const response = await fetchJsonOrRedirect("/api/workbench/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          title,
          type: nodeTypeSelect.value,
          parentId: nodeParentSelect.value,
          summary: nodeSummaryInput.value.trim(),
          nextAction: nodeNextActionInput.value.trim(),
        }),
      });
      snapshot = response.snapshot || snapshot;
      nodeForm.reset();
      nodeTypeSelect.value = "question";
      renderWorkbench();
      setStatus("Node added to tree.", "success");
    } catch (error) {
      setStatus(error.message || "Failed to add node.", "error");
    }
  }

  async function handleGenerateSummary() {
    if (!selectedProjectId) {
      setStatus("Select a project first.", "error");
      return;
    }
    generateSummaryBtn.disabled = true;
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/projects/${encodeURIComponent(selectedProjectId)}/summaries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      snapshot = response.snapshot || snapshot;
      renderWorkbench();
      setStatus("Summary generated.", "success");
    } catch (error) {
      setStatus(error.message || "Failed to generate summary.", "error");
    } finally {
      generateSummaryBtn.disabled = false;
    }
  }

  async function handleWriteback() {
    if (!selectedProjectId) {
      setStatus("Select a project first.", "error");
      return;
    }
    writebackBtn.disabled = true;
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/projects/${encodeURIComponent(selectedProjectId)}/writeback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      snapshot = response.snapshot || snapshot;
      renderWorkbench();
      setStatus(`Written to ${response.targetPath || "Obsidian"}.`, "success");
    } catch (error) {
      setStatus(error.message || "Failed to write back to Obsidian.", "error");
    } finally {
      writebackBtn.disabled = false;
    }
  }

  tabInbox?.addEventListener("click", () => switchWorkbenchTab("inbox"));
  tabTree?.addEventListener("click", () => switchWorkbenchTab("tree"));
  projectForm?.addEventListener("submit", handleCreateProject);
  nodeForm?.addEventListener("submit", handleCreateNode);
  projectSelect?.addEventListener("change", () => {
    selectedProjectId = projectSelect.value || "";
    localStorage.setItem("melodysyncWorkbenchProjectId", selectedProjectId);
    renderWorkbench();
  });
  generateSummaryBtn?.addEventListener("click", handleGenerateSummary);
  writebackBtn?.addEventListener("click", handleWriteback);
  document.addEventListener("melodysync:session-change", () => {
    updateSessionHint();
    renderTree();
  });

  window.MelodySyncWorkbench = {
    refresh: refreshWorkbench,
    captureEvent,
    onSessionChange: updateSessionHint,
  };

  queueMicrotask(async () => {
    try {
      await refreshWorkbench();
      bootstrapped = true;
      setStatus("", "");
    } catch (error) {
      if (!bootstrapped) {
        setStatus(error.message || "Failed to load workbench.", "error");
      }
    }
  });
})();
