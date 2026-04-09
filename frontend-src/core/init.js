initResponsiveLayout();

function reportInitIssue(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return;
  console.error("[init]", text);
  if (statusText) {
    statusText.textContent = text;
  }
}

function resolveGlobalFunction(name) {
  const candidate = globalThis?.[name];
  return typeof candidate === "function" ? candidate : null;
}

async function resolveInitialAuthInfo() {
  const bootstrapAuthInfo =
    typeof getBootstrapAuthInfo === "function"
      ? getBootstrapAuthInfo()
      : null;
  if (bootstrapAuthInfo) {
    return bootstrapAuthInfo;
  }
  try {
    return await fetchJsonOrRedirect("/api/auth/me");
  } catch {
    return null;
  }
}

async function initApp() {
  await resolveInitialAuthInfo();

  const initializePushNotificationsFn = resolveGlobalFunction("initializePushNotifications");
  initializePushNotificationsFn?.();

  const loadInlineToolsFn = resolveGlobalFunction("loadInlineTools");
  const bootstrapViaHttpFn = resolveGlobalFunction("bootstrapViaHttp");
  const connectFn = resolveGlobalFunction("connect");
  const refreshWorkbenchFn = globalThis.MelodySyncWorkbench?.refresh;

  const toolsPromise = typeof loadInlineToolsFn === "function"
    ? loadInlineToolsFn({ skipModelLoad: true })
    : Promise.resolve(null);
  const sessionsPromise = typeof bootstrapViaHttpFn === "function"
    ? bootstrapViaHttpFn({ deferOwnerRestore: true })
    : Promise.resolve(null);
  const [toolsResult, sessionsResult] = await Promise.allSettled([
    toolsPromise,
    sessionsPromise,
  ]);

  if (toolsResult.status === "rejected") {
    reportInitIssue(`工具加载失败: ${toolsResult.reason?.message || toolsResult.reason || "unknown error"}`);
  }
  if (sessionsResult.status === "rejected") {
    reportInitIssue(`会话加载失败: ${sessionsResult.reason?.message || sessionsResult.reason || "unknown error"}`);
    window.setTimeout(() => {
      bootstrapViaHttp({ deferOwnerRestore: false })
        .then(() => {
          if (statusText?.textContent?.includes?.("会话加载失败")) {
            statusText.textContent = "";
          }
        })
        .catch((error) => {
          reportInitIssue(`会话重试失败: ${error?.message || error || "unknown error"}`);
        });
    }, 800);
  } else {
    restoreOwnerSessionSelection();
  }
  connectFn?.();
  if (typeof loadModelsForCurrentTool === "function") {
    void loadModelsForCurrentTool();
  }
  if (typeof refreshWorkbenchFn === "function") {
    void refreshWorkbenchFn();
  }
}

initApp().catch((error) => {
  reportInitIssue(`页面初始化失败: ${error?.message || error || "unknown error"}`);
});
