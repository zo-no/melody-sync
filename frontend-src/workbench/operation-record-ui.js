(function operationRecordUiModule() {
  function createController({
    bodyEl = document.body,
    documentRef = document,
    windowRef = window,
    getFocusedSessionId = () => "",
    getFocusedSessionRecord = () => null,
    dispatchAction = null,
  } = {}) {
    let persistentEditor = null;
    let persistentModalNodes = null;

    function normalizeKey(value) {
      return String(value || "").trim().toLowerCase();
    }

    function cloneJson(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function normalizePersistentKind(value) {
      const normalized = normalizeKey(value);
      if (normalized === "recurring_task") return "recurring_task";
      if (normalized === "scheduled_task") return "scheduled_task";
      if (normalized === "waiting_task") return "waiting_task";
      return normalized === "skill" ? "skill" : "recurring_task";
    }

    function normalizeDateTimeLocal(value) {
      const text = String(value || "").trim();
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? text : "";
    }

    function toDateTimeLocalInput(value) {
      const date = value ? new Date(value) : null;
      if (!date || !Number.isFinite(date.getTime())) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hour = String(date.getHours()).padStart(2, "0");
      const minute = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    function getDefaultScheduledRunAtLocal() {
      const next = new Date();
      next.setSeconds(0, 0);
      next.setMinutes(0);
      next.setHours(next.getHours() + 1);
      return toDateTimeLocalInput(next);
    }

    function toIsoFromDateTimeLocal(value) {
      const normalized = normalizeDateTimeLocal(value);
      if (!normalized) return "";
      const date = new Date(normalized);
      return Number.isFinite(date.getTime()) ? date.toISOString() : "";
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

    function normalizeLoopInstruction(value) {
      return String(value || "").trim();
    }

    function normalizeLoopSources(value) {
      const source = Array.isArray(value)
        ? value
        : String(value || "").split(/\n+/);
      const seen = new Set();
      return source
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry && !seen.has(entry.toLowerCase()) && (seen.add(entry.toLowerCase()) || true))
        .slice(0, 8);
    }

    function createLoopDraft(loop = null) {
      const source = loop && typeof loop === "object" && !Array.isArray(loop) ? loop : {};
      return {
        collect: {
          sources: normalizeLoopSources(source?.collect?.sources || []),
          instruction: normalizeLoopInstruction(source?.collect?.instruction || ""),
        },
        organize: {
          instruction: normalizeLoopInstruction(source?.organize?.instruction || ""),
        },
        use: {
          instruction: normalizeLoopInstruction(source?.use?.instruction || ""),
        },
        prune: {
          instruction: normalizeLoopInstruction(source?.prune?.instruction || ""),
        },
      };
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

    function getFocusedSessionData() {
      const session = getFocusedSessionRecord?.();
      return session && typeof session === "object" ? session : {};
    }

    function getCurrentRuntimeSelectionSnapshot() {
      return windowRef?.MelodySyncSessionTooling?.getCurrentRuntimeSelectionSnapshot?.() || null;
    }

    function getSessionRuntimeSnapshot() {
      return normalizeRuntimeSnapshot(getFocusedSessionData());
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
      normalizeDateTimeLocal,
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
        editorStep: options.mode === "configure" ? "details" : "pick_kind",
        sessionId: getFocusedSessionId(),
        kind,
        digestTitle: String(digest?.title || data?.name || "未命名长期项").trim(),
        digestSummary: String(digest?.summary || "").trim(),
        runPrompt: String(
          persistent?.execution?.runPrompt
            || (Array.isArray(digest?.recipe) ? digest.recipe.join("\n") : "")
            || "",
        ).trim(),
        executionMode: String(persistent?.execution?.mode || "").trim().toLowerCase() === "spawn_session"
          ? "spawn_session"
          : "in_place",
        scheduledEnabled: Boolean(
          persistent?.scheduled?.runAt
          || persistent?.scheduled?.nextRunAt
          || kind === "scheduled_task"
        ),
        scheduled: {
          runAtLocal: normalizeDateTimeLocal(
            toDateTimeLocalInput(
              persistent?.scheduled?.nextRunAt
              || persistent?.scheduled?.runAt
              || (kind === "scheduled_task" ? getDefaultScheduledRunAtLocal() : "")
            )
          ) || (kind === "scheduled_task" ? getDefaultScheduledRunAtLocal() : ""),
          timezone: String(
            persistent?.scheduled?.timezone
              || Intl.DateTimeFormat().resolvedOptions().timeZone
              || "",
          ).trim(),
        },
        recurringEnabled: Boolean(
          persistent?.recurring?.timeOfDay
          || kind === "recurring_task"
        ),
        recurring: {
          cadence: normalizeRecurringCadence(persistent?.recurring?.cadence || "daily"),
          timeOfDay: normalizeTimeOfDay(persistent?.recurring?.timeOfDay || "09:00"),
          weekdays: normalizeWeekdays(persistent?.recurring?.weekdays || [1]),
          timezone: String(
            persistent?.recurring?.timezone
              || Intl.DateTimeFormat().resolvedOptions().timeZone
              || "",
          ).trim(),
        },
        loop: createLoopDraft(persistent?.loop),
        knowledgeBasePath: String(
          persistent?.knowledgeBasePath
            || data?.folder
            || ""
        ).trim(),
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
      if (!persistentEditor || persistentEditor.sessionId !== getFocusedSessionId()) {
        persistentEditor = createPersistentEditorDraft(getFocusedSessionData(), nextOptions);
      }
      return persistentEditor;
    }

    function clearPersistentEditorModal() {
      const host = persistentModalNodes?.host || null;
      if (!host) return;
      if (persistentEditorRenderer?.clearPersistentEditorModal) {
        persistentEditorRenderer.clearPersistentEditorModal(host);
      } else {
        host.hidden = true;
        host.innerHTML = "";
      }
    }

    function closePersistentEditor() {
      persistentEditor = null;
      clearPersistentEditorModal();
    }

    function validatePersistentEditorDraft(draft) {
      if (!draft) return "缺少长期项配置";
      if (!String(draft.digestTitle || "").trim()) return "请填写长期项名称";
      if (draft.kind === "scheduled_task") {
        if (!draft.scheduledEnabled || !toIsoFromDateTimeLocal(draft.scheduled?.runAtLocal)) {
          return "短期任务需要有效的定时触发时间";
        }
      }
      if (draft.kind === "recurring_task") {
        if (!draft.recurringEnabled) {
          return "长期任务需要有效的循环触发配置";
        }
        if (!/^\d{2}:\d{2}$/.test(String(draft.recurring?.timeOfDay || "").trim())) {
          return "长期任务需要有效的执行时间";
        }
        if (normalizeRecurringCadence(draft.recurring?.cadence) === "weekly" && normalizeWeekdays(draft.recurring?.weekdays).length === 0) {
          return "每周周期至少选择一天";
        }
      }
      if (draft.scheduledEnabled && !toIsoFromDateTimeLocal(draft.scheduled?.runAtLocal)) {
        return "请填写有效的定时触发时间";
      }
      if (draft.recurringEnabled) {
        if (!/^\d{2}:\d{2}$/.test(String(draft.recurring?.timeOfDay || "").trim())) {
          return "请填写有效的循环触发时间";
        }
        if (normalizeRecurringCadence(draft.recurring?.cadence) === "weekly" && normalizeWeekdays(draft.recurring?.weekdays).length === 0) {
          return "每周循环至少选择一天";
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
      if (draft.kind !== "skill") {
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
          mode: draft.executionMode === "spawn_session" ? "spawn_session" : "in_place",
          runPrompt: String(draft.runPrompt || "").trim(),
        },
        runtimePolicy: buildRuntimePolicyPayload(draft),
      };
      if (draft.kind !== "skill") {
        const knowledgeBasePath = String(draft.knowledgeBasePath || "").trim();
        if (knowledgeBasePath) {
          payload.knowledgeBasePath = knowledgeBasePath;
        }
        if (draft.scheduledEnabled) {
          payload.scheduled = {
            runAt: toIsoFromDateTimeLocal(draft.scheduled?.runAtLocal),
            timezone: String(draft.scheduled?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "").trim(),
          };
        } else {
          payload.scheduled = null;
        }
        if (draft.recurringEnabled) {
          payload.recurring = {
            cadence: normalizeRecurringCadence(draft.recurring?.cadence),
            timeOfDay: normalizeTimeOfDay(draft.recurring?.timeOfDay),
            weekdays: normalizeRecurringCadence(draft.recurring?.cadence) === "weekly"
              ? normalizeWeekdays(draft.recurring?.weekdays)
              : [],
            timezone: String(draft.recurring?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "").trim(),
          };
        } else {
          payload.recurring = null;
        }
        payload.loop = {
          collect: {
            sources: normalizeLoopSources(draft.loop?.collect?.sources || []),
            instruction: normalizeLoopInstruction(draft.loop?.collect?.instruction || ""),
          },
          organize: {
            instruction: normalizeLoopInstruction(draft.loop?.organize?.instruction || ""),
          },
          use: {
            instruction: normalizeLoopInstruction(draft.loop?.use?.instruction || ""),
          },
          prune: {
            instruction: normalizeLoopInstruction(draft.loop?.prune?.instruction || ""),
          },
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

    function ensurePersistentModalNodes() {
      if (persistentModalNodes) return persistentModalNodes;
      const host = documentRef.createElement("div");
      host.className = "operation-record-persistent-host";
      host.hidden = true;
      host.addEventListener?.("click", (event) => {
        if (event?.target !== host) return;
        closePersistentEditor();
      });
      bodyEl?.appendChild?.(host);
      persistentModalNodes = { host };
      return persistentModalNodes;
    }

    function renderPersistentEditorModal(data = getFocusedSessionData()) {
      const nodes = ensurePersistentModalNodes();
      if (!persistentEditor) {
        clearPersistentEditorModal();
        return;
      }
      const draft = ensurePersistentEditor({ mode: data?.persistent ? "configure" : "promote" });
      const currentRuntime = getCurrentRuntimeSelectionSnapshot() || getSessionRuntimeSnapshot();
      nodes.host.hidden = false;
      persistentEditorRenderer?.renderPersistentEditorModal?.(nodes.host, {
        draft,
        currentRuntime,
        onClose: () => {
          closePersistentEditor();
        },
        onSave: async () => {
          const nextDraft = ensurePersistentEditor({ mode: data?.persistent ? "configure" : "promote" });
          const validationError = validatePersistentEditorDraft(nextDraft);
          if (validationError) {
            showActionError(validationError);
            return;
          }
          const payload = buildPersistentPayload(nextDraft);
          const ok = await dispatchPersistent(
            nextDraft.mode === "configure"
              ? {
                  action: "persistent_patch",
                  sessionId: getFocusedSessionId(),
                  persistent: payload,
                }
              : {
                  action: "persistent_promote",
                  sessionId: getFocusedSessionId(),
                  ...payload,
                },
          );
          if (ok !== false) {
            closePersistentEditor();
          }
        },
      });
    }

    function handleFocusChange() {
      if (!persistentEditor) return Promise.resolve();
      if (persistentEditor.sessionId !== getFocusedSessionId()) {
        closePersistentEditor();
        return Promise.resolve();
      }
      renderPersistentEditorModal(getFocusedSessionData());
      return Promise.resolve();
    }

    function refreshIfOpen() {
      if (persistentEditor) {
        renderPersistentEditorModal(getFocusedSessionData());
      }
      return Promise.resolve();
    }

    documentRef.addEventListener?.("keydown", (event) => {
      if (event.key !== "Escape" || !persistentEditor) return;
      closePersistentEditor();
    });

    return {
      isOpen: () => false,
      setOpen() {
        return Promise.resolve();
      },
      render() {
        return Promise.resolve();
      },
      handleFocusChange,
      refreshIfOpen,
      openPersistentEditor(options = {}) {
        const sessionId = getFocusedSessionId();
        if (!sessionId) return Promise.resolve();
        persistentEditor = createPersistentEditorDraft(getFocusedSessionData(), options);
        renderPersistentEditorModal(getFocusedSessionData());
        return Promise.resolve();
      },
    };
  }

  window.MelodySyncOperationRecordUi = Object.freeze({
    createController,
  });
})();
