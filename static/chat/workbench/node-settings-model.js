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
    describeNodeKind,
  });
})();
