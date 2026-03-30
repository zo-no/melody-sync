initResponsiveLayout();

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

  syncForkButton();

  initializePushNotifications();

  const toolsPromise = loadInlineTools({ skipModelLoad: true });
  const sessionsPromise = bootstrapViaHttp({ deferOwnerRestore: true });

  await Promise.all([toolsPromise, sessionsPromise]);
  restoreOwnerSessionSelection();
  connect();
  void loadModelsForCurrentTool();
}

initApp();
