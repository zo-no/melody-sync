// ---- Sidebar ----
function t(key, vars) {
  return window.remotelabT ? window.remotelabT(key, vars) : key;
}

function openSidebar() {
  sidebarOverlay.classList.add("open");
}
function closeSidebarFn() {
  sidebarOverlay.classList.remove("open");
}

function openSessionsSidebar() {
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
  openSidebar();
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
    sourceName: DEFAULT_APP_NAME,
  });
}

function createSortSessionListShortcut() {
  if (typeof organizeSessionListWithAgent !== "function") return false;
  return organizeSessionListWithAgent({ closeSidebar: false });
}

globalThis.createNewSessionShortcut = createNewSessionShortcut;
globalThis.createSortSessionListShortcut = createSortSessionListShortcut;

menuBtn.addEventListener("click", openSidebar);
closeSidebar.addEventListener("click", closeSidebarFn);
sidebarOverlay.addEventListener("click", (e) => {
  if (e.target === sidebarOverlay && !isDesktop) closeSidebarFn();
});

// ---- Session list actions ----
newSessionBtn?.addEventListener("click", () => {
  createNewSessionShortcut();
});

sortSessionListBtn?.addEventListener("click", () => {
  createSortSessionListShortcut();
});

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
