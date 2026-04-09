const DEFAULT_MOUNT_SELECTORS = ["[data-melodysync-react-root]", "#melodysync-react-root"];

function isElement(value) {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

export function readBootstrapState() {
  if (typeof window === "undefined") return {};
  const next = window.__MELODYSYNC_REACT_BOOTSTRAP__;
  if (next && typeof next === "object") return next;
  const legacy = window.__MELODYSYNC_BOOTSTRAP__;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

export function resolveMountTarget(target = null) {
  if (typeof document === "undefined") return null;
  if (isElement(target)) return target;
  if (typeof target === "string" && target.trim()) {
    return document.querySelector(target.trim());
  }
  for (const selector of DEFAULT_MOUNT_SELECTORS) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

export function installReactBridge(api) {
  if (typeof window === "undefined") return;
  window.MelodySyncReactBridge = {
    mount: api.mount,
    unmount: api.unmount,
    getBootstrap: api.getBootstrap,
  };
}
