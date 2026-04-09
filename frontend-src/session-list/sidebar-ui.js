// ---- Sidebar ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

const SIDEBAR_DESKTOP_WIDTH_STORAGE_KEY = "melodysyncSidebarDesktopWidth";
const SIDEBAR_DESKTOP_MIN_WIDTH = 236;
const SIDEBAR_DESKTOP_MAX_WIDTH = 520;
const SIDEBAR_DESKTOP_MAIN_RESERVE = 420;
const SIDEBAR_DESKTOP_MAX_RATIO = 0.38;
let sidebarResizeState = null;

function getTaskMapDesktopWidthForSidebarLayout() {
  if (document.body?.classList?.contains?.("task-map-is-collapsed") === true) return 0;
  const taskMapRail = document.getElementById("taskMapRail");
  const rectWidth = Number(taskMapRail?.getBoundingClientRect?.().width || 0);
  if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
  const rawWidth = getComputedStyle(document.documentElement).getPropertyValue("--task-map-width");
  const parsedWidth = Number.parseFloat(String(rawWidth || "").trim());
  return Number.isFinite(parsedWidth) ? parsedWidth : 0;
}

function getSidebarDesktopWidthLimits() {
  const viewportWidth = Number(window?.innerWidth || 0);
  const taskMapWidth = getTaskMapDesktopWidthForSidebarLayout();
  const computedMaxByMainReserve = viewportWidth > 0
    ? (viewportWidth - taskMapWidth - SIDEBAR_DESKTOP_MAIN_RESERVE)
    : SIDEBAR_DESKTOP_MAX_WIDTH;
  const computedMaxByRatio = viewportWidth > 0
    ? Math.floor(viewportWidth * SIDEBAR_DESKTOP_MAX_RATIO)
    : SIDEBAR_DESKTOP_MAX_WIDTH;
  const max = Math.min(
    SIDEBAR_DESKTOP_MAX_WIDTH,
    Math.max(
      SIDEBAR_DESKTOP_MIN_WIDTH,
      Math.min(computedMaxByMainReserve, computedMaxByRatio),
    ),
  );
  return {
    min: SIDEBAR_DESKTOP_MIN_WIDTH,
    max,
  };
}

function clampSidebarDesktopWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const limits = getSidebarDesktopWidthLimits();
  if (limits.max <= limits.min) return limits.min;
  return Math.min(Math.max(Math.round(numeric), limits.min), limits.max);
}

function applySidebarDesktopWidth(width, { persist = true } = {}) {
  const clampedWidth = clampSidebarDesktopWidth(width);
  if (!Number.isFinite(clampedWidth)) return null;
  document.documentElement?.style?.setProperty?.("--sidebar-width", `${clampedWidth}px`);
  if (persist) {
    try {
      localStorage.setItem(SIDEBAR_DESKTOP_WIDTH_STORAGE_KEY, String(clampedWidth));
    } catch {}
  }
  return clampedWidth;
}

function restoreSidebarDesktopWidthPreference() {
  let storedWidth = "";
  try {
    storedWidth = String(localStorage.getItem(SIDEBAR_DESKTOP_WIDTH_STORAGE_KEY) || "").trim();
  } catch {
    storedWidth = "";
  }
  if (!storedWidth) return;
  applySidebarDesktopWidth(Number(storedWidth), { persist: false });
}

function reconcileSidebarDesktopWidthPreference() {
  let storedWidth = "";
  try {
    storedWidth = String(localStorage.getItem(SIDEBAR_DESKTOP_WIDTH_STORAGE_KEY) || "").trim();
  } catch {
    storedWidth = "";
  }
  if (!storedWidth) return;
  applySidebarDesktopWidth(Number(storedWidth), { persist: true });
}

function resetSidebarDesktopWidthPreference() {
  try {
    localStorage.removeItem(SIDEBAR_DESKTOP_WIDTH_STORAGE_KEY);
  } catch {}
  document.documentElement?.style?.removeProperty?.("--sidebar-width");
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("sidebar-resize-reset");
  }
}

function syncSidebarResizeHandle() {
  if (!sidebarResizeHandle) return;
  const showDesktopHandle = Boolean(isDesktop && desktopSidebarCollapsed !== true);
  sidebarResizeHandle.hidden = !showDesktopHandle;
  sidebarResizeHandle.setAttribute("aria-hidden", showDesktopHandle ? "false" : "true");
}

function endSidebarResize({ render = true } = {}) {
  const wasResizing = Boolean(sidebarResizeState);
  sidebarResizeState = null;
  sidebarResizeHandle?.classList?.remove?.("is-dragging");
  document.body?.classList?.remove?.("is-sidebar-resizing");
  if (!wasResizing || !render) return;
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("sidebar-resize-end");
  }
}

function beginSidebarResize(event) {
  if (!isDesktop || desktopSidebarCollapsed === true) return;
  const startWidth = Number(sidebarOverlay?.getBoundingClientRect?.().width || 0);
  if (!Number.isFinite(startWidth) || startWidth <= 0) return;
  sidebarResizeState = {
    pointerId: event.pointerId,
    startX: Number(event.clientX || 0),
    startWidth,
  };
  sidebarResizeHandle?.classList?.add?.("is-dragging");
  document.body?.classList?.add?.("is-sidebar-resizing");
}

function continueSidebarResize(event) {
  if (!sidebarResizeState) return;
  if (event.pointerId !== sidebarResizeState.pointerId) return;
  const deltaX = Number(event.clientX || 0) - sidebarResizeState.startX;
  const nextWidth = sidebarResizeState.startWidth + deltaX;
  const appliedWidth = applySidebarDesktopWidth(nextWidth, { persist: true });
  if (!Number.isFinite(appliedWidth)) return;
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("sidebar-resize-drag");
  }
}

function openSidebar() {
  sidebarOverlay.classList.add("open");
}
function closeSidebarFn() {
  sidebarOverlay.classList.remove("open");
}

function getSidebarCollapseLabel() {
  return t(desktopSidebarCollapsed ? "sidebar.expand" : "sidebar.collapse");
}

function persistSidebarCollapseState() {
  try {
    localStorage.setItem(
      SIDEBAR_COLLAPSE_STORAGE_KEY,
      desktopSidebarCollapsed ? "true" : "false",
    );
  } catch {}
}

function syncSidebarCollapseState({ persist = false } = {}) {
  const collapsed = isDesktop && desktopSidebarCollapsed === true;
  if (!collapsed && isDesktop) {
    reconcileSidebarDesktopWidthPreference();
  }
  sidebarOverlay.classList.toggle("is-collapsed", collapsed);
  document.body?.classList?.toggle?.("sidebar-is-collapsed", collapsed);
  const menuLabel = isDesktop ? getSidebarCollapseLabel() : t("nav.sessions");
  menuBtn.title = menuLabel;
  menuBtn.setAttribute("aria-label", menuLabel);
  menuBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  syncSidebarResizeHandle();
  if (persist) {
    persistSidebarCollapseState();
  }
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  desktopSidebarCollapsed = isDesktop && collapsed === true;
  syncSidebarCollapseState({ persist });
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("sidebar-collapse");
  }
}

function toggleSidebarCollapsed() {
  if (!isDesktop) {
    openSidebar();
    return;
  }
  setSidebarCollapsed(!desktopSidebarCollapsed);
}

function openSessionsSidebar() {
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
  if (isDesktop) {
    setSidebarCollapsed(false);
  } else {
    openSidebar();
  }
  return true;
}

function createNewSessionShortcut({ closeSidebar = true } = {}) {
  const tool = preferredTool || selectedTool || toolsList[0]?.id;
  if (!tool) return false;
  if (closeSidebar && !isDesktop) closeSidebarFn();
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
  return dispatchAction({
    action: "create",
    folder: "~",
    tool,
    group: t("sidebar.group.inbox"),
    sourceId: DEFAULT_APP_ID,
  });
}

function createSortSessionListShortcut() {
  if (typeof organizeSessionListWithAgent !== "function") return false;
  return organizeSessionListWithAgent({ closeSidebar: false });
}

function getSessionGroupingModeForSidebar() {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.getSessionGroupingMode === "function"
    ? model.getSessionGroupingMode()
    : "user";
}

function setSessionGroupingModeForSidebar(mode) {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.setSessionGroupingMode === "function"
    ? model.setSessionGroupingMode(mode)
    : "user";
}

function getSessionGroupingTemplateGroupsForSidebar() {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.getSessionGroupingTemplateGroups === "function"
    ? model.getSessionGroupingTemplateGroups()
    : [];
}

function normalizeSessionGroupingTemplateGroupsForSidebar(value) {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.normalizeSessionGroupingTemplateGroups === "function"
    ? model.normalizeSessionGroupingTemplateGroups(value)
    : [];
}

function getBranchTaskVisibilityModeForSidebar() {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.getBranchTaskVisibilityMode === "function"
    ? model.getBranchTaskVisibilityMode()
    : "show";
}

function setBranchTaskVisibilityModeForSidebar(mode) {
  const model = window.MelodySyncSessionListModel || null;
  return typeof model?.setBranchTaskVisibilityMode === "function"
    ? model.setBranchTaskVisibilityMode(mode)
    : "show";
}

function hasSessionGroupingTemplateGroupsForSidebar() {
  return getSessionGroupingTemplateGroupsForSidebar().length > 0;
}

const sidebarGroupingInlineCreateState = {
  open: false,
  runAfterSave: false,
};
let sidebarGroupingSummaryEl = null;

function ensureSidebarGroupingSummaryEl() {
  if (sidebarGroupingSummaryEl?.isConnected) return sidebarGroupingSummaryEl;
  const existing = document.getElementById("sidebarGroupingSummary");
  if (!existing) return null;
  sidebarGroupingSummaryEl = existing;
  return existing;
}

function isSessionGroupingInlineCreateOpen() {
  return sidebarGroupingInlineCreateState.open === true;
}

function closeSessionGroupingTemplatePopover() {
  if (!isSessionGroupingInlineCreateOpen()) return false;
  sidebarGroupingInlineCreateState.open = false;
  sidebarGroupingInlineCreateState.runAfterSave = false;
  renderSessionList();
  return true;
}

function openSessionGroupingTemplatePopover({ runAfterSave = false } = {}) {
  sidebarGroupingInlineCreateState.open = true;
  sidebarGroupingInlineCreateState.runAfterSave = Boolean(runAfterSave);
  renderSessionList();
  return true;
}

async function saveSessionGroupingTemplatePopover(label = "") {
  if (typeof window.saveTaskListTemplateGroups !== "function") {
    return {
      ok: false,
      reason: t("sidebar.grouping.saveFailed") || "文件夹保存失败。",
    };
  }
  const nextLabel = normalizeSessionGroupingTemplateGroupsForSidebar([label])[0] || "";
  const currentGroups = getSessionGroupingTemplateGroupsForSidebar();
  if (!nextLabel) {
    return {
      ok: false,
      reason: "请输入文件夹名称。",
    };
  }
  if (currentGroups.some((entry) => String(entry || "").trim().toLowerCase() === nextLabel.trim().toLowerCase())) {
    return {
      ok: false,
      reason: "这个文件夹已经存在。",
    };
  }
  const nextGroups = normalizeSessionGroupingTemplateGroupsForSidebar([
    ...currentGroups,
    nextLabel,
  ]);
  try {
    const payload = await window.saveTaskListTemplateGroups(nextGroups);
    const savedGroups = Array.isArray(payload?.taskListTemplateGroups) ? payload.taskListTemplateGroups : nextGroups;
    const runAfterSave = sidebarGroupingInlineCreateState.runAfterSave === true;
    syncSessionGroupingControls();
    closeSessionGroupingTemplatePopover();
    if (runAfterSave && savedGroups.length > 0 && typeof organizeSessionListWithAgent === "function") {
      void organizeSessionListWithAgent({ closeSidebar: false, skipModeSwitch: true });
    }
    return {
      ok: true,
      label: nextLabel,
      groups: savedGroups,
    };
  } catch (error) {
    console.warn("[sessions] Failed to save task list template groups:", error?.message || error);
    return {
      ok: false,
      reason: t("sidebar.grouping.saveFailed") || "文件夹保存失败。",
    };
  }
}

async function promptForSessionGroupingTemplateConfig({ runAfterSave = false } = {}) {
  if (openSessionGroupingTemplatePopover({ runAfterSave })) {
    return true;
  }
  return false;
}

async function removeSessionGroupingTemplateGroup(groupLabel = "", { runAfterSave = false } = {}) {
  const normalizedLabel = normalizeSessionGroupingTemplateGroupsForSidebar([groupLabel])[0] || "";
  if (!normalizedLabel || typeof window.saveTaskListTemplateGroups !== "function") return false;
  const currentGroups = getSessionGroupingTemplateGroupsForSidebar();
  const nextGroups = currentGroups.filter(
    (entry) => String(entry || "").trim().toLowerCase() !== normalizedLabel.trim().toLowerCase(),
  );
  if (nextGroups.length === currentGroups.length) return false;
  try {
    const payload = await window.saveTaskListTemplateGroups(nextGroups);
    const savedGroups = Array.isArray(payload?.taskListTemplateGroups) ? payload.taskListTemplateGroups : nextGroups;
    syncSessionGroupingControls();
    closeSessionGroupingTemplatePopover();
    if (runAfterSave && savedGroups.length > 0 && typeof organizeSessionListWithAgent === "function") {
      void organizeSessionListWithAgent({ closeSidebar: false, skipModeSwitch: true });
    }
    return true;
  } catch (error) {
    console.warn("[sessions] Failed to remove task list template group:", error?.message || error);
    if (typeof alert === "function") {
      alert(t("sidebar.grouping.saveFailed"));
    }
  }
  return false;
}

function syncSessionGroupingControls() {
  const groupingMode = getSessionGroupingModeForSidebar();
  const isUserMode = groupingMode === "user";
  const branchesHidden = getBranchTaskVisibilityModeForSidebar() === "hide";
  const summaryEl = ensureSidebarGroupingSummaryEl();
  sidebarGroupingToolbar?.setAttribute?.("data-grouping-mode", groupingMode);
  sidebarGroupingModeUserBtn?.classList?.toggle?.("is-active", isUserMode);
  sidebarGroupingModeAiBtn?.classList?.toggle?.("is-active", !isUserMode);
  sidebarGroupingModeUserBtn?.setAttribute?.("aria-pressed", isUserMode ? "true" : "false");
  sidebarGroupingModeAiBtn?.setAttribute?.("aria-pressed", isUserMode ? "false" : "true");
  if (sidebarBranchVisibilityToggleBtn) {
    const label = t(branchesHidden ? "sidebar.branchVisibility.show" : "sidebar.branchVisibility.hide");
    sidebarBranchVisibilityToggleBtn.textContent = label;
    sidebarBranchVisibilityToggleBtn.title = label;
    sidebarBranchVisibilityToggleBtn.setAttribute("aria-label", label);
    sidebarBranchVisibilityToggleBtn.setAttribute("aria-pressed", branchesHidden ? "true" : "false");
    sidebarBranchVisibilityToggleBtn.classList.toggle("is-active", branchesHidden);
  }
  if (sidebarGroupingConfigBtn) {
    sidebarGroupingConfigBtn.hidden = true;
  }
  if (!isUserMode) {
    closeSessionGroupingTemplatePopover();
  }
  if (summaryEl) {
    summaryEl.hidden = true;
    summaryEl.textContent = "";
  }
  if (typeof setSortSessionListButtonState === "function") {
    setSortSessionListButtonState();
  }
}

globalThis.createNewSessionShortcut = createNewSessionShortcut;
globalThis.createSortSessionListShortcut = createSortSessionListShortcut;
globalThis.syncSidebarCollapseState = syncSidebarCollapseState;
globalThis.setSidebarCollapsed = setSidebarCollapsed;
globalThis.syncSessionGroupingControls = syncSessionGroupingControls;

menuBtn.addEventListener("click", toggleSidebarCollapsed);
closeSidebar.addEventListener("click", () => {
  if (isDesktop) {
    setSidebarCollapsed(true);
    return;
  }
  closeSidebarFn();
});
sidebarOverlay.addEventListener("click", (e) => {
  if (e.target === sidebarOverlay && !isDesktop) closeSidebarFn();
});
restoreSidebarDesktopWidthPreference();
syncSidebarCollapseState({ persist: false });

sidebarResizeHandle?.addEventListener("pointerdown", (event) => {
  if (!isDesktop || desktopSidebarCollapsed === true) return;
  event.preventDefault?.();
  beginSidebarResize(event);
  try {
    sidebarResizeHandle.setPointerCapture(event.pointerId);
  } catch {}
});

sidebarResizeHandle?.addEventListener("pointermove", (event) => {
  continueSidebarResize(event);
});

sidebarResizeHandle?.addEventListener("pointerup", (event) => {
  if (sidebarResizeState && event.pointerId === sidebarResizeState.pointerId) {
    endSidebarResize();
  }
});

sidebarResizeHandle?.addEventListener("pointercancel", () => {
  endSidebarResize();
});

sidebarResizeHandle?.addEventListener("dblclick", () => {
  if (!isDesktop) return;
  resetSidebarDesktopWidthPreference();
});

window.addEventListener("resize", () => {
  if (!isDesktop || desktopSidebarCollapsed === true) {
    syncSidebarResizeHandle();
    return;
  }
  reconcileSidebarDesktopWidthPreference();
  syncSidebarResizeHandle();
});

// ---- Session list actions ----
newSessionBtn?.addEventListener("click", () => {
  createNewSessionShortcut();
});

sidebarGroupingModeUserBtn?.addEventListener("click", () => {
  setSessionGroupingModeForSidebar("user");
  if (typeof cancelSessionListOrganizerAutoRun === "function") {
    cancelSessionListOrganizerAutoRun();
  }
  syncSessionGroupingControls();
  renderSessionList();
});

sidebarGroupingModeAiBtn?.addEventListener("click", () => {
  setSessionGroupingModeForSidebar("ai");
  syncSessionGroupingControls();
  renderSessionList();
});

sidebarBranchVisibilityToggleBtn?.addEventListener("click", () => {
  const nextMode = getBranchTaskVisibilityModeForSidebar() === "hide" ? "show" : "hide";
  setBranchTaskVisibilityModeForSidebar(nextMode);
  syncSessionGroupingControls();
  renderSessionList();
});

sidebarGroupingConfigBtn?.addEventListener("click", () => {
  if (isSessionGroupingInlineCreateOpen()) {
    closeSessionGroupingTemplatePopover();
    return;
  }
  void promptForSessionGroupingTemplateConfig({ runAfterSave: false });
});

sortSessionListBtn?.addEventListener("click", () => {
  if (getSessionGroupingModeForSidebar() === "user" && !hasSessionGroupingTemplateGroupsForSidebar()) {
    void openSessionGroupingTemplatePopover({ runAfterSave: false });
    return;
  }
  createSortSessionListShortcut();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !isSessionGroupingInlineCreateOpen()) return;
  closeSessionGroupingTemplatePopover();
});

syncSessionGroupingControls();

globalThis.openSessionGroupingTemplatePopoverAtAnchor = function openSessionGroupingTemplatePopoverAtAnchor(anchorEl, options = {}) {
  return openSessionGroupingTemplatePopover(options || {});
};
globalThis.closeSessionGroupingTemplateCreate = closeSessionGroupingTemplatePopover;
globalThis.isSessionGroupingTemplateCreateOpen = isSessionGroupingInlineCreateOpen;
globalThis.saveSessionGroupingTemplateGroup = saveSessionGroupingTemplatePopover;
globalThis.removeSessionGroupingTemplateGroup = removeSessionGroupingTemplateGroup;

// ---- Attachment handling ----
const attachmentsEnabled = !!imgBtn && !!imgFileInput && !!imgPreviewStrip;

function buildPendingAttachment(file) {
  return {
    file,
    originalName: typeof file?.name === "string" ? file.name : "",
    mimeType: file.type || "application/octet-stream",
    objectUrl: URL.createObjectURL(file),
  };
}

async function addAttachmentFiles(files) {
  if (!attachmentsEnabled) return;
  if (typeof hasPendingComposerSend === "function" && hasPendingComposerSend()) {
    return;
  }
  for (const file of files) {
    if (pendingImages.length >= 4) break;
    pendingImages.push(buildPendingAttachment(file));
  }
  renderImagePreviews();
}

function renderImagePreviews() {
  if (!attachmentsEnabled || !imgPreviewStrip) return;
  imgPreviewStrip.innerHTML = "";
  if (pendingImages.length === 0) {
    imgPreviewStrip.hidden = true;
    imgPreviewStrip.classList.remove("has-images");
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("composer-images");
    } else if (typeof syncInputHeightForLayout === "function") {
      syncInputHeightForLayout();
    }
    return;
  }
  imgPreviewStrip.hidden = false;
  imgPreviewStrip.classList.add("has-images");
  const attachmentsLocked = typeof hasPendingComposerSend === "function" && hasPendingComposerSend();
  pendingImages.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = "img-preview-item";
    const previewNode = createComposerAttachmentPreviewNode(img);
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-img";
    removeBtn.type = "button";
    removeBtn.title = t("action.removeAttachment");
    removeBtn.setAttribute("aria-label", t("action.removeAttachment"));
    removeBtn.innerHTML = renderUiIcon("close");
    removeBtn.disabled = attachmentsLocked;
    removeBtn.onclick = () => {
      if (attachmentsLocked) return;
      URL.revokeObjectURL(img.objectUrl);
      pendingImages.splice(i, 1);
      renderImagePreviews();
    };
    if (previewNode) {
      item.appendChild(previewNode);
    }
    item.appendChild(removeBtn);
    imgPreviewStrip.appendChild(item);
  });
  if (typeof requestLayoutPass === "function") {
    requestLayoutPass("composer-images");
  } else if (typeof syncInputHeightForLayout === "function") {
    syncInputHeightForLayout();
  }
}

if (attachmentsEnabled) {
  imgBtn.addEventListener("click", () => {
    if (typeof hasPendingComposerSend === "function" && hasPendingComposerSend()) {
      return;
    }
    imgFileInput.click();
  });
  imgFileInput.addEventListener("change", () => {
    if (imgFileInput.files.length > 0) addAttachmentFiles(imgFileInput.files);
    imgFileInput.value = "";
  });

  msgInput.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const attachmentFiles = [];
    for (const item of items) {
      const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
      if (file) attachmentFiles.push(file);
    }
    if (attachmentFiles.length > 0) {
      e.preventDefault();
      addAttachmentFiles(attachmentFiles);
    }
  });
}
