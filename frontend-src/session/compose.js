// ---- Send message ----
const fallbackStrings = {
  "compose.pending.uploading": "Uploading attachment\u2026",
  "compose.pending.sendingAttachment": "Sending attachment\u2026",
  "compose.pending.sending": "Sending\u2026",
};

function fallbackTranslate(key) {
  return fallbackStrings[key] || key;
}

function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : fallbackTranslate(key);
}

let pendingComposerSend = null;

function getComposerAssetUploadConfig() {
  return typeof getBootstrapAssetUploads === "function"
    ? getBootstrapAssetUploads()
    : { enabled: false, directUpload: false, provider: "" };
}

function shouldUseDirectComposerAssetUploads() {
  const config = getComposerAssetUploadConfig();
  return config.enabled === true
    && config.directUpload === true
    && typeof fetchJsonOrRedirect === "function";
}

async function uploadComposerAttachmentToAsset(sessionId, attachment) {
  const file = attachment?.file;
  if (!file || typeof file.arrayBuffer !== "function") {
    return attachment;
  }

  const intent = await fetchJsonOrRedirect("/api/assets/upload-intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      originalName: attachment?.originalName || file.name || "attachment",
      mimeType: attachment?.mimeType || file.type || "application/octet-stream",
      sizeBytes: Number.isFinite(file.size) ? file.size : undefined,
    }),
  });

  const asset = intent?.asset && typeof intent.asset === "object"
    ? intent.asset
    : null;
  const upload = intent?.upload && typeof intent.upload === "object"
    ? intent.upload
    : null;
  if (!asset?.id || !upload?.url) {
    throw new Error("Upload intent is incomplete");
  }

  const uploadResponse = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers: upload.headers || {},
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Attachment upload failed (${uploadResponse.status})`);
  }

  const finalized = await fetchJsonOrRedirect(`/api/assets/${encodeURIComponent(asset.id)}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sizeBytes: Number.isFinite(file.size) ? file.size : undefined,
      etag: uploadResponse.headers.get("etag") || "",
    }),
  });

  const finalizedAsset = finalized?.asset && typeof finalized.asset === "object"
    ? finalized.asset
    : asset;
  return {
    assetId: finalizedAsset.id,
    originalName: finalizedAsset.originalName || attachment?.originalName || file.name || "attachment",
    mimeType: finalizedAsset.mimeType || attachment?.mimeType || file.type || "application/octet-stream",
    ...(Number.isFinite(finalizedAsset?.sizeBytes) ? { sizeBytes: finalizedAsset.sizeBytes } : Number.isFinite(file.size) ? { sizeBytes: file.size } : {}),
    ...(attachment?.objectUrl ? { objectUrl: attachment.objectUrl } : {}),
  };
}

async function prepareComposerAttachmentsForSend(sessionId, attachments) {
  if (!shouldUseDirectComposerAssetUploads()) {
    return attachments;
  }

  const prepared = await Promise.all((attachments || []).map(async (attachment) => {
    if (!(attachment && typeof attachment === "object")) return null;
    if (!attachment.file || typeof attachment.assetId === "string") {
      return attachment;
    }
    return uploadComposerAttachmentToAsset(sessionId, attachment);
  }));
  return prepared.filter(Boolean);
}

function hasPendingComposerSend() {
  return !!pendingComposerSend;
}

function isComposerPendingForSession(sessionId = currentSessionId) {
  return !!pendingComposerSend && !!sessionId && pendingComposerSend.sessionId === sessionId;
}

function isComposerPendingForCurrentSession() {
  return isComposerPendingForSession(currentSessionId);
}

function syncComposerPendingUi() {
  const pendingForCurrentSession = isComposerPendingForCurrentSession();
  inputArea.classList.toggle("is-pending-send", pendingForCurrentSession);
  msgInput.readOnly = pendingForCurrentSession;

  if (!composerPendingState) {
    return;
  }
  if (!pendingForCurrentSession) {
    composerPendingState.textContent = "";
    composerPendingState.classList.remove("visible");
    return;
  }

  const hasAttachments = Array.isArray(pendingComposerSend?.images) && pendingComposerSend.images.length > 0;
  composerPendingState.textContent = pendingComposerSend?.stage === "uploading"
    ? t("compose.pending.uploading")
    : (hasAttachments && !pendingComposerSend?.text
      ? t("compose.pending.sendingAttachment")
      : t("compose.pending.sending"));
  composerPendingState.classList.add("visible");
}

function finalizeComposerPendingSend(requestId) {
  if (!pendingComposerSend) return false;
  if (requestId && pendingComposerSend.requestId !== requestId) return false;

  const completedSend = pendingComposerSend;
  pendingComposerSend = null;
  clearDraft(completedSend.sessionId);
  if (currentSessionId === completedSend.sessionId) {
    msgInput.value = "";
    autoResizeInput();
  }
  pendingImages = [];
  renderImagePreviews();
  releaseImageObjectUrls(completedSend.images);
  syncComposerPendingUi();
  return true;
}

function createEmptyComposerActivitySnapshot() {
  return {
    run: {
      state: "idle",
      phase: null,
      runId: null,
    },
    queue: {
      state: "idle",
      count: 0,
    },
  };
}

function getComposerSessionActivitySnapshot(session) {
  const raw = session?.activity || {};
  const queueCount = Number.isInteger(raw?.queue?.count) ? raw.queue.count : 0;
  return {
    run: {
      state: raw?.run?.state === "running" ? "running" : "idle",
      phase: typeof raw?.run?.phase === "string" ? raw.run.phase : null,
      runId: typeof raw?.run?.runId === "string" ? raw.run.runId : null,
    },
    queue: {
      state: raw?.queue?.state === "queued" && queueCount > 0 ? "queued" : "idle",
      count: queueCount,
    },
  };
}

function hasCanonicalComposerSendAcceptance(session) {
  if (!pendingComposerSend) return false;
  if (!session?.id || session.id !== pendingComposerSend.sessionId) return false;

  const queuedMessages = Array.isArray(session.queuedMessages) ? session.queuedMessages : [];
  if (queuedMessages.some((item) => item?.requestId === pendingComposerSend.requestId)) {
    return true;
  }

  const previousActivity = pendingComposerSend.baselineActivity || createEmptyComposerActivitySnapshot();
  const nextActivity = getComposerSessionActivitySnapshot(session);

  if (
    nextActivity.queue.state === "queued"
    && nextActivity.queue.count > (previousActivity.queue?.count || 0)
  ) {
    return true;
  }

  if (previousActivity.run.state !== "running") {
    if (nextActivity.run.state === "running") return true;
    if (nextActivity.run.phase === "accepted" || nextActivity.run.phase === "running") return true;
    if (nextActivity.run.runId && nextActivity.run.runId !== (previousActivity.run?.runId || null)) {
      return true;
    }
  }

  return false;
}

function reconcileComposerPendingSendWithSession(session) {
  if (!pendingComposerSend) return false;
  if (!session?.id || session.id !== pendingComposerSend.sessionId) return false;
  if (!hasCanonicalComposerSendAcceptance(session)) return false;
  return finalizeComposerPendingSend(pendingComposerSend.requestId);
}

function reconcileComposerPendingSendWithEvent(event) {
  if (!pendingComposerSend) return false;
  if (event?.type !== "message" || event.role !== "user") return false;
  if (!event.requestId || event.requestId !== pendingComposerSend.requestId) return false;
  return finalizeComposerPendingSend(event.requestId);
}

function getDraftStorageKey(sessionId = currentSessionId) {
  if (!sessionId) return "";
  return `draft_${sessionId}`;
}

function readStoredDraft(sessionId = currentSessionId) {
  const key = getDraftStorageKey(sessionId);
  if (!key) return "";
  return localStorage.getItem(key) || "";
}

function writeStoredDraft(sessionId = currentSessionId, text = "") {
  const key = getDraftStorageKey(sessionId);
  if (!key) return;
  if (text) {
    localStorage.setItem(key, text);
    return;
  }
  localStorage.removeItem(key);
}

function getComposerDraftText(sessionId = currentSessionId) {
  if (!sessionId) return "";
  if (isComposerPendingForSession(sessionId)) {
    return pendingComposerSend?.text || "";
  }
  return readStoredDraft(sessionId);
}

function sendMessage(existingRequestId) {
  const text = msgInput.value.trim();
  const currentSession = getCurrentSession();
  if (hasPendingComposerSend()) return;
  if ((!text && pendingImages.length === 0) || !currentSessionId || currentSession?.archived) return;

  const requestId = existingRequestId || createRequestId();
  const sessionId = currentSessionId;
  const queuedImages = pendingImages.slice();
  const sendTool = selectedTool;
  const sendModel = selectedModel;
  const sendReasoningKind = currentToolReasoningKind;
  const sendEffort = selectedEffort;
  const sendThinking = thinkingEnabled === true;

  pendingComposerSend = {
    sessionId,
    requestId,
    text,
    images: queuedImages,
    baselineActivity: getComposerSessionActivitySnapshot(currentSession),
    stage: "sending",
  };
  clearDraft(sessionId);
  syncComposerPendingUi();
  autoResizeInput();

  void (async () => {
    let outboundText = text;
    let outboundImages = queuedImages;
    try {
      if (queuedImages.length > 0) {
        pendingComposerSend.stage = "uploading";
        syncComposerPendingUi();
        outboundImages = await prepareComposerAttachmentsForSend(sessionId, queuedImages);
        if (!(pendingComposerSend && pendingComposerSend.requestId === requestId)) return;
        pendingComposerSend.images = outboundImages.slice();
        pendingComposerSend.stage = "sending";
        syncComposerPendingUi();
      }

      const msg = {
        action: "send",
        sessionId,
        text: outboundText || "(attachment)",
      };
      msg.requestId = requestId;
      if (sendTool) msg.tool = sendTool;
      if (sendModel) msg.model = sendModel;
      if (sendReasoningKind === "enum") {
        if (sendEffort) msg.effort = sendEffort;
      } else if (sendReasoningKind === "toggle") {
        msg.thinking = sendThinking;
      }
      if (outboundImages.length > 0) {
        msg.images = outboundImages.map((img) => ({
          ...(img.file ? { file: img.file } : {}),
          ...(img.filename ? { filename: img.filename } : {}),
          ...(img.assetId ? { assetId: img.assetId } : {}),
          ...(img.originalName ? { originalName: img.originalName } : {}),
          ...(img.mimeType ? { mimeType: img.mimeType } : {}),
          ...(Number.isFinite(img?.sizeBytes) ? { sizeBytes: img.sizeBytes } : {}),
          ...(img?.renderAs === "file" ? { renderAs: "file" } : {}),
          ...(img.objectUrl ? { objectUrl: img.objectUrl } : {}),
        }));
      }
      const ok = await dispatchAction(msg);
      if (ok) return;
    } catch (error) {
      console.error("Composer send failed:", error?.message || error);
    }

    const failedText = pendingComposerSend?.requestId === requestId
      ? (pendingComposerSend.text || outboundText || text)
      : (outboundText || text);
    restoreFailedSendState(sessionId, failedText, outboundImages, requestId);
  })();
}

cancelBtn.addEventListener("click", () => dispatchAction({ action: "cancel" }));

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

// ---- Composer height ----
const INPUT_MIN_LINES = 3;
const INPUT_AUTO_MAX_LINES = 10;
const INPUT_MANUAL_MIN_H = 100;
const INPUT_MAX_VIEWPORT_RATIO = 0.72;
const INPUT_HEIGHT_STORAGE_KEY = "msgInputHeight";
const LEGACY_INPUT_AREA_HEIGHT_STORAGE_KEY = "inputAreaHeight";

let isResizingInput = false;
let resizeStartY = 0;
let resizeStartInputH = 0;

function getInputLineHeight() {
  return parseFloat(getComputedStyle(msgInput).lineHeight) || 24;
}

function getAutoInputMinH() {
  return getInputLineHeight() * INPUT_MIN_LINES;
}

function getAutoInputMaxH() {
  return getInputLineHeight() * INPUT_AUTO_MAX_LINES;
}

function getInputChromeH() {
  if (!inputArea?.getBoundingClientRect || !msgInput?.getBoundingClientRect) {
    return 0;
  }
  const areaH = inputArea.getBoundingClientRect().height || 0;
  const inputH = msgInput.getBoundingClientRect().height || 0;
  return Math.max(0, areaH - inputH);
}

function getViewportHeight() {
  const managedViewportHeight = window.MelodySyncLayout?.getViewportHeight?.();
  if (Number.isFinite(managedViewportHeight) && managedViewportHeight > 0) {
    return managedViewportHeight;
  }
  const visualHeight = window.visualViewport?.height;
  if (Number.isFinite(visualHeight) && visualHeight > 0) {
    return visualHeight;
  }
  return window.innerHeight || 0;
}

function getManualInputMaxH() {
  const viewportMax = Math.floor(getViewportHeight() * INPUT_MAX_VIEWPORT_RATIO);
  return Math.max(INPUT_MANUAL_MIN_H, viewportMax - getInputChromeH());
}

function clampInputHeight(height, { manual = false } = {}) {
  const minH = getAutoInputMinH();
  const maxH = manual
    ? Math.max(minH, getManualInputMaxH())
    : Math.max(minH, getAutoInputMaxH());
  return Math.min(Math.max(height, minH), maxH);
}

function isManualInputHeightActive() {
  return inputArea.classList.contains("is-resized");
}

function setManualInputHeight(height, { persist = true } = {}) {
  const newH = clampInputHeight(height, { manual: true });
  msgInput.style.height = newH + "px";
  inputArea.classList.add("is-resized");
  if (persist) {
    localStorage.setItem(INPUT_HEIGHT_STORAGE_KEY, String(newH));
    localStorage.removeItem(LEGACY_INPUT_AREA_HEIGHT_STORAGE_KEY);
  }
  return newH;
}

function autoResizeInput() {
  if (isManualInputHeightActive()) return;
  msgInput.style.height = "auto";
  const newH = clampInputHeight(msgInput.scrollHeight);
  msgInput.style.height = newH + "px";
}

function restoreSavedInputHeight() {
  const savedInputH = localStorage.getItem(INPUT_HEIGHT_STORAGE_KEY);
  if (savedInputH) {
    const height = parseInt(savedInputH, 10);
    if (Number.isFinite(height) && height > 0) {
      setManualInputHeight(height, { persist: false });
      return;
    }
    localStorage.removeItem(INPUT_HEIGHT_STORAGE_KEY);
  }

  const legacyInputAreaH = localStorage.getItem(LEGACY_INPUT_AREA_HEIGHT_STORAGE_KEY);
  if (legacyInputAreaH) {
    const legacyHeight = parseInt(legacyInputAreaH, 10);
    if (Number.isFinite(legacyHeight) && legacyHeight > 0) {
      const migratedHeight = Math.max(
        getAutoInputMinH(),
        legacyHeight - getInputChromeH(),
      );
      setManualInputHeight(migratedHeight);
      return;
    }
    localStorage.removeItem(LEGACY_INPUT_AREA_HEIGHT_STORAGE_KEY);
  }

  autoResizeInput();
}

function syncInputHeightForLayout() {
  if (!isManualInputHeightActive()) {
    autoResizeInput();
    return;
  }

  const currentHeight = parseFloat(msgInput.style.height);
  if (Number.isFinite(currentHeight) && currentHeight > 0) {
    setManualInputHeight(currentHeight, { persist: false });
    return;
  }

  const savedInputH = parseInt(
    localStorage.getItem(INPUT_HEIGHT_STORAGE_KEY) || "",
    10,
  );
  if (Number.isFinite(savedInputH) && savedInputH > 0) {
    setManualInputHeight(savedInputH, { persist: false });
    return;
  }

  inputArea.classList.remove("is-resized");
  autoResizeInput();
}

function onInputResizeStart(e) {
  isResizingInput = true;
  resizeStartY = e.touches ? e.touches[0].clientY : e.clientY;
  resizeStartInputH = msgInput.getBoundingClientRect().height || getAutoInputMinH();
  document.addEventListener("mousemove", onInputResizeMove);
  document.addEventListener("touchmove", onInputResizeMove, { passive: false });
  document.addEventListener("mouseup", onInputResizeEnd);
  document.addEventListener("touchend", onInputResizeEnd);
  e.preventDefault();
}

function onInputResizeMove(e) {
  if (!isResizingInput) return;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const dy = resizeStartY - clientY;
  setManualInputHeight(resizeStartInputH + dy);
  e.preventDefault();
}

function onInputResizeEnd() {
  isResizingInput = false;
  document.removeEventListener("mousemove", onInputResizeMove);
  document.removeEventListener("touchmove", onInputResizeMove);
  document.removeEventListener("mouseup", onInputResizeEnd);
  document.removeEventListener("touchend", onInputResizeEnd);
}

if (inputResizeHandle) {
  inputResizeHandle.addEventListener("mousedown", onInputResizeStart);
  inputResizeHandle.addEventListener("touchstart", onInputResizeStart, { passive: false });
}

if (window.MelodySyncLayout?.subscribe) {
  window.MelodySyncLayout.subscribe(() => {
    syncInputHeightForLayout();
  });
} else {
  window.addEventListener("resize", syncInputHeightForLayout);
  window.visualViewport?.addEventListener("resize", syncInputHeightForLayout);
}

// ---- Draft persistence ----
function saveDraft() {
  if (!currentSessionId || isComposerPendingForCurrentSession()) return;
  writeStoredDraft(currentSessionId, msgInput.value);
}
function restoreDraft() {
  msgInput.value = getComposerDraftText(currentSessionId);
  autoResizeInput();
  syncComposerPendingUi();
}
function clearDraft(sessionId = currentSessionId) {
  writeStoredDraft(sessionId, "");
}

msgInput.addEventListener("input", () => {
  autoResizeInput();
  saveDraft();
});
// Set initial height
requestAnimationFrame(() => restoreSavedInputHeight());

function releaseImageObjectUrls(images = []) {
  for (const image of images) {
    if (image?.objectUrl) {
      URL.revokeObjectURL(image.objectUrl);
    }
  }
}

function restoreFailedSendState(sessionId, text, images, requestId = "") {
  if (pendingComposerSend && (!requestId || pendingComposerSend.requestId === requestId)) {
    pendingComposerSend = null;
  }
  writeStoredDraft(sessionId, text || "");
  syncComposerPendingUi();
  if (sessionId !== currentSessionId) {
    return;
  }

  if (!msgInput.value.trim() && text) {
    msgInput.value = text;
    autoResizeInput();
    saveDraft();
  }

  if (pendingImages.length === 0 && images.length > 0) {
    pendingImages = images;
    renderImagePreviews();
  }

  if (typeof focusComposer === "function") {
    focusComposer({ force: true, preventScroll: true });
  } else {
    msgInput.focus();
  }
}

// ---- Sidebar tabs ----
let activeTab = normalizeSidebarTab(
  pendingNavigationState.tab ||
    localStorage.getItem(ACTIVE_SIDEBAR_TAB_STORAGE_KEY) ||
    "sessions",
);
const longTermWorkspace = document.getElementById("longTermWorkspace");
const longTermWorkspaceList = document.getElementById("longTermWorkspaceList");
const longTermWorkspaceDetail = document.getElementById("longTermWorkspaceDetail");
const longTermWorkspaceCount = document.getElementById("longTermWorkspaceCount");
const longTermWorkspaceNewBtn = document.getElementById("longTermWorkspaceNewBtn");
const longTermWorkspaceTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
let selectedLongTermProjectId = "";

function escapeLongTermWorkspaceHtml(value) {
  if (typeof esc === "function") {
    return esc(String(value || ""));
  }
  const span = document.createElement("span");
  span.textContent = String(value || "");
  return span.innerHTML;
}

function clipLongTermWorkspaceText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function compareLongTermWorkspaceSessions(left, right) {
  if (typeof compareSessionListSessions === "function") {
    return compareSessionListSessions(left, right);
  }
  const leftTime = new Date(left?.lastEventAt || left?.updatedAt || left?.created || 0).getTime();
  const rightTime = new Date(right?.lastEventAt || right?.updatedAt || right?.created || 0).getTime();
  return rightTime - leftTime;
}

function isLongTermWorkspaceProject(session) {
  const membership = session?.taskPoolMembership?.longTerm;
  const sessionId = String(session?.id || "").trim();
  const projectSessionId = String(membership?.projectSessionId || "").trim();
  const requestedRole = String(membership?.role || "").trim().toLowerCase();
  const explicitIsProject = projectSessionId
    && (requestedRole === "project" || projectSessionId === sessionId)
    && (membership?.fixedNode === true || projectSessionId === sessionId);
  return session?.archived !== true
    && (explicitIsProject || getSidebarPersistentKind(session) === "recurring_task");
}

function getLongTermWorkspaceProjects() {
  const entries = Array.isArray(sessions) ? sessions.filter(isLongTermWorkspaceProject).slice() : [];
  entries.sort(compareLongTermWorkspaceSessions);
  return entries;
}

function resolveLongTermWorkspaceRootSessionId(session, validIds = new Set()) {
  if (!session || typeof session !== "object") return "";
  const candidates = [];
  const sessionId = String(session?.id || "").trim();
  if (sessionId) candidates.push(sessionId);
  const explicitProjectSessionId = String(session?.taskPoolMembership?.longTerm?.projectSessionId || "").trim();
  if (explicitProjectSessionId) candidates.push(explicitProjectSessionId);
  const cluster = typeof getTaskClusterForSession === "function"
    ? getTaskClusterForSession(session)
    : null;
  const clusterRootId = String(cluster?.mainSessionId || "").trim();
  if (clusterRootId) candidates.push(clusterRootId);
  const rootSessionId = String(
    session?.rootSessionId
    || session?.sourceContext?.rootSessionId
    || session?.sourceContext?.parentSessionId
    || "",
  ).trim();
  if (rootSessionId) candidates.push(rootSessionId);
  return candidates.find((entry) => validIds.has(entry)) || "";
}

function resolveLongTermWorkspaceProjectSelection(projects = []) {
  const validIds = new Set(
    projects.map((entry) => String(entry?.id || "").trim()).filter(Boolean),
  );
  if (selectedLongTermProjectId && validIds.has(selectedLongTermProjectId)) {
    return selectedLongTermProjectId;
  }
  const currentSession = Array.isArray(sessions)
    ? sessions.find((entry) => entry?.id === currentSessionId) || null
    : null;
  const currentProjectId = resolveLongTermWorkspaceRootSessionId(currentSession, validIds);
  if (currentProjectId) return currentProjectId;
  return String(projects[0]?.id || "").trim();
}

function getLongTermWorkspaceProjectCluster(project) {
  return typeof getTaskClusterForSession === "function"
    ? getTaskClusterForSession(project)
    : null;
}

function getLongTermWorkspaceBranchSessions(project) {
  const cluster = getLongTermWorkspaceProjectCluster(project);
  const branchSessions = Array.isArray(cluster?.branchSessions)
    ? cluster.branchSessions.slice()
    : [];
  branchSessions.sort(compareLongTermWorkspaceSessions);
  return { cluster, branchSessions };
}

function getLongTermWorkspaceBranchStatusKey(session) {
  const model = window.MelodySyncSessionListModel || null;
  const status = typeof model?.getBranchTaskStatus === "function"
    ? String(model.getBranchTaskStatus(session) || "").trim().toLowerCase()
    : "";
  if (status === "parked") return "parked";
  if (status === "merged") return "merged";
  if (["resolved", "done", "closed"].includes(status)) return "closed";
  return "active";
}

function getLongTermWorkspaceBranchCounts(branchSessions = []) {
  const counts = {
    total: 0,
    active: 0,
    parked: 0,
    merged: 0,
    closed: 0,
  };
  for (const entry of Array.isArray(branchSessions) ? branchSessions : []) {
    counts.total += 1;
    counts[getLongTermWorkspaceBranchStatusKey(entry)] += 1;
  }
  return counts;
}

function getLongTermWorkspaceBranchCountLabel(counts) {
  const parts = [];
  if (counts.active > 0) parts.push(`进行中 ${counts.active}`);
  if (counts.parked > 0) parts.push(`挂起 ${counts.parked}`);
  if (counts.merged > 0) parts.push(`已带回 ${counts.merged}`);
  if (counts.closed > 0) parts.push(`已关闭 ${counts.closed}`);
  if (parts.length > 0) return parts.join(" · ");
  if (counts.total > 0) return `共 ${counts.total} 条维护任务`;
  return "还没有挂入的维护任务";
}

function getLongTermWorkspaceWeekdayLabel(day) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day] || "";
}

function getLongTermWorkspaceScheduleLabel(session) {
  const recurring = session?.persistent?.recurring && typeof session.persistent.recurring === "object"
    ? session.persistent.recurring
    : {};
  const cadence = String(recurring?.cadence || "").trim().toLowerCase();
  let cadenceLabel = "每天";
  if (cadence === "hourly") {
    cadenceLabel = "每小时";
  } else if (cadence === "weekly") {
    const weekdays = Array.isArray(recurring?.weekdays)
      ? recurring.weekdays.map((entry) => getLongTermWorkspaceWeekdayLabel(Number(entry))).filter(Boolean)
      : [];
    cadenceLabel = weekdays.length > 0 ? `每周 ${weekdays.join(" / ")}` : "每周";
  }
  const timeOfDay = String(recurring?.timeOfDay || "").trim();
  return [cadenceLabel, timeOfDay].filter(Boolean).join(" · ");
}

function getLongTermWorkspacePreview(session) {
  if (typeof getSessionTaskPreview === "function") {
    return getSessionTaskPreview(session) || { summaryLine: "", hintLine: "" };
  }
  return { summaryLine: "", hintLine: "" };
}

function getLongTermWorkspaceProjectTitle(session) {
  return clipLongTermWorkspaceText(
    (typeof getPreferredSessionDisplayName === "function"
      ? getPreferredSessionDisplayName(session)
      : "")
      || (typeof getSessionDisplayName === "function" ? getSessionDisplayName(session) : "")
      || String(session?.persistent?.digest?.title || "").trim()
      || String(session?.name || "").trim()
      || "未命名长期任务",
    48,
  );
}

function getLongTermWorkspaceProjectSummary(session) {
  const digestSummary = clipLongTermWorkspaceText(session?.persistent?.digest?.summary || "", 160);
  if (digestSummary) return digestSummary;
  const preview = getLongTermWorkspacePreview(session);
  return preview.summaryLine
    || preview.hintLine
    || "这里维护长期任务本身，自动识别归属的新需求会被挂到它的任务地图里。";
}

function getLongTermWorkspaceProjectFocus(session) {
  const taskCard = session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : {};
  const preview = getLongTermWorkspacePreview(session);
  return clipLongTermWorkspaceText(
    taskCard?.checkpoint
      || preview.summaryLine
      || preview.hintLine
      || "",
    160,
  );
}

function getLongTermWorkspaceProjectStatusLabel(session) {
  const visualStatus = typeof getSessionVisualStatus === "function"
    ? getSessionVisualStatus(session)
    : null;
  if (visualStatus?.label && visualStatus.key !== "idle") {
    return String(visualStatus.label).trim();
  }
  const workflowState = String(session?.workflowState || "").trim().toLowerCase();
  if (workflowState === "waiting_user") return "等待你";
  return "持续维护中";
}

function formatLongTermWorkspaceStamp(value) {
  if (!value) return "";
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return "";
  return longTermWorkspaceTimeFormatter.format(stamp);
}

function renderLongTermWorkspaceProjectList(projects = [], selectedProjectId = "") {
  if (!longTermWorkspaceList) return;
  if (projects.length === 0) {
    longTermWorkspaceList.innerHTML = `
      <div class="long-term-workspace-empty-panel">
        <div class="long-term-workspace-empty-title">还没有长期任务</div>
        <div class="long-term-workspace-empty-copy">先创建一个长期任务，后续自动识别到属于它的新需求时，会直接挂到它的任务地图里。</div>
      </div>`;
    return;
  }

  longTermWorkspaceList.innerHTML = projects.map((project) => {
    const projectId = String(project?.id || "").trim();
    const selected = projectId === selectedProjectId;
    const { branchSessions } = getLongTermWorkspaceBranchSessions(project);
    const branchCounts = getLongTermWorkspaceBranchCounts(branchSessions);
    const title = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectTitle(project));
    const summary = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectSummary(project));
    const status = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectStatusLabel(project));
    const schedule = escapeLongTermWorkspaceHtml(getLongTermWorkspaceScheduleLabel(project));
    const branchLabel = escapeLongTermWorkspaceHtml(getLongTermWorkspaceBranchCountLabel(branchCounts));
    return `
      <button
        class="long-term-project-card${selected ? " is-selected" : ""}"
        type="button"
        data-long-term-project-id="${escapeLongTermWorkspaceHtml(projectId)}"
      >
        <div class="long-term-project-card-top">
          <span class="long-term-project-card-tag">长期任务</span>
          <span class="long-term-project-card-status">${status}</span>
        </div>
        <div class="long-term-project-card-title">${title}</div>
        <div class="long-term-project-card-summary">${summary}</div>
        <div class="long-term-project-card-meta">
          <span>${schedule}</span>
          <span>${branchLabel}</span>
        </div>
      </button>`;
  }).join("");
}

function renderLongTermWorkspaceBranchList(branchSessions = [], projectId = "") {
  if (!Array.isArray(branchSessions) || branchSessions.length === 0) {
    return `
      <div class="long-term-branch-empty">
        <div class="long-term-branch-empty-title">还没有挂入的维护任务</div>
        <div class="long-term-branch-empty-copy">当系统识别到新的需求属于这个长期任务时，会自动把它加入这里，而不是继续混进基础任务列表。</div>
      </div>`;
  }

  return branchSessions.map((branch) => {
    const branchId = String(branch?.id || "").trim();
    const title = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectTitle(branch));
    const preview = getLongTermWorkspacePreview(branch);
    const summary = escapeLongTermWorkspaceHtml(
      clipLongTermWorkspaceText(
        preview.summaryLine || preview.hintLine || branch?.taskCard?.checkpoint || "",
        140,
      ) || "进入这个任务查看具体上下文",
    );
    const status = escapeLongTermWorkspaceHtml(getTaskBranchStatusLabel(branch) || "进行中");
    const updatedAt = escapeLongTermWorkspaceHtml(
      formatLongTermWorkspaceStamp(branch?.lastEventAt || branch?.updatedAt || branch?.created || ""),
    );
    const isCurrent = String(currentSessionId || "").trim() === branchId;
    return `
      <button
        class="long-term-branch-item${isCurrent ? " is-current" : ""}"
        type="button"
        data-open-branch-id="${escapeLongTermWorkspaceHtml(branchId)}"
        data-project-id="${escapeLongTermWorkspaceHtml(projectId)}"
      >
        <div class="long-term-branch-item-header">
          <span class="long-term-branch-item-status">${status}</span>
          ${updatedAt ? `<span class="long-term-branch-item-time">${updatedAt}</span>` : ""}
        </div>
        <div class="long-term-branch-item-title">${title}</div>
        <div class="long-term-branch-item-summary">${summary}</div>
      </button>`;
  }).join("");
}

function renderLongTermWorkspaceDetail(projects = [], selectedProjectId = "") {
  if (!longTermWorkspaceDetail) return;
  const selectedProject = projects.find((entry) => String(entry?.id || "").trim() === selectedProjectId) || null;
  if (!selectedProject) {
    longTermWorkspaceDetail.innerHTML = `
      <div class="ltcp-empty">
        <div class="ltcp-empty-title">选择一个长期项目</div>
        <div class="ltcp-empty-copy">在左侧点击一个长期项目，查看它的控制面板。</div>
      </div>`;
    return;
  }

  const { branchSessions } = getLongTermWorkspaceBranchSessions(selectedProject);
  const title = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectTitle(selectedProject));
  const schedule = escapeLongTermWorkspaceHtml(getLongTermWorkspaceScheduleLabel(selectedProject));
  const status = escapeLongTermWorkspaceHtml(getLongTermWorkspaceProjectStatusLabel(selectedProject));

  // ── 1. Task counts ──────────────────────────────────────────────
  const model = window.MelodySyncSessionListModel || null;
  function getBucket(session) {
    if (typeof model?.getLongTermTaskPoolMembership === "function") {
      const mem = model.getLongTermTaskPoolMembership(session);
      if (mem?.bucket) return String(mem.bucket).trim().toLowerCase();
    }
    const kind = String(session?.persistent?.kind || "").trim().toLowerCase();
    if (kind === "recurring_task") return "long_term";
    if (kind === "scheduled_task") return "short_term";
    if (kind === "waiting_task") return "waiting";
    return "inbox";
  }
  const memberSessions = branchSessions.filter((s) => {
    const mem = s?.taskPoolMembership?.longTerm;
    return mem?.projectSessionId && mem?.role !== "project";
  });
  const longTermCount = memberSessions.filter((s) => getBucket(s) === "long_term").length;
  const shortTermCount = memberSessions.filter((s) => getBucket(s) === "short_term").length;

  // ── 2. Trigger info ─────────────────────────────────────────────
  const persistent = selectedProject?.persistent || {};
  const lastTriggerAt = persistent?.execution?.lastTriggerAt || persistent?.recurring?.lastRunAt || "";
  const nextRunAt = persistent?.recurring?.nextRunAt || persistent?.scheduled?.nextRunAt || "";
  const lastTriggerLabel = lastTriggerAt
    ? escapeLongTermWorkspaceHtml(formatLongTermWorkspaceStamp(lastTriggerAt))
    : "尚未触发";
  const nextRunLabel = nextRunAt
    ? escapeLongTermWorkspaceHtml(formatLongTermWorkspaceStamp(nextRunAt))
    : "";

  // ── 3. Workspace ────────────────────────────────────────────────
  const workspace = persistent?.workspace || null;
  const workspacePath = escapeLongTermWorkspaceHtml(String(workspace?.path || "").trim());
  const workspaceLabel = escapeLongTermWorkspaceHtml(String(workspace?.label || "").trim());
  const workspaceDisplay = workspaceLabel || workspacePath;
  const projectId = escapeLongTermWorkspaceHtml(String(selectedProject?.id || "").trim());

  // ── 4. Waiting sessions ─────────────────────────────────────────
  const waitingSessions = memberSessions.filter((s) => getBucket(s) === "waiting");
  const waitingHtml = waitingSessions.length === 0
    ? `<div class="ltcp-waiting-empty">暂无等待中的任务</div>`
    : waitingSessions.map((s) => {
        const name = escapeLongTermWorkspaceHtml(
          String(s?.taskCard?.goal || s?.taskCard?.summary || s?.name || "").trim() || "未命名任务"
        );
        const branchId = escapeLongTermWorkspaceHtml(String(s?.id || ""));
        return `<button class="ltcp-waiting-item" type="button" data-open-branch-id="${branchId}">
          <span class="ltcp-waiting-item-name">${name}</span>
          <span class="ltcp-waiting-item-arrow">›</span>
        </button>`;
      }).join("");

  longTermWorkspaceDetail.innerHTML = `
    <div class="ltcp-shell">
      <div class="ltcp-header">
        <div class="ltcp-header-main">
          <h2 class="ltcp-title">${title}</h2>
          <div class="ltcp-meta">
            ${schedule ? `<span class="ltcp-chip">${schedule}</span>` : ""}
            <span class="ltcp-chip ltcp-chip-status">${status}</span>
          </div>
        </div>
      </div>

      <div class="ltcp-section ltcp-workspace-section">
        <div class="ltcp-section-header">
          <span class="ltcp-section-title">工作区</span>
          <button class="ltcp-workspace-edit-btn" type="button" data-project-id="${projectId}" title="设置工作区路径">
            ${workspacePath ? "修改" : "绑定目录"}
          </button>
        </div>
        ${workspacePath ? `
          <div class="ltcp-workspace-path" title="${workspacePath}">
            ${workspaceDisplay ? `<span class="ltcp-workspace-label">${workspaceDisplay}</span>` : ""}
            ${workspaceLabel ? `<span class="ltcp-workspace-raw">${workspacePath}</span>` : ""}
          </div>
        ` : `
          <div class="ltcp-workspace-empty">未绑定本地目录。绑定后，AI 执行任务时将以该目录为工作根。</div>
        `}
      </div>

      <div class="ltcp-stats-row">
        <div class="ltcp-stat">
          <div class="ltcp-stat-value">${longTermCount}</div>
          <div class="ltcp-stat-label">长期任务</div>
        </div>
        <div class="ltcp-stat">
          <div class="ltcp-stat-value">${shortTermCount}</div>
          <div class="ltcp-stat-label">短期任务</div>
        </div>
        <div class="ltcp-stat">
          <div class="ltcp-stat-value">${waitingSessions.length}</div>
          <div class="ltcp-stat-label">等待中</div>
        </div>
      </div>

      <div class="ltcp-trigger-row">
        <div class="ltcp-trigger-item">
          <span class="ltcp-trigger-label">上次触发</span>
          <span class="ltcp-trigger-value">${lastTriggerLabel}</span>
        </div>
        ${nextRunLabel ? `<div class="ltcp-trigger-item">
          <span class="ltcp-trigger-label">下次触发</span>
          <span class="ltcp-trigger-value">${nextRunLabel}</span>
        </div>` : ""}
      </div>

      <div class="ltcp-section">
        <div class="ltcp-section-title">等待中的任务</div>
        <div class="ltcp-waiting-list">
          ${waitingHtml}
        </div>
      </div>
    </div>`;
}

function renderLongTermWorkspace() {
  // No-op: workspace panel is shown/hidden by attachSession based on session type
}

function getSidebarTabForComposeSession(session, projects = getLongTermWorkspaceProjects()) {
  const validIds = new Set(
    Array.isArray(projects)
      ? projects.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
      : [],
  );
  if (resolveLongTermWorkspaceRootSessionId(session, validIds)) return "long-term";
  return "sessions";
}

function resolveSidebarTabAttachmentTarget(tab = activeTab) {
  const normalizedTab = normalizeSidebarTab(tab);
  const projects = getLongTermWorkspaceProjects();
  const currentSession = Array.isArray(sessions)
    ? sessions.find((entry) => entry?.id === currentSessionId) || null
    : null;

  if (normalizedTab === "long-term") {
    selectedLongTermProjectId = resolveLongTermWorkspaceProjectSelection(projects);
    return projects.find((entry) => String(entry?.id || "").trim() === selectedLongTermProjectId) || null;
  }

  if (currentSession && getSidebarTabForComposeSession(currentSession, projects) === "sessions") {
    return currentSession;
  }

  return Array.isArray(sessions)
    ? sessions.find((entry) => entry?.archived !== true && getSidebarTabForComposeSession(entry, projects) === "sessions") || null
    : null;
}

function getActiveSidebarTab() {
  return normalizeSidebarTab(activeTab);
}

function syncSidebarTabUi() {
  const activeTabKey = getActiveSidebarTab();
  const isLongTermTab = activeTabKey === "long-term";
  const isSessionsTab = activeTabKey === "sessions";
  tabSessions?.classList.toggle("active", isSessionsTab);
  tabLongTerm?.classList.toggle("active", isLongTermTab);
  if (sessionList) sessionList.style.display = "";
  // Eye button: show in sessions tab (hide branch tasks = project members)
  if (sidebarBranchVisibilityToggleBtn) sidebarBranchVisibilityToggleBtn.hidden = !isSessionsTab;
  if (sidebarLongTermVisibilityToggleBtn) sidebarLongTermVisibilityToggleBtn.hidden = true;
  if (sessionListFooter) {
    sessionListFooter.hidden = false;
    sessionListFooter.classList.remove("hidden");
  }
  if (sortSessionListBtn) {
    sortSessionListBtn.hidden = true;
    sortSessionListBtn.classList.add("hidden");
  }
  if (newSessionBtn) {
    newSessionBtn.hidden = false;
    newSessionBtn.classList.remove("hidden");
    const label = isLongTermTab ? t("sidebar.newLongTerm") || "新建项目" : t("sidebar.newSession");
    newSessionBtn.textContent = label;
    newSessionBtn.title = label;
    newSessionBtn.setAttribute("aria-label", label);
  }
  // Close project control panel when not on long-term tab
  if (!isLongTermTab && document.body.classList.contains("long-term-workspace-active")) {
    document.body.classList.remove("long-term-workspace-active");
    if (longTermWorkspace) longTermWorkspace.hidden = true;
  }
  renderLongTermWorkspace();
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("sidebar-tab-switch");
  }
}

function switchTab(tab, { syncState = true } = {}) {
  const prevTab = activeTab;
  activeTab = normalizeSidebarTab(tab);
  const isNowLongTerm = activeTab === "long-term";
  // Always close the project control panel when leaving the long-term tab
  if (!isNowLongTerm && (prevTab === "long-term" || document.body.classList.contains("long-term-workspace-active"))) {
    document.body.classList.remove("long-term-workspace-active");
    if (longTermWorkspace) longTermWorkspace.hidden = true;
  }
  syncSidebarTabUi();
  const targetSession = resolveSidebarTabAttachmentTarget(activeTab);
  if (isNowLongTerm) {
    // Always show the panel when switching to long-term tab, regardless of currentSessionId
    if (targetSession?.id) {
      if (typeof attachSession === "function" && currentSessionId !== targetSession.id) {
        attachSession(targetSession.id, targetSession);
        return;
      }
      // Same session already attached — just show the panel directly
      if (typeof window.showLongTermProjectPanel === "function") {
        window.showLongTermProjectPanel(targetSession.id);
      }
    }
    if (typeof renderSessionList === "function") renderSessionList();
    if (syncState) syncBrowserState();
    return;
  }
  if (targetSession?.id && typeof attachSession === "function" && currentSessionId !== targetSession.id) {
    attachSession(targetSession.id, targetSession);
    return;
  }
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
  if (syncState) {
    syncBrowserState();
  }
}

globalThis.switchTab = switchTab;
globalThis.getActiveSidebarTab = getActiveSidebarTab;
globalThis.renderLongTermWorkspace = renderLongTermWorkspace;
globalThis.setSelectedLongTermProjectId = (id) => {
  selectedLongTermProjectId = String(id || "").trim();
};

globalThis.showLongTermProjectPanel = (projectId) => {
  selectedLongTermProjectId = String(projectId || "").trim();
  // Toggle body class — existing CSS hides messages, input, taskMap rail
  document.body.classList.add("long-term-workspace-active");
  if (longTermWorkspace) longTermWorkspace.hidden = false;
  const projects = getLongTermWorkspaceProjects();
  renderLongTermWorkspaceDetail(projects, selectedLongTermProjectId);
};

globalThis.hideLongTermProjectPanel = () => {
  document.body.classList.remove("long-term-workspace-active");
  if (longTermWorkspace) longTermWorkspace.hidden = true;
};

tabSessions?.addEventListener("click", () => switchTab("sessions"));
tabLongTerm?.addEventListener("click", () => switchTab("long-term"));

longTermWorkspaceNewBtn?.addEventListener("click", () => {
  void createNewLongTermProjectShortcut?.({ closeSidebar: false });
});

longTermWorkspaceList?.addEventListener("click", (event) => {
  const card = event.target?.closest?.("[data-long-term-project-id]");
  if (!card) return;
  selectedLongTermProjectId = String(card.dataset?.longTermProjectId || "").trim();
  renderLongTermWorkspace();
});

longTermWorkspaceDetail?.addEventListener("click", (event) => {
  const openBranchButton = event.target?.closest?.("[data-open-branch-id]");
  if (openBranchButton) {
    const branchId = String(openBranchButton.dataset?.openBranchId || "").trim();
    const projectId = String(openBranchButton.dataset?.projectId || "").trim();
    const branchSession = Array.isArray(sessions)
      ? sessions.find((entry) => entry?.id === branchId) || null
      : null;
    if (!branchSession?.id) return;
    if (projectId) {
      selectedLongTermProjectId = projectId;
    }
    switchTab("sessions");
    attachSession(branchSession.id, branchSession);
    return;
  }

  const workspaceEditButton = event.target?.closest?.(".ltcp-workspace-edit-btn");
  if (workspaceEditButton) {
    const pid = String(workspaceEditButton.dataset?.projectId || "").trim() || selectedLongTermProjectId;
    const projectSession = Array.isArray(sessions)
      ? sessions.find((entry) => entry?.id === pid) || null
      : null;
    if (!projectSession?.id) return;
    const currentPath = String(projectSession?.persistent?.workspace?.path || "").trim();
    const currentLabel = String(projectSession?.persistent?.workspace?.label || "").trim();
    const newPath = window.prompt("绑定本地工作区目录（绝对路径）：", currentPath);
    if (newPath === null) return; // cancelled
    const trimmedPath = newPath.trim();
    const newLabel = trimmedPath
      ? (window.prompt("工作区名称（可选，留空则只显示路径）：", currentLabel) ?? "")
      : "";
    void fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(projectSession.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persistent: {
          workspace: trimmedPath ? { path: trimmedPath, label: newLabel.trim() } : null,
        },
      }),
    }).then(() => {
      if (typeof window.MelodySyncAppState?.refresh === "function") {
        window.MelodySyncAppState.refresh();
      }
    }).catch((err) => {
      console.error("[workspace] Failed to update workspace:", err);
      window.alert("工作区设置失败，请重试。");
    });
    return;
  }

  const actionButton = event.target?.closest?.("[data-project-action]");
  if (!actionButton) return;
  const action = String(actionButton.dataset?.projectAction || "").trim();
  const projectId = String(actionButton.dataset?.projectId || "").trim() || selectedLongTermProjectId;
  const projectSession = Array.isArray(sessions)
    ? sessions.find((entry) => entry?.id === projectId) || null
    : null;
  if (!projectSession?.id) return;
  selectedLongTermProjectId = projectId;

  if (action === "configure") {
    attachSession(projectSession.id, projectSession);
    window.MelodySyncWorkbench?.openPersistentEditor?.({
      mode: "configure",
      kind: "recurring_task",
    });
    return;
  }

  if (action === "run") {
    void dispatchAction?.({
      action: "persistent_run",
      sessionId: projectSession.id,
      runtime: window.MelodySyncSessionTooling?.getCurrentRuntimeSelectionSnapshot?.() || undefined,
    });
  }
});

window.MelodySyncAppState?.subscribe?.(() => {
  renderLongTermWorkspace();
});
window.MelodySyncWorkbench?.subscribe?.(() => {
  renderLongTermWorkspace();
});

switchTab(activeTab, { syncState: false });

// ── Suggested branch actions / questions ─────────────────────────────────────

const suggestedQuestionsEl = document.getElementById("suggestedQuestions");

function getWorkbenchSurfaceProjectionApi() {
  return globalThis?.MelodySyncWorkbenchSurfaceProjection
    || globalThis?.window?.MelodySyncWorkbenchSurfaceProjection
    || null;
}

function getWorkbenchApi() {
  return globalThis?.MelodySyncWorkbench
    || globalThis?.window?.MelodySyncWorkbench
    || null;
}

function toConciseBranchSourceTitle(session) {
  const taskCard = session?.taskCard && typeof session.taskCard === "object"
    ? session.taskCard
    : {};
  const lineRole = String(taskCard?.lineRole || "").trim().toLowerCase() === "branch"
    ? "branch"
    : "main";
  const compact = String(
    lineRole === "branch"
      ? (taskCard?.goal || session?.name || taskCard?.mainGoal || "当前任务")
      : (session?.name || taskCard?.mainGoal || taskCard?.goal || "当前任务")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "当前任务";
  const firstSegment = compact
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return firstSegment || compact;
}

function normalizeSuggestionTokens(values = []) {
  return Array.isArray(values)
    ? values.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : [];
}

function isBranchSuggestionEntry(candidate) {
  const capabilities = normalizeSuggestionTokens(candidate?.capabilities);
  const taskCardBindings = normalizeSuggestionTokens(candidate?.taskCardBindings);
  return capabilities.includes("create-branch") || taskCardBindings.includes("candidatebranches");
}

function hydrateSuggestionIntoComposer(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText || !msgInput) return false;
  msgInput.value = normalizedText;
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
  msgInput.focus();
  if (suggestedQuestionsEl) {
    suggestedQuestionsEl.hidden = true;
  }
  return true;
}

async function triggerSuggestionEntry(session, candidate) {
  const text = String(candidate?.text || "").trim();
  if (!text) return false;
  const workbenchApi = getWorkbenchApi();
  const actionPayload = candidate?.actionPayload && typeof candidate.actionPayload === "object"
    ? candidate.actionPayload
    : {};
  const sourceSessionId = String(candidate?.sourceSessionId || session?.id || "").trim();
  if (
    isBranchSuggestionEntry(candidate)
    && sourceSessionId
    && typeof workbenchApi?.enterBranchFromSession === "function"
  ) {
    const defaultBranchReason = `从「${toConciseBranchSourceTitle(session)}」继续拆出独立支线`;
    try {
      const branchSession = await workbenchApi.enterBranchFromSession(sourceSessionId, text, {
        branchReason: String(actionPayload?.branchReason || candidate?.summary || defaultBranchReason).trim(),
        checkpointSummary: String(actionPayload?.checkpointSummary || text).trim(),
      });
      if (branchSession?.id) {
        if (suggestedQuestionsEl) {
          suggestedQuestionsEl.hidden = true;
        }
        return true;
      }
    } catch {}
  }
  return hydrateSuggestionIntoComposer(text);
}

function listSuggestedQuestionEntries(session) {
  const planEntries = getWorkbenchSurfaceProjectionApi()?.buildComposerSuggestionEntries?.({
    session,
  }) || [];
  if (planEntries.length > 0) {
    return planEntries;
  }
  const legacyCandidates = Array.isArray(session?.taskCard?.candidateBranches)
    ? session.taskCard.candidateBranches.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
  return legacyCandidates.map((text) => ({
    id: "",
    text,
    summary: "",
    capabilities: [],
    taskCardBindings: ["candidateBranches"],
  }));
}

function renderSuggestedQuestions(session) {
  if (!suggestedQuestionsEl) return;
  const candidates = listSuggestedQuestionEntries(session);
  const isRunning = Boolean(session?.activity?.run?.state === "running");
  const hasDraft = Boolean(msgInput?.value?.trim());

  if (candidates.length === 0 || isRunning || hasDraft) {
    suggestedQuestionsEl.hidden = true;
    suggestedQuestionsEl.innerHTML = "";
    return;
  }

  suggestedQuestionsEl.innerHTML = "";
  for (const candidate of candidates) {
    const text = candidate.text;
    const btn = document.createElement("button");
    btn.className = "suggested-question-btn";
    btn.textContent = text;
    btn.type = "button";
    if (candidate.summary) {
      btn.title = candidate.summary;
    } else if (isBranchSuggestionEntry(candidate)) {
      btn.title = "点击开启";
    }
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await triggerSuggestionEntry(session, candidate);
      } finally {
        btn.disabled = false;
      }
    });
    suggestedQuestionsEl.appendChild(btn);
  }
  suggestedQuestionsEl.hidden = false;
}

// Hide suggestions when the user starts typing.
msgInput?.addEventListener("input", () => {
  if (msgInput.value.trim() && suggestedQuestionsEl) {
    suggestedQuestionsEl.hidden = true;
  }
});

globalThis.renderSuggestedQuestions = renderSuggestedQuestions;
