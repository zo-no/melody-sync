"use strict";

(function initRemoteLabTimer() {
  const STORAGE_KEY = "remotelabFocusTimer";
  const DEFAULT_MINUTES = 25;
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 240;
  const TICK_MS = 1000;
  const baseDocumentTitle = document.title || "RemoteLab Chat";

  const timerRoot = document.getElementById("headerTimer");
  const toggleBtn = document.getElementById("timerToggleBtn");
  const toggleLabel = document.getElementById("timerToggleLabel");
  const panel = document.getElementById("timerPanel");
  const readout = document.getElementById("timerReadout");
  const minutesInput = document.getElementById("timerMinutesInput");
  const startBtn = document.getElementById("timerStartBtn");
  const pauseBtn = document.getElementById("timerPauseBtn");
  const resetBtn = document.getElementById("timerResetBtn");
  const hint = document.getElementById("timerHint");
  const presetButtons = Array.from(document.querySelectorAll("[data-timer-preset]"));

  if (
    !timerRoot
    || !toggleBtn
    || !toggleLabel
    || !panel
    || !readout
    || !minutesInput
    || !startBtn
    || !pauseBtn
    || !resetBtn
    || !hint
  ) {
    return;
  }

  let panelOpen = false;
  let tickHandle = null;
  let timerState = hydrateTimerState(loadTimerState());

  function clampMinutes(value, fallback = DEFAULT_MINUTES) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, parsed));
  }

  function minutesToDuration(minutes) {
    return clampMinutes(minutes) * 60 * 1000;
  }

  function durationToMinutes(durationMs) {
    const safeMs = Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : minutesToDuration(DEFAULT_MINUTES);
    return Math.max(MIN_MINUTES, Math.round(safeMs / 60000));
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getDisplayedRemainingMs() {
    if (timerState.running && Number.isFinite(timerState.endsAt)) {
      return Math.max(0, timerState.endsAt - Date.now());
    }
    return Math.max(0, timerState.remainingMs);
  }

  function formatEndTime(timestamp) {
    if (!Number.isFinite(timestamp)) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function loadTimerState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveTimerState() {
    const payload = {
      durationMs: timerState.durationMs,
      remainingMs: timerState.remainingMs,
      endsAt: timerState.endsAt,
      running: timerState.running,
      finished: timerState.finished,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function hydrateTimerState(rawState) {
    const durationMs = minutesToDuration(durationToMinutes(rawState?.durationMs));
    let remainingMs = Number.isFinite(rawState?.remainingMs)
      ? Math.min(durationMs, Math.max(0, rawState.remainingMs))
      : durationMs;
    const running = rawState?.running === true && Number.isFinite(rawState?.endsAt);
    const endsAt = running ? Number(rawState.endsAt) : null;
    const finished = rawState?.finished === true;
    if (running && endsAt <= Date.now()) {
      remainingMs = 0;
      return {
        durationMs,
        remainingMs,
        endsAt: null,
        running: false,
        finished: true,
      };
    }
    if (running) {
      remainingMs = Math.min(durationMs, Math.max(0, endsAt - Date.now()));
    }
    return {
      durationMs,
      remainingMs,
      endsAt,
      running,
      finished: finished && !running && remainingMs === 0,
    };
  }

  function updateDocumentTitle() {
    if (timerState.running) {
      document.title = `[${formatRemaining(getDisplayedRemainingMs())}] ${baseDocumentTitle}`;
      return;
    }
    if (timerState.finished) {
      document.title = `Timer done · ${baseDocumentTitle}`;
      return;
    }
    document.title = baseDocumentTitle;
  }

  function stopTicking() {
    if (!tickHandle) return;
    clearInterval(tickHandle);
    tickHandle = null;
  }

  function notifyTimerFinished() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    const notification = new Notification("RemoteLab Timer", {
      body: "Focus block finished.",
      tag: "remotelab-focus-timer",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  function completeTimer() {
    timerState.running = false;
    timerState.endsAt = null;
    timerState.remainingMs = 0;
    timerState.finished = true;
    stopTicking();
    saveTimerState();
    updateDocumentTitle();
    syncTimerUi();
    notifyTimerFinished();
  }

  function syncTimerUi() {
    const remainingMs = getDisplayedRemainingMs();
    const durationMinutes = durationToMinutes(timerState.durationMs);
    const running = timerState.running;
    const paused = !running && !timerState.finished && remainingMs < timerState.durationMs;

    toggleBtn.classList.toggle("running", running);
    toggleBtn.classList.toggle("paused", paused);
    toggleBtn.classList.toggle("finished", timerState.finished);
    toggleLabel.textContent = timerState.finished
      ? "Done"
      : (running || paused ? formatRemaining(remainingMs) : `${durationMinutes}m`);
    readout.textContent = formatRemaining(remainingMs || 0);
    minutesInput.value = String(durationMinutes);
    toggleBtn.setAttribute("aria-expanded", panelOpen ? "true" : "false");
    panel.hidden = !panelOpen;
    startBtn.disabled = running;
    pauseBtn.disabled = !running;
    startBtn.textContent = timerState.finished ? "Restart" : (paused ? "Resume" : "Start");
    hint.textContent = timerState.finished
      ? "Finished. Reset or start again for the next focus block."
      : (running
        ? `Runs locally in this browser. Ends around ${formatEndTime(timerState.endsAt)}.`
        : (paused
          ? "Paused locally in this browser. Resume when ready."
          : "Runs locally in this browser and survives refreshes."));

    for (const button of presetButtons) {
      const minutes = clampMinutes(button.dataset.timerPreset, DEFAULT_MINUTES);
      button.classList.toggle("active", minutes === durationMinutes);
    }

    updateDocumentTitle();
  }

  function tickTimer() {
    if (!timerState.running) return;
    const remainingMs = Math.max(0, timerState.endsAt - Date.now());
    timerState.remainingMs = remainingMs;
    if (remainingMs <= 0) {
      completeTimer();
      return;
    }
    saveTimerState();
    syncTimerUi();
  }

  function ensureTicking() {
    stopTicking();
    if (!timerState.running) return;
    tickHandle = setInterval(tickTimer, TICK_MS);
  }

  function openPanel() {
    panelOpen = true;
    syncTimerUi();
  }

  function closePanel() {
    panelOpen = false;
    syncTimerUi();
  }

  function setDurationMinutes(minutes) {
    const safeMinutes = clampMinutes(minutes);
    timerState.durationMs = minutesToDuration(safeMinutes);
    timerState.remainingMs = timerState.durationMs;
    timerState.endsAt = null;
    timerState.running = false;
    timerState.finished = false;
    stopTicking();
    saveTimerState();
    syncTimerUi();
  }

  function startTimer() {
    if (timerState.finished || timerState.remainingMs <= 0 || timerState.remainingMs > timerState.durationMs) {
      timerState.remainingMs = timerState.durationMs;
    }
    timerState.finished = false;
    timerState.running = true;
    timerState.endsAt = Date.now() + Math.max(1000, timerState.remainingMs);
    saveTimerState();
    ensureTicking();
    syncTimerUi();
  }

  function pauseTimer() {
    if (!timerState.running) return;
    timerState.remainingMs = getDisplayedRemainingMs();
    timerState.running = false;
    timerState.endsAt = null;
    stopTicking();
    saveTimerState();
    syncTimerUi();
  }

  function resetTimer() {
    timerState.running = false;
    timerState.endsAt = null;
    timerState.remainingMs = timerState.durationMs;
    timerState.finished = false;
    stopTicking();
    saveTimerState();
    syncTimerUi();
  }

  toggleBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (panelOpen) closePanel();
    else openPanel();
  });

  for (const button of presetButtons) {
    button.addEventListener("click", () => {
      setDurationMinutes(button.dataset.timerPreset);
    });
  }

  minutesInput.addEventListener("change", () => {
    setDurationMinutes(minutesInput.value);
  });
  minutesInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setDurationMinutes(minutesInput.value);
  });

  startBtn.addEventListener("click", () => {
    startTimer();
  });
  pauseBtn.addEventListener("click", () => {
    pauseTimer();
  });
  resetBtn.addEventListener("click", () => {
    resetTimer();
  });

  document.addEventListener("click", (event) => {
    if (!panelOpen) return;
    if (timerRoot.contains(event.target)) return;
    closePanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (timerState.running) {
      tickTimer();
      return;
    }
    if (!document.hidden) updateDocumentTitle();
  });

  ensureTicking();
  syncTimerUi();

  window.RemoteLabTimer = {
    getState() {
      return {
        ...timerState,
        remainingMs: getDisplayedRemainingMs(),
      };
    },
    setDurationMinutes,
    startTimer,
    pauseTimer,
    resetTimer,
    openPanel,
    closePanel,
  };
})();
