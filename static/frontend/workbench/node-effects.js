(function workbenchNodeEffectsModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getTaskRunStatusApi() {
    return root?.MelodySyncTaskRunStatus
      || root?.window?.MelodySyncTaskRunStatus
      || null;
  }

  function getTaskRunStatusUi(options = {}) {
    return getTaskRunStatusApi()?.getTaskRunStatusUi?.(options) || { label: "", summary: "" };
  }

  function freezeEffect(effect) {
    return Object.freeze({
      ...effect,
      capabilities: Object.freeze(Array.isArray(effect?.capabilities) ? [...new Set(effect.capabilities)] : []),
      surfaceBindings: Object.freeze(Array.isArray(effect?.surfaceBindings) ? [...new Set(effect.surfaceBindings)] : ["task-map"]),
      taskCardBindings: Object.freeze(Array.isArray(effect?.taskCardBindings) ? [...new Set(effect.taskCardBindings)] : []),
      countsAs: Object.freeze({
        sessionNode: effect?.countsAs?.sessionNode === true,
        branch: effect?.countsAs?.branch === true,
        candidate: effect?.countsAs?.candidate === true,
        completedSummary: effect?.countsAs?.completedSummary === true,
      }),
    });
  }

  const BUILTIN_EFFECT_OVERRIDES = Object.freeze({
    main: freezeEffect({
      layoutVariant: "root",
      edgeVariant: "structural",
      interaction: "open-session",
      actionLabel: "",
      trackAsCandidateChild: false,
      metaVariant: "root",
      defaultSummary: "",
      fallbackSummary: "",
      defaultViewType: "flow-node",
      capabilities: ["open-session"],
      surfaceBindings: ["task-map"],
      taskCardBindings: ["mainGoal"],
      countsAs: {
        sessionNode: true,
        branch: false,
        candidate: false,
        completedSummary: false,
      },
    }),
    branch: freezeEffect({
      layoutVariant: "default",
      edgeVariant: "structural",
      interaction: "open-session",
      actionLabel: "",
      trackAsCandidateChild: false,
      metaVariant: "branch-status",
      defaultSummary: "",
      fallbackSummary: "",
      defaultViewType: "flow-node",
      capabilities: ["open-session"],
      surfaceBindings: ["task-map"],
      taskCardBindings: ["goal"],
      countsAs: {
        sessionNode: true,
        branch: true,
        candidate: false,
        completedSummary: false,
      },
    }),
    candidate: freezeEffect({
      layoutVariant: "compact",
      edgeVariant: "suggestion",
      interaction: "create-branch",
      actionLabel: "开启支线",
      trackAsCandidateChild: true,
      metaVariant: "candidate",
      defaultSummary: "建议拆成独立支线",
      fallbackSummary: "适合单独展开",
      defaultViewType: "flow-node",
      capabilities: ["create-branch", "dismiss"],
      surfaceBindings: ["task-map", "composer-suggestions"],
      taskCardBindings: ["candidateBranches"],
      countsAs: {
        sessionNode: false,
        branch: false,
        candidate: true,
        completedSummary: false,
      },
    }),
    done: freezeEffect({
      layoutVariant: "compact",
      edgeVariant: "completion",
      interaction: "none",
      actionLabel: "",
      trackAsCandidateChild: false,
      metaVariant: "done",
      defaultSummary: "",
      fallbackSummary: "",
      defaultViewType: "flow-node",
      capabilities: [],
      surfaceBindings: ["task-map"],
      taskCardBindings: [],
      countsAs: {
        sessionNode: true,
        branch: false,
        candidate: false,
        completedSummary: true,
      },
    }),
  });

  function readNodeContract() {
    return root?.MelodySyncWorkbenchNodeContract
      || root?.window?.MelodySyncWorkbenchNodeContract
      || null;
  }

  function getNodeKindDefinition(kind) {
    const nodeContract = readNodeContract();
    return nodeContract?.getNodeKindDefinition?.(kind) || null;
  }

  function buildDefaultEffect(definition = {}) {
    const kind = trimText(definition.id || "");
    const sessionBacked = definition.sessionBacked === true;
    const derived = definition.derived === true;
    const composition = definition?.composition && typeof definition.composition === "object"
      ? definition.composition
      : {};
    const defaultViewType = trimText(composition.defaultViewType || "") || "flow-node";
    const defaultInteraction = trimText(composition.defaultInteraction || "") || (sessionBacked ? "open-session" : "none");
    const isCanvasView = defaultViewType !== "flow-node";
    return {
      kind,
      layoutVariant: trimText(composition.layoutVariant || "") || (derived ? "compact" : "default"),
      edgeVariant: trimText(composition.defaultEdgeType || "") || "structural",
      interaction: defaultInteraction,
      actionLabel: "",
      trackAsCandidateChild: false,
      metaVariant: sessionBacked ? "branch-status" : (isCanvasView ? "canvas-view" : ""),
      defaultSummary: "",
      fallbackSummary: "",
      defaultViewType,
      capabilities: Array.isArray(composition.capabilities)
        ? composition.capabilities.map((value) => trimText(value).toLowerCase()).filter(Boolean)
        : (defaultInteraction === "open-session" ? ["open-session"] : (defaultInteraction === "create-branch" ? ["create-branch"] : [])),
      surfaceBindings: Array.isArray(composition.surfaceBindings)
        ? composition.surfaceBindings.map((value) => trimText(value).toLowerCase()).filter(Boolean)
        : (kind === "candidate" ? ["task-map", "composer-suggestions"] : ["task-map"]),
      taskCardBindings: Array.isArray(composition.taskCardBindings)
        ? composition.taskCardBindings.map((value) => trimText(value)).filter(Boolean)
        : (kind === "candidate" ? ["candidateBranches"] : (kind === "main" ? ["mainGoal"] : (kind === "branch" ? ["goal"] : []))),
      countsAs: {
        sessionNode: composition?.countsAs?.sessionNode === true || sessionBacked,
        branch: composition?.countsAs?.branch === true,
        candidate: composition?.countsAs?.candidate === true,
        completedSummary: composition?.countsAs?.completedSummary === true,
      },
    };
  }

  function mergeEffect(baseEffect, override = null) {
    if (!override) return freezeEffect(baseEffect);
    return freezeEffect({
      ...baseEffect,
      ...override,
      countsAs: {
        ...baseEffect.countsAs,
        ...override.countsAs,
      },
    });
  }

  function getNodeKindEffect(kind, definitionOverride = null) {
    const normalizedKind = trimText(kind);
    const definition = definitionOverride || getNodeKindDefinition(normalizedKind) || { id: normalizedKind };
    const baseEffect = buildDefaultEffect(definition);
    const override = BUILTIN_EFFECT_OVERRIDES[normalizedKind] || null;
    return mergeEffect(baseEffect, override);
  }

  function getNodeEffect(nodeOrKind, definitionOverride = null) {
    if (nodeOrKind && typeof nodeOrKind === "object") {
      if (nodeOrKind.kindEffect && typeof nodeOrKind.kindEffect === "object") {
        return nodeOrKind.kindEffect;
      }
      return getNodeKindEffect(nodeOrKind.kind, definitionOverride);
    }
    return getNodeKindEffect(nodeOrKind, definitionOverride);
  }

  function withNodeKindEffect(node = {}, definitionOverride = null) {
    const effect = getNodeEffect(node, definitionOverride);
    return {
      ...node,
      kindEffect: effect,
    };
  }

  function shouldTrackCandidateChild(nodeOrKind) {
    return getNodeEffect(nodeOrKind)?.trackAsCandidateChild === true;
  }

  function normalizeAllowedTokenList(values, allowlist, fallback = []) {
    const allowlistMap = new Map(
      (Array.isArray(allowlist) ? allowlist : []).map((value) => [trimText(value).toLowerCase(), value]),
    );
    if (!Array.isArray(values) || values.length === 0) return [...fallback];
    const normalized = values
      .map((value) => trimText(value).toLowerCase())
      .filter((value) => allowlistMap.has(value))
      .map((value) => allowlistMap.get(value));
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
  }

  function normalizeDimension(value, { min = 120, max = 1280 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = Math.round(numeric);
    if (normalized < min || normalized > max) return null;
    return normalized;
  }

  function normalizeNodeViewType(value) {
    const normalized = trimText(value).toLowerCase();
    return ["flow-node", "markdown", "html", "iframe"].includes(normalized)
      ? normalized
      : "flow-node";
  }

  function normalizeHtmlRenderMode(value) {
    const normalized = trimText(value).toLowerCase();
    return ["inline", "iframe"].includes(normalized)
      ? normalized
      : "iframe";
  }

  function getNodeCapabilities(nodeOrKind, definitionOverride = null) {
    const effect = getNodeEffect(nodeOrKind, definitionOverride);
    if (nodeOrKind && typeof nodeOrKind === "object") {
      return normalizeAllowedTokenList(
        nodeOrKind.capabilities,
        ["open-session", "create-branch", "dismiss"],
        effect?.capabilities || [],
      );
    }
    return [...(effect?.capabilities || [])];
  }

  function getNodeSurfaceBindings(nodeOrKind, definitionOverride = null) {
    const effect = getNodeEffect(nodeOrKind, definitionOverride);
    if (nodeOrKind && typeof nodeOrKind === "object") {
      return normalizeAllowedTokenList(
        nodeOrKind.surfaceBindings,
        ["task-map", "composer-suggestions"],
        effect?.surfaceBindings || ["task-map"],
      );
    }
    return [...(effect?.surfaceBindings || ["task-map"])];
  }

  function getNodeTaskCardBindings(nodeOrKind, definitionOverride = null) {
    const effect = getNodeEffect(nodeOrKind, definitionOverride);
    if (nodeOrKind && typeof nodeOrKind === "object") {
      return normalizeAllowedTokenList(
        nodeOrKind.taskCardBindings,
        ["mainGoal", "goal", "candidateBranches", "summary", "checkpoint", "nextSteps"],
        effect?.taskCardBindings || [],
      );
    }
    return [...(effect?.taskCardBindings || [])];
  }

  function getNodeView(nodeOrKind, definitionOverride = null) {
    const effect = getNodeEffect(nodeOrKind, definitionOverride);
    const view = nodeOrKind && typeof nodeOrKind === "object" && nodeOrKind.view && typeof nodeOrKind.view === "object"
      ? nodeOrKind.view
      : null;
    const type = normalizeNodeViewType(view?.type || effect?.defaultViewType || "flow-node");
    return {
      type,
      renderMode: type === "html" ? normalizeHtmlRenderMode(view?.renderMode) : "",
      content: typeof view?.content === "string" ? view.content : "",
      src: trimText(view?.src),
      width: normalizeDimension(view?.width, { min: 180, max: 1440 }),
      height: normalizeDimension(view?.height, { min: 120, max: 1200 }),
    };
  }

  function buildQuestNodeCounts(nodes = []) {
    let sessionNodes = 0;
    let activeBranches = 0;
    let parkedBranches = 0;
    let completedBranches = 0;
    let candidateBranches = 0;

    for (const node of Array.isArray(nodes) ? nodes : []) {
      const effect = getNodeEffect(node);
      const countsAs = effect?.countsAs || {};
      if (countsAs.sessionNode) {
        sessionNodes += 1;
      }
      if (countsAs.branch) {
        if (node?.status === "active") activeBranches += 1;
        if (node?.status === "parked") parkedBranches += 1;
        if (["resolved", "merged"].includes(node?.status)) completedBranches += 1;
      }
      if (countsAs.candidate) {
        candidateBranches += 1;
      }
    }

    return {
      sessionNodes,
      activeBranches,
      parkedBranches,
      completedBranches,
      candidateBranches,
    };
  }

  function getNodeMetaLabel(
    node,
    {
      getTaskRunStatusUi: resolveTaskRunStatusUi = getTaskRunStatusUi,
    } = {},
  ) {
    const effect = getNodeEffect(node);
    if (!trimText(node?.parentNodeId || "")) {
      return trimText(resolveTaskRunStatusUi({
        status: node?.status,
        isCurrent: node?.isCurrent === true,
        isCurrentPath: node?.isCurrentPath === true,
      })?.label || "");
    }
    if (getNodeView(node)?.type !== "flow-node") {
      return "画布";
    }
    switch (effect?.metaVariant) {
      case "candidate":
        return "可选";
      case "done":
        return "已收束";
      case "canvas-view":
        return "画布";
      case "branch-status":
        return trimText(resolveTaskRunStatusUi({
          status: node?.status,
          isCurrent: node?.isCurrent === true,
          isCurrentPath: node?.isCurrentPath === true,
        })?.label || "");
      default:
        return "";
    }
  }

  function getNodeSummaryText(node, activeQuest, { clipText = (value) => String(value || "").trim() } = {}) {
    if (!node) return "";
    const effect = getNodeEffect(node);
    if (!trimText(node?.parentNodeId || "")) {
      const rootSummary = clipText(node.summary || activeQuest?.summary || "", 72);
      if (rootSummary) return rootSummary;
      const currentNodeTitle = clipText(activeQuest?.currentNodeTitle || "", 40);
      if (currentNodeTitle && currentNodeTitle !== clipText(node.title || "", 40)) {
        return `当前焦点：${currentNodeTitle}`;
      }
      return "";
    }
    if (effect?.interaction === "create-branch") {
      return clipText(node.summary || effect.fallbackSummary || effect.defaultSummary || "", 72);
    }
    return clipText(node.summary || effect?.fallbackSummary || "", 72);
  }

  const api = Object.freeze({
    getNodeKindEffect,
    getNodeEffect,
    withNodeKindEffect,
    shouldTrackCandidateChild,
    getNodeCapabilities,
    getNodeSurfaceBindings,
    getNodeTaskCardBindings,
    getNodeView,
    buildQuestNodeCounts,
    getNodeMetaLabel,
    getNodeSummaryText,
  });

  root.MelodySyncWorkbenchNodeEffects = api;
  if (typeof window === "object" && window && window !== root) {
    window.MelodySyncWorkbenchNodeEffects = api;
  }
})();
