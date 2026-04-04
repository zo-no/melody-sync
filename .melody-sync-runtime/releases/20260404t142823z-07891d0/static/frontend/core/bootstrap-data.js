(function (root) {
  "use strict";

  function clonePlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return JSON.parse(JSON.stringify(value));
  }

  function readWindowPayload(key) {
    return clonePlainRecord(root[key]);
  }

  function writeWindowPayload(key, value) {
    const nextValue = clonePlainRecord(value);
    root[key] = nextValue;
    return nextValue;
  }

  const api = {
    read(key, fallback = {}) {
      const direct = readWindowPayload(key);
      if (Object.keys(direct).length > 0) return direct;
      return clonePlainRecord(fallback);
    },
    getBuildInfo() {
      return api.read("__REMOTELAB_BUILD__");
    },
    getBootstrap() {
      return api.read("__REMOTELAB_BOOTSTRAP__");
    },
    getSharePayload() {
      return api.read("__REMOTELAB_SHARE__");
    },
    setBuildInfo(value) {
      return writeWindowPayload("__REMOTELAB_BUILD__", value);
    },
    setBootstrap(value) {
      return writeWindowPayload("__REMOTELAB_BOOTSTRAP__", value);
    },
    setSharePayload(value) {
      return writeWindowPayload("__REMOTELAB_SHARE__", value);
    },
  };

  root.MelodySyncBootstrap = api;
})(window);
