(function statusCardUiModule() {
  function createFallbackRenderer({
    documentRef = document,
    getCurrentSessionSafe = () => null,
    isSuppressed = () => false,
    enterBranchFromCurrentSession = async () => null,
    clipText: clipTextImpl = (value) => String(value || "").trim(),
  } = {}) {
    function createBranchSuggestionItem(evt) {
      const session = getCurrentSessionSafe();
      if (!session?.id || !evt?.branchTitle || isSuppressed(session.id, evt.branchTitle)) {
        return null;
      }
      const isAutoSuggested = evt?.autoSuggested !== false;
      const intentShift = evt?.intentShift === true;
      const independentGoal = evt?.independentGoal === true;
      if (isAutoSuggested && (!intentShift || !independentGoal)) {
        return null;
      }

      const row = documentRef.createElement("div");
      row.className = "quest-branch-suggestion-item";
      if (isAutoSuggested) {
        row.classList.add("quest-branch-suggestion-item-auto");
      }

      const main = documentRef.createElement("div");
      main.className = "quest-branch-suggestion-main";

      const title = documentRef.createElement("div");
      title.className = "quest-branch-suggestion-title";
      title.textContent = evt.branchTitle;
      main.appendChild(title);

      if (evt.branchReason) {
        const summary = documentRef.createElement("div");
        summary.className = "quest-branch-suggestion-summary";
        summary.textContent = evt.branchReason;
        main.appendChild(summary);
      }

      const actions = documentRef.createElement("div");
      actions.className = "quest-branch-suggestion-actions";

      const enterBtn = documentRef.createElement("button");
      enterBtn.type = "button";
      enterBtn.className = "quest-branch-btn quest-branch-btn-primary";
      enterBtn.textContent = "开启支线";
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
      const card = documentRef.createElement("div");
      card.className = "quest-merge-note";

      const label = documentRef.createElement("div");
      label.className = "quest-merge-note-label";
      label.textContent = evt.mergeType === "conclusion" ? "支线结论已带回主线" : "支线线索已带回主线";
      card.appendChild(label);

      const title = documentRef.createElement("div");
      title.className = "quest-merge-note-title";
      title.textContent = evt.branchTitle || "支线";
      card.appendChild(title);

      const summary = documentRef.createElement("div");
      summary.className = "quest-merge-note-summary";
      summary.textContent = clipTextImpl(evt.broughtBack || evt.content || "", 180);
      card.appendChild(summary);

      if (evt.nextStep) {
        const next = documentRef.createElement("div");
        next.className = "quest-merge-note-next";
        next.textContent = `主线下一步：${evt.nextStep}`;
        card.appendChild(next);
      }
      return card;
    }

    function createBranchEnteredCard(evt) {
      if (!evt?.branchTitle) return null;
      const card = documentRef.createElement("div");
      card.className = "quest-merge-note quest-branch-entered-note";

      const label = documentRef.createElement("div");
      label.className = "quest-merge-note-label";
      label.textContent = "已开启支线任务";
      card.appendChild(label);

      const title = documentRef.createElement("div");
      title.className = "quest-merge-note-title";
      title.textContent = evt.branchTitle;
      card.appendChild(title);

      if (evt.branchFrom) {
        const summary = documentRef.createElement("div");
        summary.className = "quest-merge-note-summary";
        summary.textContent = `来自主线：${evt.branchFrom}`;
        card.appendChild(summary);
      }

      return card;
    }

    return Object.freeze({
      createBranchSuggestionItem,
      createMergeNoteCard,
      createBranchEnteredCard,
    });
  }

  function getWorkbenchReactUi(windowRef = window) {
    return globalThis?.MelodySyncWorkbenchReactUi
      || windowRef?.MelodySyncWorkbenchReactUi
      || windowRef?.window?.MelodySyncWorkbenchReactUi
      || null;
  }

  function canUseReactStatusCardRenderer(options = {}) {
    const documentRef = options?.documentRef || globalThis?.document || document;
    return Boolean(
      documentRef
      && typeof documentRef.querySelector === "function"
      && typeof documentRef.createElement === "function",
    );
  }

  function createRenderer(options = {}) {
    const windowRef = options?.windowRef || globalThis?.window || window;
    const reactFactory = getWorkbenchReactUi(windowRef)?.createStatusCardRenderer;
    if (typeof reactFactory === "function" && canUseReactStatusCardRenderer(options)) {
      return reactFactory(options);
    }
    return createFallbackRenderer(options);
  }

  window.MelodySyncWorkbenchStatusCardUi = Object.freeze({
    createRenderer,
  });
})();
