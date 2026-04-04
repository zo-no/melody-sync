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
      return api.getState();
    },
    updateState(patch = {}) {
      state = cloneStateSnapshot({
        ...state,
        ...patch,
      });
      notify();
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

  root.MelodySyncAppState = api;
})(window);
