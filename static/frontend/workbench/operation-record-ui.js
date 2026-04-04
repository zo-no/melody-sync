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
    attachSession = null,
    clipText = fallbackClipText,
    formatTrackerTime = fallbackFormatTrackerTime,
    fetchImpl = typeof fetch === "function" ? (...args) => fetch(...args) : null,
  } = {}) {
    let open = false;
    let fetchInFlight = null;
    let expanded = new Map();

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
        operationRecordInner.innerHTML = "";
        const empty = documentRef.createElement("div");
        empty.className = "operation-record-empty";
        empty.textContent = "没有活跃会话";
        operationRecordInner.appendChild(empty);
        return;
      }

      if (fetchInFlight || typeof fetchImpl !== "function") return fetchInFlight;
      fetchInFlight = fetchImpl(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/operation-record`)
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || "Failed to load operation record");
          }
          return data;
        })
        .then((data) => {
          operationRecordInner.innerHTML = "";
          if (!data?.items || data.items.length === 0) {
            const empty = documentRef.createElement("div");
            empty.className = "operation-record-empty";
            empty.textContent = "暂无操作记录";
            operationRecordInner.appendChild(empty);
            return;
          }

          const sessionHeader = documentRef.createElement("div");
          sessionHeader.className = "operation-record-session-header";
          sessionHeader.textContent = clipText(data.name || "当前任务", 40);
          operationRecordInner.appendChild(sessionHeader);

          const listEl = documentRef.createElement("div");
          listEl.className = "operation-record-items";
          seedExpansion(data.items, data.currentSessionId || sessionId);

          for (const item of data.items) {
            if (item.type === "commit") {
              listEl.appendChild(buildCommitItem(item, data.sessionId, sessionId));
            } else if (item.type === "branch") {
              listEl.appendChild(buildBranchCard(item, sessionId));
            }
          }

          operationRecordInner.appendChild(listEl);
        })
        .catch(() => {
          operationRecordInner.innerHTML = "";
          const empty = documentRef.createElement("div");
          empty.className = "operation-record-empty";
          empty.textContent = "加载失败，请重试";
          operationRecordInner.appendChild(empty);
        })
        .finally(() => {
          fetchInFlight = null;
        });
      return fetchInFlight;
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
      if (open) {
        return render();
      }
      return Promise.resolve();
    }

    function refreshIfOpen() {
      if (open) {
        return render();
      }
      return Promise.resolve();
    }

    operationRecordBtn?.addEventListener("click", () => setOpen(!open));
    operationRecordBackdrop?.addEventListener("click", () => setOpen(false));
    operationRecordCloseBtn?.addEventListener("click", () => setOpen(false));
    documentRef.addEventListener?.("keydown", (event) => {
      if (event.key === "Escape" && open) setOpen(false);
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
    };
  }

  window.MelodySyncOperationRecordUi = Object.freeze({
    createController,
  });
})();
