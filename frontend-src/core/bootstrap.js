"use strict";

const bootstrapStore = window.MelodySyncBootstrap;
const buildInfo = bootstrapStore?.getBuildInfo?.() || {};
const pageBootstrap = bootstrapStore?.getBootstrap?.() || {};
const buildAssetVersion = buildInfo.assetVersion || "dev";
const bootstrapT = window.melodySyncT || ((key) => key);
const appStateStore = window.MelodySyncAppState || null;

function normalizeBootstrapText(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized || "";
}

function normalizeBootstrapAuthInfo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = "owner";
  const preferredLanguage = normalizeBootstrapText(raw.preferredLanguage);
  return preferredLanguage ? { role, preferredLanguage } : { role };
}

const bootstrapAuthInfo = normalizeBootstrapAuthInfo(pageBootstrap.auth);

function normalizeBootstrapAssetUploads(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      enabled: false,
      directUpload: false,
      provider: "",
    };
  }
  return {
    enabled: raw.enabled === true,
    directUpload: raw.directUpload === true,
    provider: normalizeBootstrapText(raw.provider),
  };
}

const bootstrapAssetUploads = normalizeBootstrapAssetUploads(pageBootstrap.assetUploads);

function getBootstrapAuthInfo() {
  return bootstrapAuthInfo ? { ...bootstrapAuthInfo } : null;
}

function getBootstrapAssetUploads() {
  return { ...bootstrapAssetUploads };
}

console.info(
  "MelodySync build",
  buildInfo.title || buildInfo.serviceTitle || buildAssetVersion,
);

let buildRefreshScheduled = false;
let newerBuildInfo = null;
let frontendUpdatePromptDismissed = false;

async function clearFrontendCaches() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(
    () => null,
  );
  if (!registration) return;
  const message = { type: "melodysync:clear-caches" };
  registration.installing?.postMessage(message);
  registration.waiting?.postMessage(message);
  registration.active?.postMessage(message);
}

function updateFrontendRefreshUi() {
  const hasUpdate = !!newerBuildInfo?.assetVersion;
  const showUpdateBanner = hasUpdate && frontendUpdatePromptDismissed !== true;
  document.body?.classList?.toggle?.("frontend-update-banner-active", showUpdateBanner);
  if (frontendUpdateBanner) {
    frontendUpdateBanner.hidden = !showUpdateBanner;
    frontendUpdateBanner.classList.toggle("is-visible", showUpdateBanner);
  }
  if (!refreshFrontendBtn) return;
  refreshFrontendBtn.hidden = !hasUpdate;
  refreshFrontendBtn.classList.toggle("ready", hasUpdate);
  const updateTitle = hasUpdate
    ? bootstrapT("status.frontendUpdateReady")
    : bootstrapT("status.frontendReloadLatest");
  refreshFrontendBtn.title = updateTitle;
  refreshFrontendBtn.setAttribute("aria-label", updateTitle);
  if (!hasUpdate) {
    refreshFrontendBtn.removeAttribute("aria-busy");
  }
}

function hasPendingFrontendWork() {
  const draft = typeof msgInput?.value === "string" ? msgInput.value.trim() : "";
  if (draft) return true;
  if (Array.isArray(pendingImages) && pendingImages.length > 0) return true;
  return composerPendingState?.classList?.contains?.("visible") === true;
}

function shouldAutoReloadForFreshBuild() {
  if (buildRefreshScheduled) return false;
  if (!newerBuildInfo?.assetVersion) return false;
  if (document?.visibilityState !== "hidden") return false;
  if (hasPendingFrontendWork()) return false;
  return sessionStatus !== "running";
}

async function maybeAutoReloadForFreshBuild(nextBuildInfo = newerBuildInfo) {
  if (!nextBuildInfo?.assetVersion) return false;
  if (!shouldAutoReloadForFreshBuild()) return false;
  return reloadForFreshBuild(nextBuildInfo);
}

async function reloadForFreshBuild(nextBuildInfo) {
  if (buildRefreshScheduled) return;
  buildRefreshScheduled = true;
  refreshFrontendBtn?.setAttribute("aria-busy", "true");
  console.info(
    "MelodySync frontend updated; reloading",
    nextBuildInfo?.title ||
      newerBuildInfo?.title ||
      nextBuildInfo?.assetVersion ||
      newerBuildInfo?.assetVersion ||
      "unknown",
  );
  try {
    await clearFrontendCaches();
  } catch {}
  window.location.reload();
  return true;
}

async function applyBuildInfo(nextBuildInfo) {
  if (buildRefreshScheduled) return false;
  if (!nextBuildInfo?.assetVersion) {
    return false;
  }
  if (nextBuildInfo.assetVersion === buildAssetVersion) {
    if (!buildRefreshScheduled) {
      newerBuildInfo = null;
      frontendUpdatePromptDismissed = false;
      updateFrontendRefreshUi();
    }
    return false;
  }
  newerBuildInfo = nextBuildInfo;
  frontendUpdatePromptDismissed = false;
  updateFrontendRefreshUi();
  return maybeAutoReloadForFreshBuild(nextBuildInfo);
}

window.MelodySyncBuild = {
  applyBuildInfo,
  reloadForFreshBuild,
};

// ---- Elements ----
const menuBtn = document.getElementById("menuBtn");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const sidebarResizeHandle = document.getElementById("sidebarResizeHandle");
const closeSidebar = document.getElementById("closeSidebar");
const sidebarGroupingToolbar = document.getElementById("sidebarGroupingToolbar");
const sidebarGroupingModeUserBtn = document.getElementById("sidebarGroupingModeUser");
const sidebarGroupingModeAiBtn = document.getElementById("sidebarGroupingModeAi");
const sidebarBranchVisibilityToggleBtn = document.getElementById("sidebarBranchVisibilityToggle");
const sidebarGroupingConfigBtn = document.getElementById("sidebarGroupingConfigBtn");
const sessionList = document.getElementById("sessionList");
const sessionListFooter = document.getElementById("sessionListFooter");
const sortSessionListBtn = document.getElementById("sortSessionListBtn");
const newSessionBtn = document.getElementById("newSessionBtn");
const hooksSettingsBtn = document.getElementById("hooksSettingsBtn");
const messagesEl = document.getElementById("messages");
const messagesInner = document.getElementById("messagesInner");
const emptyState = document.getElementById("emptyState");
const queuedPanel = document.getElementById("queuedPanel");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const headerTitle = document.getElementById("headerTitle");
const refreshFrontendBtn = document.getElementById("refreshFrontendBtn");
const frontendUpdateBanner = document.getElementById("frontendUpdateBanner");
const frontendUpdateReloadBtn = document.getElementById("frontendUpdateReloadBtn");
const frontendUpdateDismissBtn = document.getElementById("frontendUpdateDismissBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const imgBtn = document.getElementById("imgBtn");
const imgFileInput = document.getElementById("imgFileInput");
const imgPreviewStrip = document.getElementById("imgPreviewStrip");
const inlineToolSelect = document.getElementById("inlineToolSelect");
const inlineModelSelect = document.getElementById("inlineModelSelect");
const effortSelect = document.getElementById("effortSelect");
const thinkingToggle = document.getElementById("thinkingToggle");
const cancelBtn = document.getElementById("cancelBtn");
const contextTokens = document.getElementById("contextTokens");
const tabSessions = document.getElementById("tabSessions");
const inputArea = document.getElementById("inputArea");
const composerPendingState = document.getElementById("composerPendingState");
const inputResizeHandle = document.getElementById("inputResizeHandle");

refreshFrontendBtn?.addEventListener("click", () => {
  void reloadForFreshBuild(newerBuildInfo);
});
frontendUpdateReloadBtn?.addEventListener("click", () => {
  void reloadForFreshBuild(newerBuildInfo);
});
frontendUpdateDismissBtn?.addEventListener("click", () => {
  frontendUpdatePromptDismissed = true;
  updateFrontendRefreshUi();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  void maybeAutoReloadForFreshBuild(newerBuildInfo);
});
updateFrontendRefreshUi();

let ws = null;
let pendingImages = [];
const ACTIVE_SESSION_STORAGE_KEY = "activeSessionId";
const ACTIVE_SIDEBAR_TAB_STORAGE_KEY = "activeSidebarTab";
const LEGACY_SESSION_SEND_FAILURES_STORAGE_KEY = "sessionSendFailures";
const SESSION_REVIEW_MARKERS_STORAGE_KEY = "sessionReviewedAtById";
const SESSION_REVIEW_BASELINES_STORAGE_KEY = "sessionReviewBaselineAtById";
const SESSION_REVIEW_BASELINE_AT_STORAGE_KEY = "sessionReviewBaselineAt";
const DEFAULT_APP_ID = "chat";
const sessionStateModel = window.MelodySyncSessionStateModel;
if (!sessionStateModel) {
  throw new Error("MelodySyncSessionStateModel must load before bootstrap.js");
}

function normalizeSidebarTab(tab) {
  return "sessions";
}

function normalizeNavigationState(raw) {
  let sessionId = null;
  let tab = null;

  if (raw && typeof raw === "object") {
    if (typeof raw.sessionId === "string") sessionId = raw.sessionId;
    if (typeof raw.tab === "string") tab = raw.tab;
    if (raw.url) {
      try {
        const url = new URL(raw.url, window.location.origin);
        if (!sessionId) sessionId = url.searchParams.get("session") || null;
        if (!tab) tab = url.searchParams.get("tab") || null;
      } catch {}
    }
  }

  return {
    sessionId:
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : null,
    tab: tab ? normalizeSidebarTab(tab) : null,
  };
}

function readNavigationStateFromLocation() {
  return normalizeNavigationState({
    sessionId: new URLSearchParams(window.location.search).get("session"),
    tab: new URLSearchParams(window.location.search).get("tab"),
  });
}

globalThis.readNavigationStateFromLocation = readNavigationStateFromLocation;

try {
  // These filters no longer have UI controls. Clear old persisted values so
  // hidden local state cannot silently hide sessions after a reload.
  localStorage.removeItem("activeAppFilter");
  localStorage.removeItem("activeSourceFilter");
  localStorage.removeItem("activeUserFilter");
} catch {}

let pendingNavigationState = readNavigationStateFromLocation();
let currentSessionId =
  pendingNavigationState.sessionId ||
  localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ||
  null;
let hasAttachedSession = false;
let sessionStatus = "idle";
let reconnectTimer = null;
let sessions = [];
var availableUsers = [];
var hasLoadedUsers = false;
let hasLoadedSessions = false;
let archivedSessionCount = 0;
let archivedSessionsLoaded = false;
let archivedSessionsLoading = false;
let archivedSessionsRefreshPromise = null;
let currentSessionRefreshPromise = null;
let pendingCurrentSessionRefresh = false;
let hasSeenWsOpen = false;
const sidebarSessionRefreshPromises = new Map();
const pendingSidebarSessionRefreshes = new Set();
const jsonResponseCache = new Map();
const eventBodyCache = new Map();
const eventBodyRequests = new Map();
const eventBlockCache = new Map();
const eventBlockRequests = new Map();
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const renderedEventState = {
  sessionId: null,
  latestSeq: 0,
  eventCount: 0,
  eventBaseKeys: [],
  eventKeys: [],
  runState: "idle",
  runningBlockExpanded: false,
};

function syncMelodySyncAppState() {
  appStateStore?.replaceState?.({
    currentSessionId,
    sessions,
  });
}

globalThis.syncMelodySyncAppState = syncMelodySyncAppState;
syncMelodySyncAppState();

function setRunningEventBlockExpanded(sessionId, expanded) {
  if (!sessionId || renderedEventState.sessionId !== sessionId) return;
  renderedEventState.runningBlockExpanded = expanded === true;
}

let currentTokens = 0;

const DEFAULT_TOOL_ID = "codex";
const LEGACY_AUTO_PREFERRED_TOOL_IDS = new Set(["codex", "micro-agent"]);

function normalizeStoredToolId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function derivePreferredToolId(storedPreferredTool, storedLegacySelectedTool) {
  const preferred = normalizeStoredToolId(storedPreferredTool);
  const legacySelected = normalizeStoredToolId(storedLegacySelectedTool);
  if (preferred && !(LEGACY_AUTO_PREFERRED_TOOL_IDS.has(preferred) && !legacySelected)) {
    return preferred;
  }
  if (legacySelected) {
    return legacySelected;
  }
  return null;
}

const storedPreferredTool = normalizeStoredToolId(localStorage.getItem("preferredTool"));
const storedLegacySelectedTool = normalizeStoredToolId(localStorage.getItem("selectedTool"));

let preferredTool = derivePreferredToolId(storedPreferredTool, storedLegacySelectedTool);
let selectedTool = preferredTool;
// Default thinking to enabled; only disable if explicitly set to 'false'
let thinkingEnabled = localStorage.getItem("thinkingEnabled") !== "false";
// Model/effort are stored per-tool: "selectedModel_claude", "selectedModel_codex"
let selectedModel = null;
let selectedEffort = null;
let currentToolModels = []; // model list for current tool
let currentToolEffortLevels = null; // null = binary toggle, string[] = effort dropdown
let currentToolReasoningKind = "toggle";
let currentToolReasoningLabel = "Thinking";
let currentToolReasoningDefault = null;
let allToolsList = [];
let toolsList = [];
let isDesktop = window.matchMedia("(min-width: 768px)").matches;
const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedSessionGroups";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "melodysyncSidebarCollapsed";
let isSavingToolConfig = false;
let collapsedFolders = JSON.parse(
  localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ||
    localStorage.getItem("collapsedFolders") ||
    "{}",
);
let desktopSidebarCollapsed = false;
try {
  desktopSidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === "true";
} catch {}

try {
  localStorage.removeItem(LEGACY_SESSION_SEND_FAILURES_STORAGE_KEY);
} catch {}

let sessionReviewMarkers = readStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, {});
let sessionReviewBaselines = readStoredJsonValue(SESSION_REVIEW_BASELINES_STORAGE_KEY, {});
let sessionReviewBaselineAt = readStoredTimestampValue(SESSION_REVIEW_BASELINE_AT_STORAGE_KEY);
if (!sessionReviewBaselineAt) {
  sessionReviewBaselineAt = new Date().toISOString();
  writeStoredTimestampValue(SESSION_REVIEW_BASELINE_AT_STORAGE_KEY, sessionReviewBaselineAt);
}

function readStoredJsonValue(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJsonValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function normalizeStoredTimestamp(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const time = new Date(trimmed).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function readStoredTimestampValue(key) {
  try {
    return normalizeStoredTimestamp(localStorage.getItem(key));
  } catch {
    return "";
  }
}

function writeStoredTimestampValue(key, value) {
  try {
    const normalized = normalizeStoredTimestamp(value);
    if (normalized) {
      localStorage.setItem(key, normalized);
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

function getSessionReviewedAtTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSessionReviewBaselineAt() {
  return sessionReviewBaselineAt || "";
}

function getLocalSessionReviewedAt(sessionId) {
  if (!sessionId || !sessionReviewMarkers || typeof sessionReviewMarkers !== "object") return "";
  const normalized = normalizeStoredTimestamp(sessionReviewMarkers[sessionId]);
  if (normalized) return normalized;
  if (Object.prototype.hasOwnProperty.call(sessionReviewMarkers, sessionId)) {
    const next = { ...sessionReviewMarkers };
    delete next[sessionId];
    sessionReviewMarkers = next;
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  }
  return "";
}

function getLocalSessionReviewBaselineAt(sessionId) {
  if (!sessionId || !sessionReviewBaselines || typeof sessionReviewBaselines !== "object") return "";
  const normalized = normalizeStoredTimestamp(sessionReviewBaselines[sessionId]);
  if (normalized) return normalized;
  if (Object.prototype.hasOwnProperty.call(sessionReviewBaselines, sessionId)) {
    const next = { ...sessionReviewBaselines };
    delete next[sessionId];
    sessionReviewBaselines = next;
    writeStoredJsonValue(SESSION_REVIEW_BASELINES_STORAGE_KEY, sessionReviewBaselines);
  }
  return "";
}

function setLocalSessionReviewBaselineAt(sessionId, stamp) {
  if (!sessionId) return "";
  const normalized = normalizeStoredTimestamp(stamp);
  if (!normalized) return "";
  const current = getLocalSessionReviewBaselineAt(sessionId);
  if (current) return current;
  sessionReviewBaselines = {
    ...sessionReviewBaselines,
    [sessionId]: normalized,
  };
  writeStoredJsonValue(SESSION_REVIEW_BASELINES_STORAGE_KEY, sessionReviewBaselines);
  return normalized;
}

function getSessionReviewBaselineAtForSession(sessionId, fallbackStamp = "") {
  const normalizedId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedId) {
    return normalizeStoredTimestamp(fallbackStamp) || getSessionReviewBaselineAt();
  }
  const stored = getLocalSessionReviewBaselineAt(normalizedId);
  if (stored) return stored;
  const seeded = setLocalSessionReviewBaselineAt(
    normalizedId,
    normalizeStoredTimestamp(fallbackStamp) || getSessionReviewBaselineAt(),
  );
  return seeded || "";
}

function setLocalSessionReviewedAt(sessionId, stamp) {
  if (!sessionId) return "";
  const normalized = normalizeStoredTimestamp(stamp);
  const current = getLocalSessionReviewedAt(sessionId);
  if (normalized) {
    if (getSessionReviewedAtTime(normalized) <= getSessionReviewedAtTime(current)) {
      return current;
    }
    sessionReviewMarkers = {
      ...sessionReviewMarkers,
      [sessionId]: normalized,
    };
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  } else if (Object.prototype.hasOwnProperty.call(sessionReviewMarkers, sessionId)) {
    const next = { ...sessionReviewMarkers };
    delete next[sessionId];
    sessionReviewMarkers = next;
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  }

  const existing = sessions.find((session) => session.id === sessionId);
  if (existing) {
    if (normalized) {
      existing.localReviewedAt = normalized;
    } else {
      delete existing.localReviewedAt;
    }
    syncMelodySyncAppState();
  }

  return normalized || "";
}
