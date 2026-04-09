(function operationRecordUiModule() {
  function fallbackClipText(value, max = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function fallbackFormatTrackerTime(value) {
    if (!value) return "";
    const ts = new Date(typeof value === "number" ? value : value).getTime();
    if (!Number.isFinite(ts)) return "";
    const date = new Date(ts);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}`;
  }

  function createController({
    bodyEl = document.body,
    documentRef = document,
    windowRef = window,
    operationRecordBtn = null,
    operationRecordRail = null,
    operationRecordBackdrop = null,
    operationRecordCloseBtn = null,
    operationRecordInner = null,
    getFocusedSessionId = () => "",
    getFocusedSessionRecord = () => null,
    attachSession = null,
    dispatchAction = null,
    clipText = fallbackClipText,
    formatTrackerTime = fallbackFormatTrackerTime,
    fetchImpl = typeof fetch === "function" ? (...args) => fetch(...args) : null,
  } = {}) {
    let open = false;
    let fetchInFlight = null;
    let expanded = new Map();
    let latestData = null;
    let persistentEditor = null;
    let persistentModalNodes = null;

    function normalizeKey(value) {
      return String(value || "").trim().toLowerCase();
    }

    function cloneJson(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function normalizePersistentKind(value) {
      return normalizeKey(value) === "recurring_task" ? "recurring_task" : "skill";
    }

    function normalizeRecurringCadence(value) {
      const normalized = normalizeKey(value);
      if (normalized === "hourly") return "hourly";
      if (normalized === "weekly") return "weekly";
      return "daily";
    }

    function normalizeTimeOfDay(value, fallback = "09:00") {
      const text = String(value || "").trim();
      if (/^\d{1,2}:\d{2}$/.test(text)) {
        const [hourText, minuteText] = text.split(":");
        const hour = Number.parseInt(hourText, 10);
        const minute = Number.parseInt(minuteText, 10);
        if (Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
          return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        }
      }
      return fallback;
    }

    function normalizeWeekdays(value) {
      const source = Array.isArray(value) ? value : [];
      const seen = new Set();
      return source
        .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
        .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6 && !seen.has(entry) && (seen.add(entry) || true))
        .sort((a, b) => a - b);
    }

    function normalizeRuntimeMode(value, allowedModes, fallback) {
      const normalized = normalizeKey(value).replace(/[\s-]+/g, "_");
      return allowedModes.includes(normalized) ? normalized : fallback;
    }

    function normalizeRuntimeSnapshot(value, fallback = null) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const fallbackSource = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
      const requestedTool = String(source.tool || "").trim();
      const fallbackTool = String(fallbackSource.tool || "").trim();
      const tool = requestedTool || fallbackTool;
      if (!tool) return null;
      const canInheritFallback = !requestedTool || requestedTool === fallbackTool;
      return {
        tool,
        model: String(source.model || (canInheritFallback ? fallbackSource.model || "" : "")).trim(),
        effort: String(source.effort || (canInheritFallback ? fallbackSource.effort || "" : "")).trim(),
        thinking: Object.prototype.hasOwnProperty.call(source, "thinking")
          ? source.thinking === true
          : (canInheritFallback ? fallbackSource.thinking === true : false),
      };
    }

    function getCurrentRuntimeSelectionSnapshot() {
      return windowRef?.MelodySyncSessionTooling?.getCurrentRuntimeSelectionSnapshot?.() || null;
    }

    function getSessionRuntimeSnapshot() {
      return normalizeRuntimeSnapshot(getFocusedSessionRecord?.() || null);
    }

    function getDigestPreview(data = {}) {
      return data?.persistent?.digest || data?.persistentPreview || null;
    }

    function formatRuntimeSummary(runtime) {
      if (!runtime?.tool) return "未固定";
      const parts = [runtime.tool];
      if (runtime.model) parts.push(runtime.model);
      if (runtime.effort) parts.push(`思考 ${runtime.effort}`);
      if (runtime.thinking === true && !runtime.effort) parts.push("思考开启");
      return parts.join(" · ");
    }

    const persistentEditorRenderer = windowRef?.MelodySyncPersistentEditorUi?.createRenderer?.({
      documentRef,
      windowRef,
      cloneJson,
      formatRuntimeSummary,
      normalizeRecurringCadence,
      normalizeTimeOfDay,
      normalizeWeekdays,
    }) || null;
    const operationRecordSummaryRenderer = windowRef?.MelodySyncOperationRecordSummaryUi?.createRenderer?.({
      documentRef,
      windowRef,
      clipText,
    }) || null;
    const operationRecordListRenderer = windowRef?.MelodySyncOperationRecordListUi?.createRenderer?.({
      documentRef,
      windowRef,
      clipText,
      formatTrackerTime,
      attachSession,
      getFocusedSessionId,
    }) || null;

    function createPersistentEditorDraft(data = {}, options = {}) {
      const persistent = data?.persistent || null;
      const digest = getDigestPreview(data) || {};
      const sessionRuntime = getSessionRuntimeSnapshot();
      const currentRuntime = getCurrentRuntimeSelectionSnapshot() || sessionRuntime;
      const kind = normalizePersistentKind(options.kind || persistent?.kind || "skill");
      const manualMode = normalizeRuntimeMode(
        persistent?.runtimePolicy?.manual?.mode || "",
        ["follow_current", "session_default", "pinned"],
        "follow_current",
      );
      const scheduleMode = normalizeRuntimeMode(
        persistent?.runtimePolicy?.schedule?.mode || "",
        ["session_default", "pinned"],
        "pinned",
      );
      return {
        mode: options.mode === "configure" ? "configure" : "promote",
        sessionId: getFocusedSessionId(),
        kind,
        digestTitle: String(digest?.title || data?.name || "未命名长期项").trim(),
        digestSummary: String(digest?.summary || "").trim(),
        runPrompt: String(
          persistent?.execution?.runPrompt
            || (Array.isArray(digest?.recipe) ? digest.recipe.join("\n") : "")
            || "",
        ).trim(),
        recurring: {
          cadence: normalizeRecurringCadence(persistent?.recurring?.cadence || "daily"),
          timeOfDay: normalizeTimeOfDay(persistent?.recurring?.timeOfDay || "09:00"),
          weekdays: normalizeWeekdays(
            persistent?.recurring?.weekdays
              || [1],
          ),
          timezone: String(
            persistent?.recurring?.timezone
              || Intl.DateTimeFormat().resolvedOptions().timeZone
              || "",
          ).trim(),
        },
        manualMode,
        manualRuntime: normalizeRuntimeSnapshot(persistent?.runtimePolicy?.manual?.runtime, currentRuntime || sessionRuntime),
        scheduleMode,
        scheduleRuntime: normalizeRuntimeSnapshot(persistent?.runtimePolicy?.schedule?.runtime, currentRuntime || sessionRuntime),
      };
    }

    function ensurePersistentEditor(options = {}) {
      const nextOptions = {
        ...options,
        ...(persistentEditor?.mode ? { mode: persistentEditor.mode } : {}),
        ...(persistentEditor?.kind ? { kind: persistentEditor.kind } : {}),
      };
      if (!persistentEditor || persistentEditor.sessionId !== getFocusedSessionId() || persistentEditor.pendingSeed === true) {
        persistentEditor = createPersistentEditorDraft(latestData || {}, nextOptions);
      }
      return persistentEditor;
    }

    function closePersistentEditor() {
      persistentEditor = null;
      if (persistentModalNodes) {
        if (persistentEditorRenderer?.clearPersistentEditorModal) {
          persistentEditorRenderer.clearPersistentEditorModal(persistentModalNodes.backdrop);
        } else {
          persistentModalNodes.backdrop.hidden = true;
          persistentModalNodes.backdrop.innerHTML = "";
        }
      }
      if (latestData) {
        renderLoadedData(latestData);
      }
    }

    function validatePersistentEditorDraft(draft) {
      if (!draft) {
        return "缺少长期项配置";
      }
      if (!String(draft.digestTitle || "").trim()) {
        return "请填写长期项名称";
      }
      if (draft.kind === "recurring_task") {
        if (!/^\d{2}:\d{2}$/.test(String(draft.recurring?.timeOfDay || "").trim())) {
          return "长期任务需要有效的执行时间";
        }
        if (normalizeRecurringCadence(draft.recurring?.cadence) === "weekly" && normalizeWeekdays(draft.recurring?.weekdays).length === 0) {
          return "每周周期至少选择一天";
        }
      }
      return "";
    }

    function buildRuntimePolicyPayload(draft) {
      const policy = {
        manual: {
          mode: draft.manualMode,
          ...(draft.manualMode === "pinned" && draft.manualRuntime ? { runtime: cloneJson(draft.manualRuntime) } : {}),
        },
      };
      if (draft.kind === "recurring_task") {
        policy.schedule = {
          mode: draft.scheduleMode,
          ...(draft.scheduleMode === "pinned" && draft.scheduleRuntime ? { runtime: cloneJson(draft.scheduleRuntime) } : {}),
        };
      }
      return policy;
    }

    function buildPersistentPayload(draft) {
      const payload = {
        kind: draft.kind,
        digest: {
          title: String(draft.digestTitle || "").trim(),
          summary: String(draft.digestSummary || "").trim(),
        },
        execution: {
          runPrompt: String(draft.runPrompt || "").trim(),
        },
        runtimePolicy: buildRuntimePolicyPayload(draft),
      };
      if (draft.kind === "recurring_task") {
        payload.recurring = {
          cadence: normalizeRecurringCadence(draft.recurring?.cadence),
          timeOfDay: normalizeTimeOfDay(draft.recurring?.timeOfDay),
          weekdays: normalizeRecurringCadence(draft.recurring?.cadence) === "weekly"
            ? normalizeWeekdays(draft.recurring?.weekdays)
            : [],
          timezone: String(draft.recurring?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "").trim(),
        };
      }
      return payload;
    }

    function showActionError(message) {
      const text = String(message || "").trim() || "操作失败，请重试";
      if (typeof windowRef?.alert === "function") {
        windowRef.alert(text);
      }
    }

    async function dispatchPersistent(payload) {
      if (typeof dispatchAction !== "function") return false;
      const ok = await dispatchAction(payload);
      if (ok === false) {
        showActionError("操作失败，请重试");
        return false;
      }
      return true;
    }

    async function loadOperationRecordData(sessionId, { force = false } = {}) {
      const targetSessionId = String(sessionId || "").trim();
      if (!targetSessionId || typeof fetchImpl !== "function") return latestData;
      const loadedSessionId = String(latestData?.currentSessionId || latestData?.sessionId || "").trim();
      if (!force && latestData && loadedSessionId === targetSessionId) {
        return latestData;
      }
      if (fetchInFlight) return fetchInFlight;
      fetchInFlight = fetchImpl(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/operation-record`)
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || "Failed to load operation record");
          }
          latestData = data;
          return data;
        })
        .finally(() => {
          fetchInFlight = null;
        });
      return fetchInFlight;
    }

    async function handlePersistentAction(action, data = {}) {
      const sessionId = getFocusedSessionId();
      if (!sessionId || typeof dispatchAction !== "function") return;
      const persistent = data?.persistent || null;
      try {
        if (action === "promote") {
          persistentEditor = createPersistentEditorDraft(data, { mode: "promote" });
          renderPersistentEditorModal(data);
          return;
        }
        if (action === "configure") {
          persistentEditor = createPersistentEditorDraft(data, { mode: "configure" });
          renderPersistentEditorModal(data);
          return;
        }
        if (action === "run") {
          await dispatchPersistent({
            action: "persistent_run",
            sessionId,
            runtime: getCurrentRuntimeSelectionSnapshot() || undefined,
          });
          return;
        }
        if (action === "toggle") {
          await dispatchPersistent({
            action: "persistent_patch",
            sessionId,
            persistent: {
              state: normalizeKey(persistent?.state) === "paused" ? "active" : "paused",
            },
          });
          return;
        }
        if (action === "close-editor") {
          closePersistentEditor();
          return;
        }
        if (action === "save-editor") {
          const draft = ensurePersistentEditor({ mode: persistent ? "configure" : "promote" });
          const validationError = validatePersistentEditorDraft(draft);
          if (validationError) {
            showActionError(validationError);
            return;
          }
          const payload = buildPersistentPayload(draft);
          const ok = await dispatchPersistent(
            draft.mode === "configure"
              ? {
                  action: "persistent_patch",
                  sessionId,
                  persistent: payload,
                }
              : {
                  action: "persistent_promote",
                  sessionId,
                  ...payload,
                },
          );
          if (ok !== false) {
            persistentEditor = null;
            if (persistentModalNodes) {
              if (persistentEditorRenderer?.clearPersistentEditorModal) {
                persistentEditorRenderer.clearPersistentEditorModal(persistentModalNodes.backdrop);
              } else {
                persistentModalNodes.backdrop.hidden = true;
                persistentModalNodes.backdrop.innerHTML = "";
              }
            }
            if (latestData) {
              renderLoadedData(latestData);
            }
          }
        }
      } catch {
        showActionError("操作失败，请重试");
      }
    }

    function ensurePersistentModalNodes() {
      if (persistentModalNodes) return persistentModalNodes;
      const backdrop = documentRef.createElement("div");
      backdrop.className = "modal-backdrop persistent-editor-modal-backdrop";
      backdrop.hidden = true;
      bodyEl?.appendChild?.(backdrop);

      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          closePersistentEditor();
        }
      });

      persistentModalNodes = { backdrop };
      return persistentModalNodes;
    }

    function renderPersistentEditorModal(data = latestData || {}) {
      const nodes = ensurePersistentModalNodes();
      if (!persistentEditor) {
        if (persistentEditorRenderer?.clearPersistentEditorModal) {
          persistentEditorRenderer.clearPersistentEditorModal(nodes.backdrop);
        } else {
          nodes.backdrop.hidden = true;
          nodes.backdrop.innerHTML = "";
        }
        return;
      }

      const seeded = persistentEditor?.pendingSeed === true
        ? latestData && String(latestData?.currentSessionId || latestData?.sessionId || "").trim() === getFocusedSessionId()
        : true;
      const draft = seeded
        ? ensurePersistentEditor({ mode: data?.persistent ? "configure" : "promote" })
        : null;
      const currentRuntime = getCurrentRuntimeSelectionSnapshot() || getSessionRuntimeSnapshot();
      nodes.backdrop.hidden = false;
      if (persistentEditorRenderer?.renderPersistentEditorModal) {
        persistentEditorRenderer.renderPersistentEditorModal(nodes.backdrop, {
          draft,
          isLoading: !draft,
          currentRuntime,
          onClose: () => handlePersistentAction("close-editor", data),
          onSave: () => handlePersistentAction("save-editor", data),
        });
      }
    }

    function buildPersistentHeader(data = {}) {
      return operationRecordSummaryRenderer?.buildPersistentHeader?.(data, {
        onPromote: () => handlePersistentAction("promote", data),
        onRun: () => handlePersistentAction("run", data),
        onToggle: () => handlePersistentAction("toggle", data),
        onConfigure: () => handlePersistentAction("configure", data),
      }) || null;
    }

    function buildPersistentDigestCard(data = {}) {
      return operationRecordSummaryRenderer?.buildPersistentDigestCard?.(data) || null;
    }

    function renderLoadedData(data = {}) {
      latestData = data;
      if (!operationRecordInner) return;
      const currentSessionId = data.currentSessionId || getFocusedSessionId();
      if (persistentEditor && persistentEditor.sessionId !== currentSessionId) {
        persistentEditor = null;
      }

      operationRecordInner.innerHTML = "";
      const header = buildPersistentHeader(data);
      if (header) {
        operationRecordInner.appendChild(header);
      }

      const digestCard = buildPersistentDigestCard(data);
      if (digestCard) {
        operationRecordInner.appendChild(digestCard);
      }

      renderPersistentEditorModal(data);

      if (!data?.items || data.items.length === 0) {
        const empty = documentRef.createElement("div");
        empty.className = "operation-record-empty";
        empty.textContent = "暂无操作记录";
        operationRecordInner.appendChild(empty);
        return;
      }

      seedExpansion(data.items, currentSessionId);
      const listEl = operationRecordListRenderer?.buildItemsList?.({
        items: data.items,
        currentSessionId,
        expanded,
      }) || null;
      if (listEl) {
        operationRecordInner.appendChild(listEl);
      }
    }

    function branchRecordContainsSession(branch, sessionId) {
      if (!branch || !sessionId) return false;
      if (branch.branchSessionId === sessionId) return true;
      return Array.isArray(branch.subBranches)
        && branch.subBranches.some((child) => branchRecordContainsSession(child, sessionId));
    }

    function seedExpansion(items, currentSessionId) {
      const branchItems = Array.isArray(items) ? items.filter((item) => item?.type === "branch") : [];
      const shouldExpandSingleBranch = branchItems.length === 1 && branchItems[0];

      function visit(branch, forceExpand = false) {
        if (!branch) return;
        const expandsCurrentPath = branchRecordContainsSession(branch, currentSessionId);
        const shouldExpand = forceExpand || expandsCurrentPath || (shouldExpandSingleBranch && branchItems[0] === branch);
        if (shouldExpand && !expanded.has(branch.branchSessionId)) {
          expanded.set(branch.branchSessionId, true);
        }
        if (Array.isArray(branch.subBranches)) {
          for (const child of branch.subBranches) {
            visit(child, expandsCurrentPath);
          }
        }
      }

      for (const item of branchItems) {
        visit(item);
      }
    }

    async function render() {
      if (!operationRecordInner) return;
      const sessionId = getFocusedSessionId();
      if (!sessionId) {
        latestData = null;
        persistentEditor = null;
        renderPersistentEditorModal();
        operationRecordInner.innerHTML = "";
        const empty = documentRef.createElement("div");
        empty.className = "operation-record-empty";
        empty.textContent = "没有活跃会话";
        operationRecordInner.appendChild(empty);
        return;
      }

      return loadOperationRecordData(sessionId, { force: true })
        .then((data) => {
          renderLoadedData(data || {});
        })
        .catch(() => {
          latestData = null;
          renderPersistentEditorModal();
          operationRecordInner.innerHTML = "";
          const empty = documentRef.createElement("div");
          empty.className = "operation-record-empty";
          empty.textContent = "加载失败，请重试";
          operationRecordInner.appendChild(empty);
        });
    }

    function setOpen(next) {
      open = next === true;
      if (operationRecordRail) {
        operationRecordRail.hidden = false;
        operationRecordRail.classList.toggle("is-open", open);
        operationRecordRail.setAttribute("aria-hidden", open ? "false" : "true");
      }
      if (operationRecordBackdrop) {
        operationRecordBackdrop.hidden = !open;
      }
      if (operationRecordBtn) {
        operationRecordBtn.setAttribute("aria-expanded", open ? "true" : "false");
      }
      bodyEl?.classList?.toggle?.("operation-record-open", open);
      if (open) {
        return render();
      }
      return Promise.resolve();
    }

    function handleFocusChange() {
      fetchInFlight = null;
      latestData = null;
      if (persistentEditor && persistentEditor.sessionId !== getFocusedSessionId()) {
        persistentEditor = null;
        renderPersistentEditorModal();
      }
      if (open) {
        return render();
      }
      return Promise.resolve();
    }

    function refreshIfOpen() {
      if (open || persistentEditor) {
        return render();
      }
      return Promise.resolve();
    }

    operationRecordBtn?.addEventListener("click", () => setOpen(!open));
    operationRecordBackdrop?.addEventListener("click", () => setOpen(false));
    operationRecordCloseBtn?.addEventListener("click", () => setOpen(false));
    documentRef.addEventListener?.("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (persistentEditor) {
        closePersistentEditor();
        return;
      }
      if (open) setOpen(false);
    });
    if (operationRecordBtn) {
      operationRecordBtn.hidden = false;
    }

    return {
      isOpen: () => open,
      setOpen,
      render,
      handleFocusChange,
      refreshIfOpen,
      async openPersistentEditor(options = {}) {
        const sessionId = getFocusedSessionId();
        if (!sessionId) return Promise.resolve();
        const loadedSessionId = String(latestData?.currentSessionId || latestData?.sessionId || "").trim();
        if (latestData && loadedSessionId === sessionId) {
          persistentEditor = createPersistentEditorDraft(latestData, options);
          renderPersistentEditorModal(latestData);
          return Promise.resolve();
        }
        persistentEditor = {
          sessionId,
          mode: options.mode === "configure" ? "configure" : "promote",
          kind: options.kind || "",
          pendingSeed: true,
        };
        renderPersistentEditorModal();
        return loadOperationRecordData(sessionId, { force: true })
          .then((data) => {
            persistentEditor = createPersistentEditorDraft(data || {}, options);
            if (open) {
              renderLoadedData(data || {});
            } else {
              renderPersistentEditorModal(data || {});
            }
          })
          .catch((error) => {
            closePersistentEditor();
            showActionError(error?.message || "加载长期项设置失败");
          });
      },
    };
  }

  window.MelodySyncOperationRecordUi = Object.freeze({
    createController,
  });
})();
