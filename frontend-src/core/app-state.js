"use strict";

(function attachMelodySyncAppState(root) {
  const listeners = new Set();
  let state = {
    currentSessionId: null,
    sessions: [],
  };

  function cloneStateSnapshot(value) {
    return {
      currentSessionId: typeof value?.currentSessionId === "string" && value.currentSessionId.trim()
        ? value.currentSessionId.trim()
        : null,
      sessions: Array.isArray(value?.sessions) ? [...value.sessions] : [],
    };
  }

  function notify() {
    const snapshot = cloneStateSnapshot(state);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  const api = Object.freeze({
    getState() {
      return cloneStateSnapshot(state);
    },
    replaceState(nextState = {}) {
      state = cloneStateSnapshot(nextState);
      notify();
      notifyRuntimeBridge("app-state");
      return api.getState();
    },
    updateState(patch = {}) {
      state = cloneStateSnapshot({
        ...state,
        ...patch,
      });
      notify();
      notifyRuntimeBridge("app-state");
      return api.getState();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });

  const bridgeListeners = new Set();

  function getBridgeRoots() {
    return {
      shell: document.body || null,
      sidebarOverlay: document.getElementById("sidebarOverlay"),
      sessionList: document.getElementById("sessionList"),
      messages: document.getElementById("messages"),
      messagesInner: document.getElementById("messagesInner"),
      emptyState: document.getElementById("emptyState"),
      queuedPanel: document.getElementById("queuedPanel"),
      composer: document.getElementById("inputArea"),
      questTracker: document.getElementById("questTracker"),
      taskMapRail: document.getElementById("taskMapRail"),
      taskCanvasPanel: document.getElementById("taskCanvasPanel"),
      operationRecordRail: document.getElementById("operationRecordRail"),
    };
  }

  function getBridgeSnapshot() {
    return {
      appState: api.getState(),
      layout: typeof root.MelodySyncLayout?.getState === "function"
        ? root.MelodySyncLayout.getState()
        : null,
      workbench: typeof root.MelodySyncWorkbench?.getState === "function"
        ? root.MelodySyncWorkbench.getState()
        : null,
      bootstrap: typeof root.MelodySyncBootstrap?.getBootstrap === "function"
        ? root.MelodySyncBootstrap.getBootstrap()
        : null,
      build: typeof root.MelodySyncBootstrap?.getBuildInfo === "function"
        ? root.MelodySyncBootstrap.getBuildInfo()
        : null,
    };
  }

  function notifyRuntimeBridge(reason = "update") {
    const snapshot = getBridgeSnapshot();
    for (const listener of bridgeListeners) {
      try {
        listener(snapshot, reason);
      } catch {}
    }
  }

  function subscribeRuntimeBridge(listener, { immediate = true } = {}) {
    if (typeof listener !== "function") return () => {};
    bridgeListeners.add(listener);
    if (immediate) {
      try {
        listener(getBridgeSnapshot(), "subscribe");
      } catch {}
    }
    return () => {
      bridgeListeners.delete(listener);
    };
  }

  const runtimeBridge = Object.freeze({
    getRoots: getBridgeRoots,
    getSnapshot: getBridgeSnapshot,
    getAppState: () => api.getState(),
    getLayoutState: () => (typeof root.MelodySyncLayout?.getState === "function" ? root.MelodySyncLayout.getState() : null),
    getWorkbenchState: () => (typeof root.MelodySyncWorkbench?.getState === "function" ? root.MelodySyncWorkbench.getState() : null),
    subscribe: subscribeRuntimeBridge,
    notify: notifyRuntimeBridge,
  });

  root.MelodySyncUiBridge = runtimeBridge;
  root.MelodySyncRuntime = runtimeBridge;
  root.MelodySyncAppState = api;
})(window);
