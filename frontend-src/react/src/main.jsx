import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { installReactBridge, readBootstrapState, resolveMountTarget } from "./runtime/bootstrap.js";
import "./styles/app.css";

let activeRoot = null;

export function mountMelodySyncReactApp({ target = null, bootstrap = null } = {}) {
  const mountTarget = resolveMountTarget(target);
  if (!mountTarget) return null;

  const root = createRoot(mountTarget);
  const payload = bootstrap || readBootstrapState();

  root.render(<App bootstrap={payload} />);

  activeRoot = root;
  return {
    root,
    unmount() {
      root.unmount();
      if (activeRoot === root) activeRoot = null;
    },
  };
}

export function unmountMelodySyncReactApp() {
  if (!activeRoot) return;
  activeRoot.unmount();
  activeRoot = null;
}

installReactBridge({
  mount: mountMelodySyncReactApp,
  unmount: unmountMelodySyncReactApp,
  getBootstrap: readBootstrapState,
});

const autoMount = resolveMountTarget();
if (autoMount) {
  mountMelodySyncReactApp({ target: autoMount });
}
