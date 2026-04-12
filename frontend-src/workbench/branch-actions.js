(function branchActionsUiModule() {
  function createController({
    trackerCloseBtn = null,
    trackerAltBtn = null,
    trackerBackBtn = null,
    trackerFooterEl = null,
    getState = () => ({}),
    getSnapshot = () => null,
    setSnapshot = () => {},
    fetchJsonOrRedirect = null,
    replaceSessionRecord = null,
    fetchSessionsList = null,
    attachSession = null,
    collapseTaskMapAfterAction = null,
    renderTracker = null,
    renderPathPanel = null,
  } = {}) {
    let mergeInFlight = false;

    function syncSnapshot(nextSnapshot) {
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      }
    }

    function refreshAfterMutation() {
      if (typeof renderTracker === "function") {
        renderTracker();
      }
      if (typeof renderPathPanel === "function") {
        renderPathPanel();
      }
    }

    async function refreshSessionList() {
      if (typeof fetchSessionsList === "function") {
        await fetchSessionsList();
      }
    }

    function returnToParentSession() {
      const state = getState();
      if (!state.parentSessionId || typeof attachSession !== "function") return null;
      if (typeof collapseTaskMapAfterAction === "function") {
        collapseTaskMapAfterAction({ render: false });
      }
      attachSession(state.parentSessionId, state.parentSession || null);
      if (typeof renderTracker === "function") {
        renderTracker();
      }
      return state.parentSessionId;
    }

    async function returnToMainline(payload = {}) {
      const state = getState();
      if (!state.hasSession || !state.isBranch || !state.session?.id || typeof fetchJsonOrRedirect !== "function") return null;
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(state.session.id)}/merge-return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      syncSnapshot(response?.snapshot || getSnapshot());
      await refreshSessionList();
      if (response?.session && typeof attachSession === "function") {
        if (typeof collapseTaskMapAfterAction === "function") {
          collapseTaskMapAfterAction({ render: false });
        }
        attachSession(response.session.id, response.session);
      }
      refreshAfterMutation();
      return response?.session || null;
    }

    async function mergeCurrentBranchSummaryAndReturnToMainline() {
      const state = getState();
      if (!state.hasSession || !state.isBranch || !state.session?.id) return null;
      return returnToMainline({
        mergeType: "conclusion",
      });
    }

    async function setCurrentBranchStatus(status, sessionIdOverride = "") {
      const state = getState();
      const targetSessionId = sessionIdOverride || state.session?.id || "";
      const isBranchTarget = sessionIdOverride ? true : state.isBranch;
      if (!targetSessionId || !isBranchTarget || typeof fetchJsonOrRedirect !== "function") return null;
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/branch-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      syncSnapshot(response?.snapshot || getSnapshot());
      if (response?.session && typeof replaceSessionRecord === "function") {
        replaceSessionRecord(response.session);
      }
      await refreshSessionList();
      refreshAfterMutation();
      return response?.session || null;
    }

    async function reopenCurrentBranch() {
      return setCurrentBranchStatus("active");
    }

    async function parkAndReturnToMainline() {
      const state = getState();
      if (!state.hasSession || !state.isBranch) return null;
      await setCurrentBranchStatus("parked");
      return returnToParentSession();
    }

    function resetTrackerButton(button) {
      if (!button) return;
      button.hidden = true;
      button.textContent = "";
      button.title = "";
      button.removeAttribute("aria-label");
      button.disabled = false;
    }

    function syncTrackerButtons(state) {
      const showBranch = Boolean(state?.isBranch && state?.currentGoal);
      const branchStatus = String(state?.branchStatus || "").toLowerCase();

      resetTrackerButton(trackerCloseBtn);
      resetTrackerButton(trackerAltBtn);
      if (trackerBackBtn) {
        trackerBackBtn.disabled = false;
        trackerBackBtn.hidden = !state?.isBranch || !state?.parentSessionId;
      }

      // "收束支线" and "挂起" buttons are removed — branch completion is now done via the
      // circle button in the task list (complete_pending), which auto-merges branch context.
      // Only show "返回主线" for already-resolved/merged/parked branches.
      if (showBranch && ["resolved", "merged", "parked"].includes(branchStatus)) {
        if (trackerAltBtn) {
          trackerAltBtn.hidden = !state?.parentSessionId;
          trackerAltBtn.textContent = "返回主线";
          trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
          trackerAltBtn.title = trackerAltBtn.textContent;
        }
        if (trackerBackBtn) {
          trackerBackBtn.textContent = "继续处理";
        }
      } else if (trackerBackBtn) {
        trackerBackBtn.textContent = showBranch ? "完成当前任务" : "";
      }

      if (trackerFooterEl) {
        trackerFooterEl.classList.toggle("has-actions", Boolean(
          (trackerCloseBtn && !trackerCloseBtn.hidden)
          || (trackerAltBtn && !trackerAltBtn.hidden)
          || (trackerBackBtn && !trackerBackBtn.hidden)
        ));
      }
      if (trackerBackBtn) {
        if (!trackerBackBtn.hidden) {
          trackerBackBtn.setAttribute("aria-label", trackerBackBtn.textContent);
          trackerBackBtn.title = trackerBackBtn.textContent;
        } else {
          trackerBackBtn.removeAttribute("aria-label");
          trackerBackBtn.title = "";
        }
      }
    }

    trackerBackBtn?.addEventListener("click", () => {
      void reopenCurrentBranch();
    });

    trackerAltBtn?.addEventListener("click", () => {
      const state = getState();
      const branchStatus = String(state?.branchStatus || "").toLowerCase();
      if (branchStatus === "active") {
        void parkAndReturnToMainline();
        return;
      }
      returnToParentSession();
    });

    trackerCloseBtn?.addEventListener("click", async () => {
      const state = getState();
      const branchStatus = String(state?.branchStatus || "").toLowerCase();
      if (branchStatus !== "active" || mergeInFlight) return;
      mergeInFlight = true;
      if (typeof renderTracker === "function") {
        renderTracker();
      }
      try {
        await mergeCurrentBranchSummaryAndReturnToMainline();
      } finally {
        mergeInFlight = false;
        if (typeof renderTracker === "function") {
          renderTracker();
        }
      }
    });

    return {
      isMergeInFlight: () => mergeInFlight,
      mergeCurrentBranchSummaryAndReturnToMainline,
      parkAndReturnToMainline,
      reopenCurrentBranch,
      returnToMainline,
      returnToParentSession,
      setCurrentBranchStatus,
      syncTrackerButtons,
    };
  }

  window.MelodySyncBranchActions = Object.freeze({
    createController,
  });
})();
