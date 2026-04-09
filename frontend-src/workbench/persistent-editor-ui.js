(function persistentEditorUiModule() {
  function createFallbackRenderer({
    documentRef = document,
    cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value))),
    formatRuntimeSummary = (value) => String(value?.tool || "").trim() || "未固定",
    normalizeRecurringCadence = (value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (normalized === "hourly") return "hourly";
      if (normalized === "weekly") return "weekly";
      return "daily";
    },
    normalizeTimeOfDay = (value, fallback = "09:00") => {
      const text = String(value || "").trim();
      return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
    },
    normalizeWeekdays = (value) => (Array.isArray(value) ? value : []),
  } = {}) {
    function clearPersistentEditorModal(host) {
      if (!host) return;
      host.innerHTML = "";
      host.hidden = true;
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

    function buildRuntimeSection({
      host,
      props,
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
      select.addEventListener("change", () => {
        onModeChange?.(select.value);
        renderPersistentEditorModal(host, props);
      });
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
        pinBtn.addEventListener("click", () => {
          onPinCurrent?.();
          renderPersistentEditorModal(host, props);
        });
        runtimeRow.appendChild(pinBtn);

        section.appendChild(runtimeRow);
      }

      return section;
    }

    function buildWeekdayToggle(day, host, props) {
      const labels = ["日", "一", "二", "三", "四", "五", "六"];
      const draft = props?.draft || null;
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "operation-record-weekday-btn";
      const active = normalizeWeekdays(draft?.recurring?.weekdays).includes(day);
      button.classList.toggle("is-active", active);
      button.textContent = labels[day];
      button.addEventListener("click", () => {
        if (!draft) return;
        const current = new Set(normalizeWeekdays(draft.recurring?.weekdays));
        if (current.has(day)) {
          current.delete(day);
        } else {
          current.add(day);
        }
        draft.recurring.weekdays = Array.from(current).sort((a, b) => a - b);
        renderPersistentEditorModal(host, props);
      });
      return button;
    }

    function renderPersistentEditorModal(host, props = {}) {
      if (!host) return;
      const draft = props?.draft || null;
      const isLoading = props?.isLoading === true || !draft;
      const currentRuntime = props?.currentRuntime || null;
      host.innerHTML = "";
      host.hidden = false;

      const dialog = documentRef.createElement("div");
      dialog.className = "modal persistent-editor-modal";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const header = documentRef.createElement("div");
      header.className = "modal-header persistent-editor-modal-header";

      const title = documentRef.createElement("div");
      title.className = "modal-title persistent-editor-modal-title";
      title.textContent = draft?.mode === "configure" ? "长期项设置" : "沉淀为长期项";
      header.appendChild(title);

      const closeBtn = documentRef.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "modal-close";
      closeBtn.textContent = "×";
      closeBtn.setAttribute("aria-label", "关闭");
      closeBtn.addEventListener("click", () => props?.onClose?.());
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      const lead = documentRef.createElement("div");
      lead.className = "modal-lead persistent-editor-modal-lead";
      lead.textContent = draft
        ? (draft.mode === "configure" ? "只保留类型、名称、摘要和提示词。" : "已根据当前会话自动生成一版长期项摘要。")
        : "正在整理当前会话内容…";
      dialog.appendChild(lead);

      const body = documentRef.createElement("div");
      body.className = "modal-body persistent-editor-modal-body";
      dialog.appendChild(body);

      const footer = documentRef.createElement("div");
      footer.className = "modal-footer persistent-editor-modal-footer";
      dialog.appendChild(footer);

      if (isLoading) {
        const loading = documentRef.createElement("div");
        loading.className = "persistent-editor-modal-loading";
        loading.textContent = "正在加载…";
        body.appendChild(loading);
        host.appendChild(dialog);
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
          renderPersistentEditorModal(host, props);
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
      promptInput.value = draft.runPrompt;
      promptInput.placeholder = "触发时默认要执行什么";
      promptInput.addEventListener("input", () => {
        draft.runPrompt = promptInput.value;
      });
      form.appendChild(buildField("提示词", promptInput));

      const cadence = normalizeRecurringCadence(draft.recurring?.cadence);
      if (draft.kind === "recurring_task") {
        const cadenceSelect = documentRef.createElement("select");
        cadenceSelect.className = "operation-record-persistent-select";
        [
          { value: "hourly", label: "每小时" },
          { value: "daily", label: "每天" },
          { value: "weekly", label: "每周" },
        ].forEach((entry) => {
          const option = documentRef.createElement("option");
          option.value = entry.value;
          option.textContent = entry.label;
          cadenceSelect.appendChild(option);
        });
        cadenceSelect.value = cadence;
        cadenceSelect.addEventListener("change", () => {
          draft.recurring.cadence = cadenceSelect.value;
          renderPersistentEditorModal(host, props);
        });
        form.appendChild(buildField("触发周期", cadenceSelect));

        const timeInput = documentRef.createElement("input");
        timeInput.type = "time";
        timeInput.className = "operation-record-persistent-input";
        timeInput.value = normalizeTimeOfDay(draft.recurring?.timeOfDay);
        timeInput.addEventListener("input", () => {
          draft.recurring.timeOfDay = normalizeTimeOfDay(timeInput.value);
        });
        form.appendChild(buildField(cadence === "hourly" ? "触发分钟" : "触发时间", timeInput));

        if (cadence === "weekly") {
          const weekdayRow = documentRef.createElement("div");
          weekdayRow.className = "operation-record-weekday-row";
          for (let day = 0; day <= 6; day += 1) {
            weekdayRow.appendChild(buildWeekdayToggle(day, host, props));
          }
          form.appendChild(buildField("每周日期", weekdayRow));
        }
      }

      form.appendChild(buildRuntimeSection({
        host,
        props,
        title: "手动触发",
        mode: draft.manualMode,
        allowedModes: ["follow_current", "session_default", "pinned"],
        runtime: draft.manualRuntime,
        onModeChange(value) {
          draft.manualMode = value;
          if (value === "pinned" && !draft.manualRuntime?.tool && currentRuntime?.tool) {
            draft.manualRuntime = cloneJson(currentRuntime);
          }
        },
        onPinCurrent() {
          if (currentRuntime?.tool) {
            draft.manualRuntime = cloneJson(currentRuntime);
          }
        },
      }));

      if (draft.kind === "recurring_task") {
        form.appendChild(buildRuntimeSection({
          host,
          props,
          title: "周期执行",
          mode: draft.scheduleMode,
          allowedModes: ["session_default", "pinned"],
          runtime: draft.scheduleRuntime,
          onModeChange(value) {
            draft.scheduleMode = value;
            if (value === "pinned" && !draft.scheduleRuntime?.tool && currentRuntime?.tool) {
              draft.scheduleRuntime = cloneJson(currentRuntime);
            }
          },
          onPinCurrent() {
            if (currentRuntime?.tool) {
              draft.scheduleRuntime = cloneJson(currentRuntime);
            }
          },
        }));
      }

      body.appendChild(form);

      const cancelBtn = documentRef.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "modal-btn";
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => props?.onClose?.());
      footer.appendChild(cancelBtn);

      const saveBtn = documentRef.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "modal-btn primary";
      saveBtn.textContent = draft.mode === "configure" ? "保存" : "保存为长期项";
      saveBtn.addEventListener("click", () => props?.onSave?.());
      footer.appendChild(saveBtn);

      host.appendChild(dialog);
    }

    return Object.freeze({
      clearPersistentEditorModal,
      renderPersistentEditorModal,
    });
  }

  function getWorkbenchReactUi(windowRef = window) {
    return globalThis?.MelodySyncWorkbenchReactUi
      || windowRef?.MelodySyncWorkbenchReactUi
      || windowRef?.window?.MelodySyncWorkbenchReactUi
      || null;
  }

  function createRenderer(options = {}) {
    const windowRef = options?.windowRef || globalThis?.window || window;
    const reactFactory = getWorkbenchReactUi(windowRef)?.createPersistentEditorRenderer;
    if (typeof reactFactory === "function") {
      return reactFactory(options);
    }
    return createFallbackRenderer(options);
  }

  window.MelodySyncPersistentEditorUi = Object.freeze({
    createRenderer,
  });
})();
