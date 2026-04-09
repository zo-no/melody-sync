(function sessionListReactUiShim(globalThisRef) {
  "use strict";

  const existingApi = globalThisRef.MelodySyncSessionListReactUi
    || globalThisRef.MelodySyncWorkbenchReactUi
    || null;

  const api = existingApi && typeof existingApi === "object"
    ? existingApi
    : Object.freeze({
        renderSessionList() {
          return false;
        },
      });

  globalThisRef.MelodySyncSessionListReactUi = api;
  globalThisRef.MelodySyncSessionListUi = api;
})(window);
