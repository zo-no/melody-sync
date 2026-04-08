initResponsiveLayout();

function reportInitIssue(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return;
  console.error("[init]", text);
  if (statusText) {
    statusText.textContent = text;
  }
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

  initializePushNotifications();

  const toolsPromise = loadInlineTools({ skipModelLoad: true });
  const sessionsPromise = bootstrapViaHttp({ deferOwnerRestore: true });
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
  connect();
  void loadModelsForCurrentTool();
  if (typeof window.MelodySyncWorkbench?.refresh === "function") {
    void window.MelodySyncWorkbench.refresh();
  }
}

initApp().catch((error) => {
  reportInitIssue(`页面初始化失败: ${error?.message || error || "unknown error"}`);
});
