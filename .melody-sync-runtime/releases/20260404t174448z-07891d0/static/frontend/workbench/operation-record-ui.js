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
      return normalizeKey(value) === "weekly" ? "weekly" : "daily";
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

    function describeRuntimeMode(mode) {
      if (mode === "follow_current") return "跟随当前服务";
      if (mode === "pinned") return "固定为指定服务";
      return "使用该会话默认服务";
    }

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
        persistentModalNodes.backdrop.hidden = true;
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
              persistentModalNodes.backdrop.hidden = true;
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

    function createPersistentActionButton(label, action, { secondary = false } = {}) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = `operation-record-action-btn${secondary ? " is-secondary" : ""}`;
      button.textContent = label;
      button.dataset.action = action;
      return button;
    }

    function buildField(labelText, controlEl, noteText = "") {
      const field = documentRef.createElement("label");
      field.className = "operation-record-persistent-field";

      const labelEl = documentRef.createElement("span");
      labelEl.className = "operation-record-persistent-field-label";
      labelEl.textContent = labelText;
      field.appendChild(labelEl);

      field.appendChild(controlEl);

      if (noteText) {
        const noteEl = documentRef.createElement("span");
        noteEl.className = "operation-record-persistent-field-note";
        noteEl.textContent = noteText;
        field.appendChild(noteEl);
      }

      return field;
    }

    function buildRuntimePolicyLine(label, mode, runtime) {
      const suffix = mode === "pinned" && runtime?.tool
        ? ` · ${formatRuntimeSummary(runtime)}`
        : "";
      return `${label}：${describeRuntimeMode(mode)}${suffix}`;
    }

    function buildRuntimeSection({
      title,
      mode,
      allowedModes,
      runtime,
      onModeChange,
      onPinCurrent,
      note = "",
    } = {}) {
      const section = documentRef.createElement("div");
      section.className = "operation-record-persistent-section";

      const heading = documentRef.createElement("div");
      heading.className = "operation-record-persistent-section-title";
      heading.textContent = title;
      section.appendChild(heading);

      if (note) {
        const noteEl = documentRef.createElement("div");
        noteEl.className = "operation-record-persistent-field-note";
        noteEl.textContent = note;
        section.appendChild(noteEl);
      }

      const select = documentRef.createElement("select");
      select.className = "operation-record-persistent-select";
      const options = [
        { value: "follow_current", label: "跟随当前服务" },
        { value: "session_default", label: "使用该会话默认服务" },
        { value: "pinned", label: "固定为指定服务" },
      ].filter((entry) => allowedModes.includes(entry.value));
      for (const option of options) {
        const optionEl = documentRef.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        select.appendChild(optionEl);
      }
      select.value = allowedModes.includes(mode) ? mode : allowedModes[0];
      select.addEventListener("change", () => onModeChange?.(select.value));
      section.appendChild(buildField("执行服务", select));

      if (mode === "pinned") {
        const runtimeRow = documentRef.createElement("div");
        runtimeRow.className = "operation-record-persistent-runtime-row";

        const summary = documentRef.createElement("div");
        summary.className = "operation-record-persistent-runtime-summary";
        summary.textContent = formatRuntimeSummary(runtime);
        runtimeRow.appendChild(summary);

        const pinBtn = documentRef.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "operation-record-action-btn is-secondary";
        pinBtn.textContent = "使用当前服务";
        pinBtn.addEventListener("click", () => onPinCurrent?.());
        runtimeRow.appendChild(pinBtn);

        section.appendChild(runtimeRow);
      }

      return section;
    }

    function buildWeekdayToggle(day, draft, rerender) {
      const labels = ["日", "一", "二", "三", "四", "五", "六"];
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "operation-record-weekday-btn";
      const active = normalizeWeekdays(draft.recurring?.weekdays).includes(day);
      button.classList.toggle("is-active", active);
      button.textContent = labels[day];
      button.addEventListener("click", () => {
        const current = new Set(normalizeWeekdays(draft.recurring?.weekdays));
        if (current.has(day)) {
          current.delete(day);
        } else {
          current.add(day);
        }
        draft.recurring.weekdays = Array.from(current).sort((a, b) => a - b);
        rerender();
      });
      return button;
    }

    function ensurePersistentModalNodes() {
      if (persistentModalNodes) return persistentModalNodes;
      const backdrop = documentRef.createElement("div");
      backdrop.className = "modal-backdrop persistent-editor-modal-backdrop";
      backdrop.hidden = true;

      const dialog = documentRef.createElement("div");
      dialog.className = "modal persistent-editor-modal";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const header = documentRef.createElement("div");
      header.className = "modal-header persistent-editor-modal-header";

      const title = documentRef.createElement("div");
      title.className = "modal-title persistent-editor-modal-title";
      header.appendChild(title);

      const closeBtn = documentRef.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "modal-close";
      closeBtn.textContent = "×";
      closeBtn.setAttribute("aria-label", "关闭");
      closeBtn.addEventListener("click", () => closePersistentEditor());
      header.appendChild(closeBtn);

      const lead = documentRef.createElement("div");
      lead.className = "modal-lead persistent-editor-modal-lead";

      const body = documentRef.createElement("div");
      body.className = "modal-body persistent-editor-modal-body";

      const footer = documentRef.createElement("div");
      footer.className = "modal-footer persistent-editor-modal-footer";

      dialog.appendChild(header);
      dialog.appendChild(lead);
      dialog.appendChild(body);
      dialog.appendChild(footer);
      backdrop.appendChild(dialog);
      bodyEl?.appendChild?.(backdrop);

      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          closePersistentEditor();
        }
      });

      persistentModalNodes = { backdrop, dialog, title, lead, body, footer };
      return persistentModalNodes;
    }

    function renderPersistentEditorModal(data = latestData || {}) {
      const nodes = ensurePersistentModalNodes();
      if (!persistentEditor) {
        nodes.backdrop.hidden = true;
        return;
      }

      const seeded = persistentEditor?.pendingSeed === true
        ? latestData && String(latestData?.currentSessionId || latestData?.sessionId || "").trim() === getFocusedSessionId()
        : true;
      const draft = seeded
        ? ensurePersistentEditor({ mode: data?.persistent ? "configure" : "promote" })
        : null;
      const currentRuntime = getCurrentRuntimeSelectionSnapshot() || getSessionRuntimeSnapshot();
      const rerender = () => renderPersistentEditorModal(data);

      nodes.title.textContent = draft?.mode === "configure" ? "长期项设置" : "沉淀为长期项";
      nodes.lead.textContent = draft
        ? (draft.mode === "configure" ? "只保留类型、名称、摘要和提示词。" : "已根据当前会话自动生成一版长期项摘要。")
        : "正在整理当前会话内容…";
      nodes.body.innerHTML = "";
      nodes.footer.innerHTML = "";
      nodes.backdrop.hidden = false;

      if (!draft) {
        const loading = documentRef.createElement("div");
        loading.className = "persistent-editor-modal-loading";
        loading.textContent = "正在加载…";
        nodes.body.appendChild(loading);
        return;
      }

      const form = documentRef.createElement("div");
      form.className = "persistent-editor-modal-form";

      const kindRow = documentRef.createElement("div");
      kindRow.className = "operation-record-persistent-kind-row persistent-editor-modal-kind-row";
      [
        { kind: "recurring_task", label: "长期任务" },
        { kind: "skill", label: "快捷按钮" },
      ].forEach((entry) => {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "operation-record-kind-btn";
        button.classList.toggle("is-active", draft.kind === entry.kind);
        button.textContent = entry.label;
        button.addEventListener("click", () => {
          draft.kind = entry.kind;
          if (entry.kind === "recurring_task") {
            if (draft.scheduleMode !== "pinned" && draft.scheduleMode !== "session_default") {
              draft.scheduleMode = currentRuntime?.tool ? "pinned" : "session_default";
            }
            if (draft.scheduleMode === "pinned" && !draft.scheduleRuntime?.tool && currentRuntime?.tool) {
              draft.scheduleRuntime = cloneJson(currentRuntime);
            }
          }
          rerender();
        });
        kindRow.appendChild(button);
      });
      form.appendChild(buildField("类型", kindRow));

      const titleInput = documentRef.createElement("input");
      titleInput.type = "text";
      titleInput.className = "operation-record-persistent-input";
      titleInput.value = draft.digestTitle;
      titleInput.placeholder = "给这个长期项起个名字";
      titleInput.addEventListener("input", () => {
        draft.digestTitle = titleInput.value;
      });
      form.appendChild(buildField("名称", titleInput));

      const summaryInput = documentRef.createElement("textarea");
      summaryInput.className = "operation-record-persistent-textarea";
      summaryInput.rows = 4;
      summaryInput.value = draft.digestSummary;
      summaryInput.placeholder = "保留这次会话沉淀下来的核心摘要";
      summaryInput.addEventListener("input", () => {
        draft.digestSummary = summaryInput.value;
      });
      form.appendChild(buildField("摘要", summaryInput));

      const promptInput = documentRef.createElement("textarea");
      promptInput.className = "operation-record-persistent-textarea";
      promptInput.rows = 4;
      promptInput.placeholder = "触发时默认要执行什么";
      promptInput.value = draft.runPrompt;
      promptInput.addEventListener("input", () => {
        draft.runPrompt = promptInput.value;
      });
      form.appendChild(buildField("提示词", promptInput));

      if (draft.kind === "recurring_task") {
        const cadenceSelect = documentRef.createElement("select");
        cadenceSelect.className = "operation-record-persistent-select";
        [
          { value: "daily", label: "每天" },
          { value: "weekly", label: "每周" },
        ].forEach((entry) => {
          const option = documentRef.createElement("option");
          option.value = entry.value;
          option.textContent = entry.label;
          cadenceSelect.appendChild(option);
        });
        cadenceSelect.value = normalizeRecurringCadence(draft.recurring?.cadence);
        cadenceSelect.addEventListener("change", () => {
          draft.recurring.cadence = cadenceSelect.value;
          rerender();
        });
        form.appendChild(buildField("触发周期", cadenceSelect));

        const timeInput = documentRef.createElement("input");
        timeInput.type = "time";
        timeInput.className = "operation-record-persistent-input";
        timeInput.value = normalizeTimeOfDay(draft.recurring?.timeOfDay);
        timeInput.addEventListener("input", () => {
          draft.recurring.timeOfDay = normalizeTimeOfDay(timeInput.value);
        });
        form.appendChild(buildField("触发时间", timeInput));

        if (normalizeRecurringCadence(draft.recurring?.cadence) === "weekly") {
          const weekdayRow = documentRef.createElement("div");
          weekdayRow.className = "operation-record-weekday-row";
          for (let day = 0; day <= 6; day += 1) {
            weekdayRow.appendChild(buildWeekdayToggle(day, draft, rerender));
          }
          form.appendChild(buildField("每周日期", weekdayRow));
        }
      }

      nodes.body.appendChild(form);

      const cancelBtn = documentRef.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "modal-btn";
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => handlePersistentAction("close-editor", data));
      nodes.footer.appendChild(cancelBtn);

      const saveBtn = documentRef.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "modal-btn primary";
      saveBtn.textContent = draft.mode === "configure" ? "保存" : "保存为长期项";
      saveBtn.addEventListener("click", () => handlePersistentAction("save-editor", data));
      nodes.footer.appendChild(saveBtn);
    }

    function buildPersistentHeader(data = {}) {
      const header = documentRef.createElement("div");
      header.className = "operation-record-session-header";

      const title = documentRef.createElement("span");
      title.className = "operation-record-session-title";
      title.textContent = clipText(data.name || "当前任务", 40);
      header.appendChild(title);

      const persistent = data?.persistent || null;
      const actionsEl = documentRef.createElement("div");
      actionsEl.className = "operation-record-actions";

      if (normalizeKey(persistent?.kind) === "recurring_task") {
        const runBtn = createPersistentActionButton("立即执行", "run");
        const toggleBtn = createPersistentActionButton(
          normalizeKey(persistent?.state) === "paused" ? "恢复周期" : "暂停周期",
          "toggle",
          { secondary: true },
        );
        const configBtn = createPersistentActionButton("设置", "configure", { secondary: true });
        [runBtn, toggleBtn, configBtn].forEach((button) => {
          button.addEventListener("click", () => handlePersistentAction(button.dataset.action, data));
          actionsEl.appendChild(button);
        });
      } else if (normalizeKey(persistent?.kind) === "skill") {
        const runBtn = createPersistentActionButton("触发按钮", "run");
        const configBtn = createPersistentActionButton("设置", "configure", { secondary: true });
        [runBtn, configBtn].forEach((button) => {
          button.addEventListener("click", () => handlePersistentAction(button.dataset.action, data));
          actionsEl.appendChild(button);
        });
      } else {
        const promoteBtn = createPersistentActionButton("沉淀为长期项", "promote");
        promoteBtn.addEventListener("click", () => handlePersistentAction(promoteBtn.dataset.action, data));
        actionsEl.appendChild(promoteBtn);
      }

      if (actionsEl.childNodes.length > 0) {
        header.appendChild(actionsEl);
      }
      return header;
    }

    function buildPersistentDigestCard(data = {}) {
      const persistent = data?.persistent || null;
      const digest = persistent?.digest || data?.persistentPreview || null;
      if (!digest) return null;
      const digestTitle = clipText(digest.title || data?.name || "", 72);
      const summary = clipText(digest.summary || "", 180);
      const keyPoints = Array.isArray(digest.keyPoints) ? digest.keyPoints.filter(Boolean).slice(0, 3) : [];
      if (!digestTitle && !summary && keyPoints.length === 0) return null;

      const card = documentRef.createElement("div");
      card.className = "operation-record-persistent-card";

      const titleEl = documentRef.createElement("div");
      titleEl.className = "operation-record-persistent-summary";
      titleEl.textContent = persistent ? "长期摘要" : "系统摘要预览";
      card.appendChild(titleEl);

      if (digestTitle) {
        const nameEl = documentRef.createElement("div");
        nameEl.className = "operation-record-persistent-list";
        nameEl.textContent = `名称：${digestTitle}`;
        card.appendChild(nameEl);
      }

      if (summary) {
        const summaryEl = documentRef.createElement("div");
        summaryEl.className = "operation-record-persistent-summary";
        summaryEl.textContent = summary;
        card.appendChild(summaryEl);
      }

      if (keyPoints.length > 0) {
        const pointsEl = documentRef.createElement("div");
        pointsEl.className = "operation-record-persistent-list";
        pointsEl.textContent = `核心记录：${keyPoints.join(" · ")}`;
        card.appendChild(pointsEl);
      }

      return card;
    }

    function renderLoadedData(data = {}) {
      latestData = data;
      if (!operationRecordInner) return;
      const currentSessionId = data.currentSessionId || getFocusedSessionId();
      if (persistentEditor && persistentEditor.sessionId !== currentSessionId) {
        persistentEditor = null;
      }

      operationRecordInner.innerHTML = "";
      operationRecordInner.appendChild(buildPersistentHeader(data));

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

      const listEl = documentRef.createElement("div");
      listEl.className = "operation-record-items";
      seedExpansion(data.items, currentSessionId);

      for (const item of data.items) {
        if (item.type === "commit") {
          listEl.appendChild(buildCommitItem(item, data.sessionId, currentSessionId));
        } else if (item.type === "branch") {
          listEl.appendChild(buildBranchCard(item, currentSessionId));
        }
      }

      operationRecordInner.appendChild(listEl);
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

    function getBranchLabel(item, currentSessionId) {
      if (item?.branchSessionId === currentSessionId) return "当前";
      if (item?.status === "merged") return "已收束";
      if (item?.status === "parked") return "已挂起";
      if (item?.status === "resolved") return "已完成";
      return "支线";
    }

    function buildCommitItem(commit, targetSessionId, currentSessionId) {
      const element = documentRef.createElement("div");
      element.className = "operation-record-commit" + (targetSessionId === currentSessionId ? " is-current" : "");
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");

      const timeEl = documentRef.createElement("span");
      timeEl.className = "operation-record-commit-seq";
      timeEl.textContent = formatTrackerTime(commit.timestamp) || `#${commit.seq}`;

      const previewEl = documentRef.createElement("span");
      previewEl.className = "operation-record-commit-preview";
      previewEl.textContent = commit.preview || "(message)";

      element.appendChild(timeEl);
      element.appendChild(previewEl);

      element.addEventListener("click", () => {
        if (typeof attachSession === "function") {
          attachSession(targetSessionId, null);
        }
        const doScroll = () => {
          const msgEl = documentRef.querySelector?.(`.msg-user[data-source-seq="${commit.seq}"]`);
          if (msgEl) msgEl.scrollIntoView({ block: "start", behavior: "smooth" });
        };
        if (targetSessionId === getFocusedSessionId()) {
          doScroll();
        } else {
          const schedule = windowRef?.setTimeout || globalThis.setTimeout;
          schedule?.(doScroll, 400);
        }
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") element.click();
      });
      return element;
    }

    function buildBranchCard(item, currentSessionId) {
      const isExpanded = expanded.get(item.branchSessionId) === true;
      const isActive = item.branchSessionId === currentSessionId;
      const isMerged = item.status === "merged";

      const card = documentRef.createElement("div");
      card.className = "operation-record-branch-card"
        + (isExpanded ? " is-expanded" : "")
        + (isActive ? " is-current" : "")
        + (isMerged ? " is-merged" : "");

      const header = documentRef.createElement("div");
      header.className = "operation-record-branch-card-header";
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");

      const arrow = documentRef.createElement("span");
      arrow.className = "operation-record-branch-arrow";
      arrow.textContent = isExpanded ? "▾" : "▸";

      const label = documentRef.createElement("span");
      label.className = "operation-record-branch-label";
      label.textContent = getBranchLabel(item, currentSessionId);

      const nameSpan = documentRef.createElement("span");
      nameSpan.className = "operation-record-branch-name";
      nameSpan.textContent = clipText(item.name, 36);

      header.appendChild(arrow);
      header.appendChild(label);
      header.appendChild(nameSpan);
      card.appendChild(header);

      if (item.broughtBack) {
        const summary = documentRef.createElement("div");
        summary.className = "operation-record-branch-summary" + (isMerged ? " is-merged" : "");
        summary.textContent = item.broughtBack;
        card.appendChild(summary);
      }

      const commitsEl = documentRef.createElement("div");
      commitsEl.className = "operation-record-branch-commits";
      commitsEl.hidden = !isExpanded;

      if (item.commits && item.commits.length > 0) {
        for (const commit of item.commits) {
          commitsEl.appendChild(buildCommitItem(commit, item.branchSessionId, currentSessionId));
        }
      } else {
        const empty = documentRef.createElement("div");
        empty.className = "operation-record-empty";
        empty.textContent = "暂无消息";
        commitsEl.appendChild(empty);
      }
      card.appendChild(commitsEl);

      if (Array.isArray(item.subBranches) && item.subBranches.length > 0) {
        const childrenEl = documentRef.createElement("div");
        childrenEl.className = "operation-record-children";
        for (const subBranch of item.subBranches) {
          childrenEl.appendChild(buildBranchCard(subBranch, currentSessionId));
        }
        card.appendChild(childrenEl);
      }

      header.addEventListener("click", () => {
        const next = !expanded.get(item.branchSessionId);
        expanded.set(item.branchSessionId, next);
        arrow.textContent = next ? "▾" : "▸";
        commitsEl.hidden = !next;
        card.classList.toggle("is-expanded", next);
      });
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") header.click();
      });

      nameSpan.addEventListener("click", (event) => {
        event.stopPropagation();
        if (typeof attachSession === "function") attachSession(item.branchSessionId, null);
      });

      return card;
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
