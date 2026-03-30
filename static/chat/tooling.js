// ---- Thinking toggle / effort select ----
function t(key, vars) {
  return window.remotelabT ? window.remotelabT(key, vars) : key;
}

let runtimeSelectionSyncPromise = Promise.resolve();
let lastSyncedRuntimeSelectionPayload = '';

function buildRuntimeSelectionPayload() {
  if (!selectedTool) return null;
  return {
    selectedTool,
    selectedModel: selectedModel || '',
    selectedEffort: currentToolReasoningKind === 'enum' ? (selectedEffort || '') : '',
    thinkingEnabled: currentToolReasoningKind === 'toggle' ? thinkingEnabled === true : false,
    reasoningKind: currentToolReasoningKind || 'none',
  };
}

function queueRuntimeSelectionSync() {
  const payload = buildRuntimeSelectionPayload();
  if (!payload) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastSyncedRuntimeSelectionPayload) {
    return;
  }
  lastSyncedRuntimeSelectionPayload = serialized;
  runtimeSelectionSyncPromise = runtimeSelectionSyncPromise
    .catch(() => {})
    .then(async () => {
      try {
        await fetchJsonOrRedirect('/api/runtime-selection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        });
      } catch (error) {
        lastSyncedRuntimeSelectionPayload = '';
        console.warn('[runtime-selection] Failed to sync current selection:', error.message);
      }
    });
}

function updateThinkingUI() {
  thinkingToggle.classList.toggle("active", thinkingEnabled);
}
updateThinkingUI();

function getAttachedSessionToolPreferences(toolId = selectedTool) {
  const session = getCurrentSession();
  if (!session || !toolId || session.tool !== toolId) return null;
  return {
    hasModel: Object.prototype.hasOwnProperty.call(session, "model"),
    model: typeof session.model === "string" ? session.model : "",
    hasEffort: Object.prototype.hasOwnProperty.call(session, "effort"),
    effort: typeof session.effort === "string" ? session.effort : "",
    hasThinking: Object.prototype.hasOwnProperty.call(session, "thinking"),
    thinking: session.thinking === true,
  };
}

function persistCurrentSessionToolPreferences() {
  if (!currentSessionId || !selectedTool) return;
  const payload = {
    action: "session_preferences",
    sessionId: currentSessionId,
    tool: selectedTool,
    model: selectedModel || "",
    effort: selectedEffort || "",
    thinking: currentToolReasoningKind === "toggle" ? thinkingEnabled : false,
  };
  dispatchAction(payload);
}

thinkingToggle.addEventListener("click", () => {
  thinkingEnabled = !thinkingEnabled;
  localStorage.setItem("thinkingEnabled", thinkingEnabled);
  updateThinkingUI();
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});

effortSelect.addEventListener("change", () => {
  selectedEffort = effortSelect.value;
  if (selectedTool) localStorage.setItem(`selectedEffort_${selectedTool}`, selectedEffort);
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});
// ---- Inline tool select ----
function updateCopyButtonLabel(button, label) {
  if (!button) return;
  const original = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = label;
  window.clearTimeout(button._copyResetTimer);
  button._copyResetTimer = window.setTimeout(() => {
    button.textContent = button.dataset.originalLabel || original;
  }, 1400);
}

function getToolingLabel(key, vars) {
  if (typeof t === "function") return t(key, vars);
  return window.remotelabT ? window.remotelabT(key, vars) : key;
}

function resetHeaderActionButton(button) {
  if (!button) return;
  button.disabled = false;
  window.clearTimeout(button._copyResetTimer);
  if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

function syncForkButton() {
  if (!forkSessionBtn) return;
  const visible = !!currentSessionId;
  forkSessionBtn.style.display = visible ? "" : "none";
  if (!visible) {
    resetHeaderActionButton(forkSessionBtn);
    return;
  }
  const session = getCurrentSession();
  const activity = getSessionActivity(session);
  forkSessionBtn.disabled = !session || activity.run.state === "running" || activity.compact.state === "pending";
}

function canOrganizeSession(session) {
  if (!session || session.archived === true) return false;
  const activity = typeof getSessionActivity === "function"
    ? getSessionActivity(session)
    : {
        run: { state: "idle" },
        compact: { state: "idle" },
        queue: { count: 0 },
      };
  return activity.run.state !== "running"
    && activity.compact.state !== "pending"
    && (!Number.isInteger(activity.queue.count) || activity.queue.count === 0);
}

function syncOrganizeSessionButton() {
  if (!organizeSessionBtn) return;
  const visible = !!currentSessionId;
  organizeSessionBtn.hidden = !visible;
  if (!visible) {
    resetHeaderActionButton(organizeSessionBtn);
    return;
  }
  const session = getCurrentSession();
  organizeSessionBtn.disabled = !canOrganizeSession(session);
}

async function organizeCurrentSession() {
  if (!currentSessionId || !organizeSessionBtn) return;

  const original = organizeSessionBtn.dataset.originalLabel || organizeSessionBtn.textContent;
  organizeSessionBtn.dataset.originalLabel = original;
  organizeSessionBtn.disabled = true;
  organizeSessionBtn.textContent = `${getToolingLabel("action.organize")}…`;

  try {
    const ok = await dispatchAction({
      action: "organize",
      sessionId: currentSessionId,
      viewportIntent: "preserve",
    });
    updateCopyButtonLabel(
      organizeSessionBtn,
      ok ? getToolingLabel("action.organize") : getToolingLabel("action.copyFailed"),
    );
  } catch (err) {
    console.warn("[session-organize] Failed to organize session:", err.message);
    updateCopyButtonLabel(organizeSessionBtn, getToolingLabel("action.copyFailed"));
  } finally {
    syncOrganizeSessionButton();
  }
}

async function forkCurrentSession() {
  if (!currentSessionId || !forkSessionBtn) return;

  const original = forkSessionBtn.dataset.originalLabel || forkSessionBtn.textContent;
  forkSessionBtn.dataset.originalLabel = original;
  forkSessionBtn.disabled = true;
  forkSessionBtn.textContent = `${getToolingLabel("action.fork")}…`;

  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSessionId)}/fork`, {
      method: "POST",
    });
    if (data.session) {
      upsertSession(data.session);
      renderSessionList();
      updateCopyButtonLabel(forkSessionBtn, getToolingLabel("action.fork"));
    } else {
      updateCopyButtonLabel(forkSessionBtn, getToolingLabel("action.copyFailed"));
    }
  } catch (err) {
    console.warn("[fork] Failed to fork session:", err.message);
    updateCopyButtonLabel(forkSessionBtn, getToolingLabel("action.copyFailed"));
  } finally {
    syncForkButton();
  }
}

function renderInlineToolOptions(selectedValue, emptyMessage = "No agents found") {
  inlineToolSelect.disabled = false;
  inlineToolSelect.innerHTML = "";

  if (toolsList.length === 0) {
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = emptyMessage;
    emptyOpt.disabled = true;
    emptyOpt.selected = true;
    inlineToolSelect.appendChild(emptyOpt);
  } else {
    for (const tool of toolsList) {
      const opt = document.createElement("option");
      opt.value = tool.id;
      opt.textContent = tool.name;
      inlineToolSelect.appendChild(opt);
    }
  }

  if (selectedValue && toolsList.some((tool) => tool.id === selectedValue)) {
    inlineToolSelect.value = selectedValue;
  } else if (toolsList[0]) {
    inlineToolSelect.value = toolsList[0].id;
  }
}

function getVisiblePrimaryToolOptions(keepToolIds = []) {
  const allKeepIds = [
    ...(Array.isArray(keepToolIds) ? keepToolIds : [keepToolIds]),
    selectedTool,
    preferredTool,
  ];
  return prioritizeToolOptions(
    filterPrimaryToolOptions(
      (Array.isArray(allToolsList) ? allToolsList : []).filter((tool) => tool?.available),
      { keepIds: allKeepIds },
    ),
  );
}

function refreshPrimaryToolPicker({ keepToolIds = [], selectedValue = "" } = {}) {
  toolsList = getVisiblePrimaryToolOptions(keepToolIds);
  const resolvedTool = resolvePreferredToolId(toolsList, [
    selectedValue,
    ...(Array.isArray(keepToolIds) ? keepToolIds : [keepToolIds]),
    selectedTool,
    preferredTool,
  ]);
  renderInlineToolOptions(resolvedTool);
  return resolvedTool;
}

const modelResponseCache = new Map();
const pendingModelResponseRequests = new Map();

async function fetchModelResponse(toolId, { refresh = false } = {}) {
  if (!toolId) {
    return {
      models: [],
      effortLevels: null,
      defaultModel: null,
      reasoning: { kind: "none", label: t("tooling.thinking") },
    };
  }

  if (!refresh && modelResponseCache.has(toolId)) {
    return modelResponseCache.get(toolId);
  }

  if (!refresh && pendingModelResponseRequests.has(toolId)) {
    return pendingModelResponseRequests.get(toolId);
  }

  const request = fetchJsonOrRedirect(`/api/models?tool=${encodeURIComponent(toolId)}`, {
    revalidate: !refresh,
  })
    .then((data) => {
      modelResponseCache.set(toolId, data);
      return data;
    })
    .finally(() => {
      pendingModelResponseRequests.delete(toolId);
    });

  pendingModelResponseRequests.set(toolId, request);
  return request;
}

async function loadInlineTools({ skipModelLoad = false } = {}) {
  try {
    const data = await fetchJsonOrRedirect("/api/tools");
    allToolsList = Array.isArray(data.tools) ? data.tools : [];
    const initialTool = refreshPrimaryToolPicker();
    if (initialTool) {
      selectedTool = initialTool;
      if (!preferredTool) {
        preferredTool = initialTool;
        localStorage.setItem("preferredTool", preferredTool);
      }
    }
    if (!skipModelLoad) {
      await loadModelsForCurrentTool();
    }
  } catch (err) {
    allToolsList = [];
    toolsList = [];
    console.warn("[tools] Failed to load tools:", err.message);
    renderInlineToolOptions("", "Failed to load agents");
  }
}

inlineToolSelect.addEventListener("change", async () => {
  const nextTool = inlineToolSelect.value;
  selectedTool = nextTool;
  preferredTool = selectedTool;
  localStorage.setItem("preferredTool", preferredTool);
  localStorage.setItem("selectedTool", selectedTool);
  await loadModelsForCurrentTool();
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});

// ---- Model select ----
async function loadModelsForCurrentTool({ refresh = false } = {}) {
  const toolId = selectedTool;
  if (!selectedTool) {
    currentToolModels = [];
    currentToolEffortLevels = null;
    currentToolReasoningKind = "none";
    currentToolReasoningLabel = t("tooling.thinking");
    currentToolReasoningDefault = null;
    selectedModel = null;
    selectedEffort = null;
    inlineModelSelect.innerHTML = "";
    inlineModelSelect.style.display = "none";
    thinkingToggle.style.display = "none";
    effortSelect.style.display = "none";
    return;
  }
  try {
    const sessionPreferences = getAttachedSessionToolPreferences(toolId);
    const data = await fetchModelResponse(toolId, { refresh });
    if (selectedTool !== toolId) return;
    currentToolModels = data.models || [];
    currentToolReasoningKind =
      data.reasoning?.kind || (data.effortLevels ? "enum" : "toggle");
    currentToolReasoningLabel = data.reasoning?.label || t("tooling.thinking");
    currentToolReasoningDefault = data.reasoning?.default || null;
    currentToolEffortLevels =
      currentToolReasoningKind === "enum"
        ? data.reasoning?.levels || data.effortLevels || []
        : null;
    thinkingToggle.textContent = currentToolReasoningLabel;

    // Populate model dropdown
    inlineModelSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = t("tooling.defaultModel");
    inlineModelSelect.appendChild(defaultOpt);
    for (const m of currentToolModels) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      inlineModelSelect.appendChild(opt);
    }
    // Restore saved model for this tool
    const savedModel = localStorage.getItem(`selectedModel_${toolId}`) || "";
    const defaultModel = data.defaultModel || "";
    selectedModel = sessionPreferences?.hasModel ? sessionPreferences.model : savedModel;
    if (selectedModel && currentToolModels.some((m) => m.id === selectedModel)) {
      inlineModelSelect.value = selectedModel;
    } else if (defaultModel && currentToolModels.some((m) => m.id === defaultModel)) {
      inlineModelSelect.value = defaultModel;
      selectedModel = defaultModel;
    } else {
      inlineModelSelect.value = "";
      selectedModel = "";
    }
    inlineModelSelect.style.display = currentToolModels.length > 0 ? "" : "none";

    if (currentToolReasoningKind === "enum") {
      thinkingToggle.style.display = "none";
      effortSelect.style.display = "";
      effortSelect.innerHTML = "";
      for (const level of currentToolEffortLevels) {
        const opt = document.createElement("option");
        opt.value = level;
        opt.textContent = level;
        effortSelect.appendChild(opt);
      }

      selectedEffort = sessionPreferences?.hasEffort
        ? sessionPreferences.effort
        : (localStorage.getItem(`selectedEffort_${toolId}`) || "");
      const currentModelData = currentToolModels.find((m) => m.id === selectedModel);
      if (selectedEffort && currentToolEffortLevels.includes(selectedEffort)) {
        effortSelect.value = selectedEffort;
      } else if (currentModelData?.defaultEffort) {
        effortSelect.value = currentModelData.defaultEffort;
        selectedEffort = currentModelData.defaultEffort;
      } else if (
        currentToolReasoningDefault
        && currentToolEffortLevels.includes(currentToolReasoningDefault)
      ) {
        effortSelect.value = currentToolReasoningDefault;
        selectedEffort = currentToolReasoningDefault;
      } else if (currentToolModels[0]?.defaultEffort) {
        effortSelect.value = currentToolModels[0].defaultEffort;
        selectedEffort = currentToolModels[0].defaultEffort;
      } else if (currentToolEffortLevels[0]) {
        effortSelect.value = currentToolEffortLevels[0];
        selectedEffort = currentToolEffortLevels[0];
      }
    } else if (currentToolReasoningKind === "toggle") {
      thinkingToggle.style.display = "";
      effortSelect.style.display = "none";
      selectedEffort = null;
      if (sessionPreferences?.hasThinking) {
        thinkingEnabled = sessionPreferences.thinking;
      }
      updateThinkingUI();
    } else {
      thinkingToggle.style.display = "none";
      effortSelect.style.display = "none";
      selectedEffort = null;
    }
    queueRuntimeSelectionSync();
  } catch {
    currentToolModels = [];
    currentToolEffortLevels = null;
    currentToolReasoningKind = "none";
    inlineModelSelect.style.display = "none";
    thinkingToggle.style.display = "none";
    effortSelect.style.display = "none";
  }
}

inlineModelSelect.addEventListener("change", () => {
  selectedModel = inlineModelSelect.value;
  if (selectedTool) localStorage.setItem(`selectedModel_${selectedTool}`, selectedModel);
  // Update default effort when model changes (enum reasoning tools)
  if (currentToolReasoningKind === "enum" && selectedModel) {
    const modelData = currentToolModels.find((m) => m.id === selectedModel);
    if (modelData?.defaultEffort && !localStorage.getItem(`selectedEffort_${selectedTool}`)) {
      effortSelect.value = modelData.defaultEffort;
      selectedEffort = modelData.defaultEffort;
    }
  }
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});

if (forkSessionBtn) {
  forkSessionBtn.addEventListener("click", forkCurrentSession);
}
if (organizeSessionBtn) {
  organizeSessionBtn.addEventListener("click", organizeCurrentSession);
}
