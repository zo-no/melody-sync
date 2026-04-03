(function workbenchNodeContractModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;
  const FALLBACK_NODE_LANES = Object.freeze(["main", "branch", "side"]);
  const FALLBACK_NODE_ROLES = Object.freeze(["state", "action", "summary"]);
  const FALLBACK_NODE_MERGE_POLICIES = Object.freeze(["replace-latest", "append"]);

  function normalizeToken(value, fallback, allowlist) {
    const normalized = String(value || "").trim().toLowerCase();
    return allowlist.includes(normalized) ? normalized : fallback;
  }

  function normalizeTokenList(values, fallback) {
    if (!Array.isArray(values) || values.length === 0) {
      return [...fallback];
    }
    const normalized = values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    if (normalized.length === 0) {
      return [...fallback];
    }
    return [...new Set(normalized)];
  }

  function readBootstrapNodeContract() {
    const bootstrapStore = root?.MelodySyncBootstrap || root?.window?.MelodySyncBootstrap;
    const pageBootstrap = bootstrapStore?.getBootstrap?.();
    const workbench = pageBootstrap?.workbench;
    if (!workbench || typeof workbench !== "object") {
      return {};
    }
    return workbench;
  }

  const bootstrapNodeContract = readBootstrapNodeContract();
  const NODE_LANES = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeLanes, FALLBACK_NODE_LANES),
  );
  const NODE_ROLES = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeRoles, FALLBACK_NODE_ROLES),
  );
  const NODE_MERGE_POLICIES = Object.freeze(
    normalizeTokenList(
      bootstrapNodeContract.nodeMergePolicies,
      FALLBACK_NODE_MERGE_POLICIES,
    ),
  );

  function defineNodeKind(definition = {}) {
    const id = String(definition.id || "").trim();
    if (!id) {
      throw new Error("Node kind definition requires id");
    }
    return Object.freeze({
      id,
      label: String(definition.label || id).trim(),
      description: String(definition.description || "").trim(),
      lane: normalizeToken(definition.lane, "main", NODE_LANES),
      role: normalizeToken(definition.role, "state", NODE_ROLES),
      sessionBacked: definition.sessionBacked === true,
      derived: definition.derived === true,
      mergePolicy: normalizeToken(definition.mergePolicy, "replace-latest", NODE_MERGE_POLICIES),
    });
  }

  const FALLBACK_NODE_KIND_DEFINITIONS = Object.freeze([
    defineNodeKind({
      id: "main",
      label: "主任务",
      description: "主任务根节点，对应主 session。",
      lane: "main",
      role: "state",
      sessionBacked: true,
      derived: false,
      mergePolicy: "replace-latest",
    }),
    defineNodeKind({
      id: "branch",
      label: "子任务",
      description: "已经拆出的真实支线 session。",
      lane: "branch",
      role: "state",
      sessionBacked: true,
      derived: false,
      mergePolicy: "append",
    }),
    defineNodeKind({
      id: "candidate",
      label: "建议子任务",
      description: "系统建议但尚未真正展开的下一条执行线。",
      lane: "branch",
      role: "action",
      sessionBacked: false,
      derived: true,
      mergePolicy: "replace-latest",
    }),
    defineNodeKind({
      id: "done",
      label: "收束",
      description: "当前主任务下的现有支线已经全部收束。",
      lane: "main",
      role: "summary",
      sessionBacked: false,
      derived: true,
      mergePolicy: "replace-latest",
    }),
  ]);

  function getRawNodeKindDefinitions() {
    if (
      Array.isArray(bootstrapNodeContract.nodeKindDefinitions)
      && bootstrapNodeContract.nodeKindDefinitions.length > 0
    ) {
      return bootstrapNodeContract.nodeKindDefinitions;
    }
    return FALLBACK_NODE_KIND_DEFINITIONS;
  }

  const NODE_KIND_DEFINITIONS = Object.freeze(
    getRawNodeKindDefinitions().map((definition) => defineNodeKind(definition)),
  );

  const NODE_KIND_INDEX = new Map(
    NODE_KIND_DEFINITIONS.map((definition) => [definition.id, definition]),
  );

  function listNodeKindDefinitions() {
    return NODE_KIND_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  function getNodeKindDefinition(kind) {
    const definition = NODE_KIND_INDEX.get(String(kind || "").trim());
    return definition ? { ...definition } : null;
  }

  function isKnownNodeKind(kind) {
    return NODE_KIND_INDEX.has(String(kind || "").trim());
  }

  const contract = {
    NODE_KIND_DEFINITIONS,
    NODE_KINDS: Object.freeze(NODE_KIND_DEFINITIONS.map((definition) => definition.id)),
    NODE_LANES,
    NODE_ROLES,
    NODE_MERGE_POLICIES,
    listNodeKindDefinitions,
    getNodeKindDefinition,
    isKnownNodeKind,
  };

  root.MelodySyncWorkbenchNodeContract = contract;
  if (typeof window === "object" && window && window !== root) {
    window.MelodySyncWorkbenchNodeContract = contract;
  }
})();
