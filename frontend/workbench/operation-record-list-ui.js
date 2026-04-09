(function operationRecordListUiModule() {
  function createFallbackRenderer({
    documentRef = document,
    windowRef = window,
    clipText = (value) => String(value || "").replace(/\s+/g, " ").trim(),
    formatTrackerTime = () => "",
    attachSession = null,
    getFocusedSessionId = () => "",
  } = {}) {
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
        attachSession?.(targetSessionId, null);
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

    function buildBranchCard(item, currentSessionId, expanded) {
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
      nameSpan.textContent = clipText(item?.name || "", 36);

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
          childrenEl.appendChild(buildBranchCard(subBranch, currentSessionId, expanded));
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
        attachSession?.(item.branchSessionId, null);
      });

      return card;
    }

    function buildItemsList({ items = [], currentSessionId = "", expanded = new Map() } = {}) {
      const listEl = documentRef.createElement("div");
      listEl.className = "operation-record-items";

      for (const item of Array.isArray(items) ? items : []) {
        if (item?.type === "commit") {
          listEl.appendChild(buildCommitItem(item, item.sessionId || currentSessionId, currentSessionId));
        } else if (item?.type === "branch") {
          listEl.appendChild(buildBranchCard(item, currentSessionId, expanded));
        }
      }

      return listEl;
    }

    return Object.freeze({
      buildItemsList,
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
    const reactFactory = getWorkbenchReactUi(windowRef)?.createOperationRecordListRenderer;
    if (typeof reactFactory === "function") {
      return reactFactory(options);
    }
    return createFallbackRenderer(options);
  }

  window.MelodySyncOperationRecordListUi = Object.freeze({
    createRenderer,
  });
})();
