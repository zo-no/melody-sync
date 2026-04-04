(function () {
  "use strict";

  const nonce = document.currentScript?.nonce || "";
  const splitAssetPaths = [
    "/marked.min.js",
    "/chat/core/bootstrap-data.js",
    "/chat/core/i18n.js",
    "/chat/session-list/order-contract.js",
    "/chat/session/state-model.js",
    "/chat/core/icons.js",
    "/chat/core/bootstrap.js",
    "/chat/core/bootstrap-session-catalog.js",
    "/chat/session-list/contract.js",
    "/chat/session/http-helpers.js",
    "/chat/session/http-list-state.js",
    "/chat/session/http.js",
    "/chat/core/layout-tooling.js",
    "/chat/session/tooling.js",
    "/chat/core/realtime.js",
    "/chat/core/realtime-render.js",
    "/chat/session/transcript-ui.js",
    "/chat/session/surface-ui.js",
    "/chat/session-list/model.js",
    "/chat/session-list/ui.js",
    "/chat/session-list/sidebar-ui.js",
    "/chat/workbench/node-contract.js",
    "/chat/workbench/node-effects.js",
    "/chat/workbench/node-instance.js",
    "/chat/workbench/graph-model.js",
    "/chat/workbench/node-capabilities.js",
    "/chat/workbench/node-task-card.js",
    "/chat/workbench/graph-client.js",
    "/chat/workbench/node-settings-model.js",
    "/chat/workbench/task-map-plan.js",
    "/chat/workbench/surface-projection.js",
    "/chat/workbench/task-map-clusters.js",
    "/chat/workbench/task-map-mock-presets.js",
    "/chat/workbench/task-map-model.js",
    "/chat/workbench/quest-state.js",
    "/chat/workbench/task-tracker-ui.js",
    "/chat/workbench/node-rich-view-ui.js",
    "/chat/workbench/node-canvas-ui.js",
    "/chat/workbench/task-map-ui.js",
    "/chat/workbench/task-list-ui.js",
    "/chat/workbench/branch-actions.js",
    "/chat/workbench/operation-record-ui.js",
    "/chat/workbench/controller.js",
    "/chat/session/compose.js",
    "/chat/core/gestures.js",
    "/chat/settings/ui.js",
    "/chat/settings/hooks/model.js",
    "/chat/settings/general/ui.js",
    "/chat/settings/voice/ui.js",
    "/chat/workbench/node-settings-ui.js",
    "/chat/settings/hooks/ui.js",
    "/chat/core/init.js",
  ];

  function normalizeAssetVersion(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return normalized || "";
  }

  async function resolveAssetVersion() {
    const bootstrapVersion = normalizeAssetVersion(window.__REMOTELAB_BUILD__?.assetVersion);
    if (bootstrapVersion) return bootstrapVersion;

    const currentScriptSrc = document.currentScript?.src || "";
    if (currentScriptSrc) {
      try {
        const url = new URL(currentScriptSrc, window.location.href);
        const scriptVersion = normalizeAssetVersion(url.searchParams.get("v"));
        if (scriptVersion) return scriptVersion;
      } catch {}
    }

    try {
      const response = await fetch("/api/build-info", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return "";
      const data = await response.json().catch(() => null);
      return normalizeAssetVersion(data?.assetVersion);
    } catch {
      return "";
    }
  }

  function buildVersionedAssetPath(path, assetVersion) {
    const normalizedPath = typeof path === "string" ? path : String(path || "");
    if (!assetVersion) return normalizedPath;
    const separator = normalizedPath.includes("?") ? "&" : "?";
    return `${normalizedPath}${separator}v=${encodeURIComponent(assetVersion)}`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      if (nonce) script.nonce = nonce;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  (async () => {
    const assetVersion = await resolveAssetVersion();
    for (const path of splitAssetPaths) {
      await loadScript(buildVersionedAssetPath(path, assetVersion));
    }
  })().catch((error) => {
    console.error("[chat] Failed to load frontend assets:", error);
  });
})();
