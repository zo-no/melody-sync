(function operationRecordSummaryUiModule() {
  function createFallbackRenderer({
    documentRef = document,
    clipText = (value) => String(value || "").replace(/\s+/g, " ").trim(),
  } = {}) {
    function createPersistentActionButton(label, onClick, { secondary = false } = {}) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = `operation-record-action-btn${secondary ? " is-secondary" : ""}`;
      button.textContent = label;
      button.addEventListener("click", () => onClick?.());
      return button;
    }

    function buildPersistentHeader(data = {}, handlers = {}) {
      const header = documentRef.createElement("div");
      header.className = "operation-record-session-header";

      const title = documentRef.createElement("span");
      title.className = "operation-record-session-title";
      title.textContent = clipText(data.name || "当前任务", 40);
      header.appendChild(title);

      const persistent = data?.persistent || null;
      const actionsEl = documentRef.createElement("div");
      actionsEl.className = "operation-record-actions";
      const kind = String(persistent?.kind || "").trim().toLowerCase();
      const state = String(persistent?.state || "").trim().toLowerCase();

      if (kind === "recurring_task") {
        actionsEl.appendChild(createPersistentActionButton("立即执行", handlers.onRun));
        actionsEl.appendChild(createPersistentActionButton(state === "paused" ? "恢复周期" : "暂停周期", handlers.onToggle, { secondary: true }));
        actionsEl.appendChild(createPersistentActionButton("设置", handlers.onConfigure, { secondary: true }));
      } else if (kind === "skill") {
        actionsEl.appendChild(createPersistentActionButton("触发按钮", handlers.onRun));
        actionsEl.appendChild(createPersistentActionButton("设置", handlers.onConfigure, { secondary: true }));
      } else {
        actionsEl.appendChild(createPersistentActionButton("沉淀为长期项", handlers.onPromote));
      }

      const actionCount = Number(
        actionsEl.childElementCount
        ?? actionsEl.children?.length
        ?? actionsEl.childNodes?.length
        ?? 0
      );
      if (actionCount > 0) {
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

    return Object.freeze({
      buildPersistentHeader,
      buildPersistentDigestCard,
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
    const reactFactory = getWorkbenchReactUi(windowRef)?.createOperationRecordSummaryRenderer;
    if (typeof reactFactory === "function") {
      return reactFactory(options);
    }
    return createFallbackRenderer(options);
  }

  window.MelodySyncOperationRecordSummaryUi = Object.freeze({
    createRenderer,
  });
})();
