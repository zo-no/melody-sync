(function workbenchNodeContractModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;
  const FALLBACK_NODE_LANES = Object.freeze(["main", "branch", "side"]);
  const FALLBACK_NODE_ROLES = Object.freeze(["state", "action", "summary"]);
  const FALLBACK_NODE_MERGE_POLICIES = Object.freeze(["replace-latest", "append"]);
  const FALLBACK_NODE_INTERACTIONS = Object.freeze(["open-session", "create-branch", "none"]);
  const FALLBACK_NODE_EDGE_TYPES = Object.freeze(["structural", "suggestion", "completion", "merge"]);
  const FALLBACK_NODE_LAYOUT_VARIANTS = Object.freeze(["root", "default", "compact", "panel"]);
  const FALLBACK_NODE_CAPABILITIES = Object.freeze(["open-session", "create-branch", "dismiss"]);
  const FALLBACK_NODE_SURFACE_SLOTS = Object.freeze(["task-map", "composer-suggestions"]);
  const FALLBACK_NODE_VIEW_TYPES = Object.freeze(["flow-node", "markdown", "html", "iframe"]);

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

  function normalizeAllowedTokenList(values, fallback, allowlist) {
    if (!Array.isArray(values) || values.length === 0) {
      return [...fallback];
    }
    const normalized = values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => allowlist.includes(value));
    if (normalized.length === 0) {
      return [...fallback];
    }
    return [...new Set(normalized)];
  }

  function normalizeNodeKindIdList(values, fallback) {
    const source = Array.isArray(values) ? values : fallback;
    const normalized = source
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => /^[a-z][a-z0-9-]{0,47}$/.test(value));
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
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
  const NODE_INTERACTIONS = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeInteractions, FALLBACK_NODE_INTERACTIONS),
  );
  const NODE_EDGE_TYPES = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeEdgeTypes, FALLBACK_NODE_EDGE_TYPES),
  );
  const NODE_LAYOUT_VARIANTS = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeLayoutVariants, FALLBACK_NODE_LAYOUT_VARIANTS),
  );
  const NODE_CAPABILITIES = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeCapabilities, FALLBACK_NODE_CAPABILITIES),
  );
  const NODE_SURFACE_SLOTS = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeSurfaceSlots, FALLBACK_NODE_SURFACE_SLOTS),
  );
  const NODE_VIEW_TYPES = Object.freeze(
    normalizeTokenList(bootstrapNodeContract.nodeViewTypes, FALLBACK_NODE_VIEW_TYPES),
  );

  function defineNodeComposition(definition = {}, normalizedDefinition = {}) {
    const composition = definition?.composition && typeof definition.composition === "object"
      ? definition.composition
      : {};
    return Object.freeze({
      canBeRoot: composition.canBeRoot === true,
      allowedParentKinds: normalizeNodeKindIdList(
        composition.allowedParentKinds,
        normalizedDefinition.sessionBacked ? ["main", "branch"] : ["main", "branch"],
      ),
      allowedChildKinds: normalizeNodeKindIdList(
        composition.allowedChildKinds,
        normalizedDefinition.sessionBacked ? ["branch", "candidate", "done"] : [],
      ),
      requiresSourceSession: composition.requiresSourceSession !== false,
      defaultInteraction: normalizeToken(
        composition.defaultInteraction,
        normalizedDefinition.sessionBacked ? "open-session" : "none",
        NODE_INTERACTIONS,
      ),
      defaultEdgeType: normalizeToken(
        composition.defaultEdgeType,
        "structural",
        NODE_EDGE_TYPES,
      ),
      defaultViewType: normalizeToken(
        composition.defaultViewType,
        "flow-node",
        NODE_VIEW_TYPES,
      ),
      layoutVariant: normalizeToken(
        composition.layoutVariant,
        normalizedDefinition.sessionBacked ? "default" : (normalizedDefinition.derived ? "compact" : "default"),
        NODE_LAYOUT_VARIANTS,
      ),
      capabilities: normalizeAllowedTokenList(
        composition.capabilities,
        normalizeToken(
          composition.defaultInteraction,
          normalizedDefinition.sessionBacked ? "open-session" : "none",
          NODE_INTERACTIONS,
        ) === "open-session"
          ? ["open-session"]
          : (normalizeToken(
            composition.defaultInteraction,
            normalizedDefinition.sessionBacked ? "open-session" : "none",
            NODE_INTERACTIONS,
          ) === "create-branch" ? ["create-branch"] : []),
        NODE_CAPABILITIES,
      ),
      surfaceBindings: normalizeAllowedTokenList(
        composition.surfaceBindings,
        normalizedDefinition.id === "candidate" ? ["task-map", "composer-suggestions"] : ["task-map"],
        NODE_SURFACE_SLOTS,
      ),
      countsAs: Object.freeze({
        sessionNode: composition?.countsAs?.sessionNode === true || normalizedDefinition.sessionBacked === true,
        branch: composition?.countsAs?.branch === true,
        candidate: composition?.countsAs?.candidate === true,
        completedSummary: composition?.countsAs?.completedSummary === true,
      }),
    });
  }

  function defineNodeKind(definition = {}) {
    const id = String(definition.id || "").trim();
    if (!id) {
      throw new Error("Node kind definition requires id");
    }
    const normalizedDefinition = {
      id,
      label: String(definition.label || id).trim(),
      description: String(definition.description || "").trim(),
      lane: normalizeToken(definition.lane, "main", NODE_LANES),
      role: normalizeToken(definition.role, "state", NODE_ROLES),
      sessionBacked: definition.sessionBacked === true,
      derived: definition.derived === true,
      mergePolicy: normalizeToken(definition.mergePolicy, "replace-latest", NODE_MERGE_POLICIES),
    };
    return Object.freeze({
      ...normalizedDefinition,
      composition: defineNodeComposition(definition, normalizedDefinition),
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
      composition: {
        canBeRoot: true,
        allowedParentKinds: [],
        allowedChildKinds: ["branch", "candidate", "done"],
        requiresSourceSession: true,
        defaultInteraction: "open-session",
        defaultEdgeType: "structural",
        defaultViewType: "flow-node",
        layoutVariant: "root",
        capabilities: ["open-session"],
        surfaceBindings: ["task-map"],
        countsAs: {
          sessionNode: true,
          branch: false,
          candidate: false,
          completedSummary: false,
        },
      },
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
      composition: {
        canBeRoot: false,
        allowedParentKinds: ["main", "branch"],
        allowedChildKinds: ["branch", "candidate", "done"],
        requiresSourceSession: true,
        defaultInteraction: "open-session",
        defaultEdgeType: "structural",
        defaultViewType: "flow-node",
        layoutVariant: "default",
        capabilities: ["open-session"],
        surfaceBindings: ["task-map"],
        countsAs: {
          sessionNode: true,
          branch: true,
          candidate: false,
          completedSummary: false,
        },
      },
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
      composition: {
        canBeRoot: false,
        allowedParentKinds: ["main", "branch"],
        allowedChildKinds: [],
        requiresSourceSession: true,
        defaultInteraction: "create-branch",
        defaultEdgeType: "suggestion",
        defaultViewType: "flow-node",
        layoutVariant: "compact",
        capabilities: ["create-branch", "dismiss"],
        surfaceBindings: ["task-map", "composer-suggestions"],
        countsAs: {
          sessionNode: false,
          branch: false,
          candidate: true,
          completedSummary: false,
        },
      },
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
      composition: {
        canBeRoot: false,
        allowedParentKinds: ["main", "branch"],
        allowedChildKinds: [],
        requiresSourceSession: true,
        defaultInteraction: "none",
        defaultEdgeType: "completion",
        defaultViewType: "flow-node",
        layoutVariant: "compact",
        capabilities: [],
        surfaceBindings: ["task-map"],
        countsAs: {
          sessionNode: true,
          branch: false,
          candidate: false,
          completedSummary: true,
        },
      },
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
    NODE_INTERACTIONS,
    NODE_EDGE_TYPES,
    NODE_LAYOUT_VARIANTS,
    NODE_CAPABILITIES,
    NODE_SURFACE_SLOTS,
    NODE_VIEW_TYPES,
    listNodeKindDefinitions,
    getNodeKindDefinition,
    isKnownNodeKind,
  };

  root.MelodySyncWorkbenchNodeContract = contract;
  if (typeof window === "object" && window && window !== root) {
    window.MelodySyncWorkbenchNodeContract = contract;
  }
})();
