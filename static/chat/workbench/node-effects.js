(function workbenchNodeEffectsModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function freezeEffect(effect) {
    return Object.freeze({
      ...effect,
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
    return {
      kind,
      layoutVariant: trimText(composition.layoutVariant || "") || (derived ? "compact" : "default"),
      edgeVariant: trimText(composition.defaultEdgeType || "") || "structural",
      interaction: trimText(composition.defaultInteraction || "") || (sessionBacked ? "open-session" : "none"),
      actionLabel: "",
      trackAsCandidateChild: false,
      metaVariant: sessionBacked ? "branch-status" : "",
      defaultSummary: "",
      fallbackSummary: "",
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

  function getNodeMetaLabel(node, { getBranchStatusUi = () => ({ label: "进行中" }) } = {}) {
    const effect = getNodeEffect(node);
    if (!trimText(node?.parentNodeId || "")) {
      return "进行中";
    }
    switch (effect?.metaVariant) {
      case "candidate":
        return "可选";
      case "done":
        return "已收束";
      case "branch-status":
        return trimText(getBranchStatusUi(node?.status)?.label || "") || "进行中";
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
    buildQuestNodeCounts,
    getNodeMetaLabel,
    getNodeSummaryText,
  });

  root.MelodySyncWorkbenchNodeEffects = api;
  if (typeof window === "object" && window && window !== root) {
    window.MelodySyncWorkbenchNodeEffects = api;
  }
})();
