(function taskMapNodeSettingsModelModule() {
  const LANE_LABELS = Object.freeze({
    main: '主泳道',
    branch: '支泳道',
    side: '侧泳道',
  });

  const ROLE_LABELS = Object.freeze({
    state: '状态节点',
    action: '动作节点',
    summary: '总结节点',
  });

  const MERGE_POLICY_LABELS = Object.freeze({
    'replace-latest': '覆盖最新',
    append: '追加保留',
  });

  const INTERACTION_LABELS = Object.freeze({
    'open-session': '打开任务',
    'create-branch': '开启支线',
    none: '只读展示',
  });

  const VIEW_TYPE_LABELS = Object.freeze({
    'flow-node': '普通节点',
    markdown: 'Markdown',
    html: 'HTML',
    iframe: 'iFrame',
  });

  const SURFACE_SLOT_LABELS = Object.freeze({
    'task-map': '任务地图',
    'composer-suggestions': '输入区建议',
  });

  const TASK_CARD_BINDING_LABELS = Object.freeze({
    mainGoal: '主目标',
    goal: '当前目标',
    candidateBranches: '建议支线',
    summary: '摘要',
    checkpoint: '检查点',
    nextSteps: '下一步',
  });

  function trimText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeTokenList(values, fallback) {
    if (!Array.isArray(values) || values.length === 0) {
      return [...fallback];
    }
    const normalized = values
      .map((value) => trimText(value).toLowerCase())
      .filter(Boolean);
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
  }

  function normalizeStringList(values, fallback) {
    if (!Array.isArray(values) || values.length === 0) {
      return [...fallback];
    }
    const normalized = values
      .map((value) => trimText(value))
      .filter(Boolean);
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
  }

  function normalizeNodeDefinition(definition = {}) {
    const id = trimText(definition.id).toLowerCase();
    if (!id) return null;
    return {
      id,
      label: trimText(definition.label || id),
      description: trimText(definition.description),
      lane: trimText(definition.lane).toLowerCase() || 'side',
      role: trimText(definition.role).toLowerCase() || 'summary',
      mergePolicy: trimText(definition.mergePolicy).toLowerCase() || 'replace-latest',
      sessionBacked: definition.sessionBacked === true,
      derived: definition.derived === true,
      builtIn: definition.builtIn === true,
      editable: definition.editable === true,
      source: trimText(definition.source || (definition.builtIn ? 'builtin' : 'custom')) || 'custom',
      composition: definition?.composition && typeof definition.composition === 'object'
        ? {
          canBeRoot: definition.composition.canBeRoot === true,
          allowedParentKinds: Array.isArray(definition.composition.allowedParentKinds)
            ? definition.composition.allowedParentKinds.map((value) => trimText(value).toLowerCase()).filter(Boolean)
            : [],
          allowedChildKinds: Array.isArray(definition.composition.allowedChildKinds)
            ? definition.composition.allowedChildKinds.map((value) => trimText(value).toLowerCase()).filter(Boolean)
            : [],
          requiresSourceSession: definition.composition.requiresSourceSession !== false,
          defaultInteraction: trimText(definition.composition.defaultInteraction).toLowerCase(),
          defaultEdgeType: trimText(definition.composition.defaultEdgeType).toLowerCase(),
          defaultViewType: trimText(definition.composition.defaultViewType).toLowerCase(),
          layoutVariant: trimText(definition.composition.layoutVariant).toLowerCase(),
          capabilities: Array.isArray(definition.composition.capabilities)
            ? definition.composition.capabilities.map((value) => trimText(value).toLowerCase()).filter(Boolean)
            : [],
          surfaceBindings: Array.isArray(definition.composition.surfaceBindings)
            ? definition.composition.surfaceBindings.map((value) => trimText(value).toLowerCase()).filter(Boolean)
            : [],
          taskCardBindings: Array.isArray(definition.composition.taskCardBindings)
            ? definition.composition.taskCardBindings.map((value) => trimText(value)).filter(Boolean)
            : [],
          countsAs: {
            sessionNode: definition?.composition?.countsAs?.sessionNode === true,
            branch: definition?.composition?.countsAs?.branch === true,
            candidate: definition?.composition?.countsAs?.candidate === true,
            completedSummary: definition?.composition?.countsAs?.completedSummary === true,
          },
        }
        : null,
    };
  }

  function normalizeNodeDefinitionsPayload(data = {}) {
    const nodeLanes = normalizeTokenList(data.nodeLanes, ['main', 'branch', 'side']);
    const nodeRoles = normalizeTokenList(data.nodeRoles, ['state', 'action', 'summary']);
    const nodeMergePolicies = normalizeTokenList(
      data.nodeMergePolicies,
      ['replace-latest', 'append'],
    );
    const nodeInteractions = normalizeTokenList(
      data.nodeInteractions,
      ['open-session', 'create-branch', 'none'],
    );
    const nodeViewTypes = normalizeTokenList(
      data.nodeViewTypes,
      ['flow-node', 'markdown', 'html', 'iframe'],
    );
    const nodeSurfaceSlots = normalizeTokenList(
      data.nodeSurfaceSlots,
      ['task-map', 'composer-suggestions'],
    );
    const nodeTaskCardBindingKeys = normalizeStringList(
      data.nodeTaskCardBindingKeys,
      ['mainGoal', 'goal', 'candidateBranches', 'summary', 'checkpoint', 'nextSteps'],
    );
    const nodeKindDefinitions = (Array.isArray(data.nodeKindDefinitions) ? data.nodeKindDefinitions : [])
      .map((definition) => normalizeNodeDefinition(definition))
      .filter(Boolean);
    const builtInNodeKinds = new Set(
      (Array.isArray(data.builtInNodeKinds) ? data.builtInNodeKinds : [])
        .map((value) => trimText(value).toLowerCase())
        .filter(Boolean),
    );
    const builtInDefinitions = nodeKindDefinitions.filter(
      (definition) => definition.builtIn || builtInNodeKinds.has(definition.id),
    );
    const customNodeKinds = nodeKindDefinitions.filter(
      (definition) => !(definition.builtIn || builtInNodeKinds.has(definition.id)),
    );
    return {
      nodeLanes,
      nodeRoles,
      nodeMergePolicies,
      nodeInteractions,
      nodeViewTypes,
      nodeSurfaceSlots,
      nodeTaskCardBindingKeys,
      nodeKindDefinitions,
      builtInDefinitions,
      customNodeKinds,
      settings: data?.settings && typeof data.settings === 'object' ? { ...data.settings } : {},
    };
  }

  function createNodeFormDefaults(definition = null) {
    return {
      id: trimText(definition?.id),
      label: trimText(definition?.label),
      description: trimText(definition?.description),
      lane: trimText(definition?.lane).toLowerCase() || 'side',
      role: trimText(definition?.role).toLowerCase() || 'summary',
      mergePolicy: trimText(definition?.mergePolicy).toLowerCase() || 'replace-latest',
      defaultInteraction: trimText(definition?.composition?.defaultInteraction).toLowerCase() || 'none',
      defaultViewType: trimText(definition?.composition?.defaultViewType).toLowerCase() || 'flow-node',
      surfaceBindings: Array.isArray(definition?.composition?.surfaceBindings)
        ? definition.composition.surfaceBindings.map((value) => trimText(value).toLowerCase()).filter(Boolean)
        : ['task-map'],
      taskCardBindings: Array.isArray(definition?.composition?.taskCardBindings)
        ? definition.composition.taskCardBindings.map((value) => trimText(value)).filter(Boolean)
        : [],
    };
  }

  function getLaneLabel(value) {
    return LANE_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知泳道';
  }

  function getRoleLabel(value) {
    return ROLE_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知角色';
  }

  function getMergePolicyLabel(value) {
    return MERGE_POLICY_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知合并策略';
  }

  function getInteractionLabel(value) {
    return INTERACTION_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知交互';
  }

  function getViewTypeLabel(value) {
    return VIEW_TYPE_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知视图';
  }

  function getSurfaceSlotLabel(value) {
    return SURFACE_SLOT_LABELS[trimText(value).toLowerCase()] || trimText(value) || '未知表面';
  }

  function getTaskCardBindingLabel(value) {
    return TASK_CARD_BINDING_LABELS[trimText(value)] || trimText(value) || '未知回写';
  }

  function describeNodeKind(definition = {}) {
    const tokens = [];
    tokens.push(definition?.builtIn ? '系统内建' : '自定义');
    tokens.push(getLaneLabel(definition?.lane));
    tokens.push(getRoleLabel(definition?.role));
    tokens.push(getMergePolicyLabel(definition?.mergePolicy));
    return tokens.join(' · ');
  }

  window.MelodySyncTaskMapNodeSettingsModel = Object.freeze({
    normalizeNodeDefinitionsPayload,
    createNodeFormDefaults,
    getLaneLabel,
    getRoleLabel,
    getMergePolicyLabel,
    getInteractionLabel,
    getViewTypeLabel,
    getSurfaceSlotLabel,
    getTaskCardBindingLabel,
    describeNodeKind,
  });
})();
