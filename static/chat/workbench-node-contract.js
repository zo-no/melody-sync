(function workbenchNodeContractModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;
  const NODE_KIND_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "main",
      label: "主任务",
      description: "主任务根节点，对应主 session。",
      sessionBacked: true,
      derived: false,
    }),
    Object.freeze({
      id: "branch",
      label: "子任务",
      description: "已经拆出的真实支线 session。",
      sessionBacked: true,
      derived: false,
    }),
    Object.freeze({
      id: "candidate",
      label: "建议子任务",
      description: "系统建议但尚未真正展开的下一条执行线。",
      sessionBacked: false,
      derived: true,
    }),
    Object.freeze({
      id: "done",
      label: "收束",
      description: "当前主任务下的现有支线已经全部收束。",
      sessionBacked: false,
      derived: true,
    }),
  ]);

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

  const contract = {
    NODE_KIND_DEFINITIONS,
    NODE_KINDS: Object.freeze(NODE_KIND_DEFINITIONS.map((definition) => definition.id)),
    listNodeKindDefinitions,
    getNodeKindDefinition,
  };

  root.MelodySyncWorkbenchNodeContract = contract;
  if (typeof window === "object" && window && window !== root) {
    window.MelodySyncWorkbenchNodeContract = contract;
  }
})();
