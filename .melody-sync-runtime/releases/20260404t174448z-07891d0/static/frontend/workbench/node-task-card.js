(function workbenchNodeTaskCardModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;
  const ARRAY_BINDING_KEYS = Object.freeze(["candidateBranches", "nextSteps"]);
  const SCALAR_BINDING_KEYS = Object.freeze(["mainGoal", "goal", "summary", "checkpoint"]);

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getNodeInstanceApi() {
    return root?.MelodySyncWorkbenchNodeInstance
      || root?.window?.MelodySyncWorkbenchNodeInstance
      || null;
  }

  function normalizeKey(value) {
    return trimText(value).toLowerCase();
  }

  function getOriginPriority(origin = null) {
    const originType = trimText(origin?.type).toLowerCase();
    switch (originType) {
      case "manual":
        return 50;
      case "plan":
        return 40;
      case "hook":
        return 35;
      case "system":
        return 30;
      case "projection":
        return 10;
      case "unknown":
        return 1;
      default:
        return 0;
    }
  }

  function clipText(value, max = 160) {
    const text = trimText(value).replace(/\s+/g, " ");
    if (!text) return "";
    if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
    if (max === 1) return "…";
    return `${text.slice(0, max - 1).trimEnd()}…`;
  }

  function normalizeTaskCardBindingKeys(values = []) {
    const source = Array.isArray(values) ? values : [];
    const seen = new Set();
    const normalized = [];
    for (const value of source) {
      const key = trimText(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalized.push(key);
    }
    return normalized;
  }

  function resolveNodeTaskCardBindings(node = {}) {
    return normalizeTaskCardBindingKeys(
      getNodeInstanceApi()?.createNodeInstance?.(node, {
        questId: node?.questId,
        origin: node?.origin || null,
      })?.taskCardBindings
        || node?.taskCardBindings
        || [],
    );
  }

  function resolveNodeBindingValue(node = {}, bindingKey = "") {
    const normalizedBindingKey = trimText(bindingKey);
    if (!normalizedBindingKey) return "";
    if (normalizedBindingKey === "candidateBranches" || normalizedBindingKey === "nextSteps") {
      return clipText(node?.title, 96);
    }
    if (normalizedBindingKey === "summary" || normalizedBindingKey === "checkpoint") {
      return clipText(node?.summary || node?.title, 160);
    }
    if (normalizedBindingKey === "mainGoal" || normalizedBindingKey === "goal") {
      return clipText(node?.title || node?.summary, 96);
    }
    return clipText(node?.summary || node?.title, 160);
  }

  function buildTaskCardPatchEntries(nodes = []) {
    const entries = [];
    for (const rawNode of Array.isArray(nodes) ? nodes : []) {
      const node = getNodeInstanceApi()?.createNodeInstance?.(rawNode, {
        questId: rawNode?.questId,
        origin: rawNode?.origin || null,
      }) || rawNode;
      for (const bindingKey of resolveNodeTaskCardBindings(node)) {
        const value = resolveNodeBindingValue(node, bindingKey);
        if (!value) continue;
        entries.push({
          nodeId: trimText(node?.id),
          sourceSessionId: trimText(node?.sourceSessionId || node?.sessionId),
          bindingKey,
          value,
          origin: node?.origin && typeof node.origin === "object" ? { ...node.origin } : null,
        });
      }
    }
    return entries;
  }

  function buildTaskCardPatch(nodes = []) {
    const entries = buildTaskCardPatchEntries(nodes);
    const patch = {};
    const seenArrayValues = new Map();
    const scalarPriorities = new Map();
    for (const entry of entries) {
      if (ARRAY_BINDING_KEYS.includes(entry.bindingKey)) {
        const values = Array.isArray(patch[entry.bindingKey]) ? patch[entry.bindingKey] : [];
        const seen = seenArrayValues.get(entry.bindingKey) || new Set(values.map((value) => normalizeKey(value)));
        const normalizedValue = normalizeKey(entry.value);
        if (normalizedValue && !seen.has(normalizedValue)) {
          values.push(entry.value);
          seen.add(normalizedValue);
        }
        seenArrayValues.set(entry.bindingKey, seen);
        patch[entry.bindingKey] = values;
        continue;
      }
      if (SCALAR_BINDING_KEYS.includes(entry.bindingKey)) {
        const entryPriority = getOriginPriority(entry.origin);
        const currentPriority = scalarPriorities.has(entry.bindingKey)
          ? scalarPriorities.get(entry.bindingKey)
          : -1;
        if (!trimText(patch[entry.bindingKey]) || entryPriority > currentPriority) {
          patch[entry.bindingKey] = entry.value;
          scalarPriorities.set(entry.bindingKey, entryPriority);
        }
      }
    }
    return patch;
  }

  function filterNodesForSourceSession(nodes = [], sourceSessionId = "") {
    const normalizedSourceSessionId = trimText(sourceSessionId);
    if (!normalizedSourceSessionId) return [];
    return (Array.isArray(nodes) ? nodes : []).filter((node) => {
      const resolvedSourceSessionId = getNodeInstanceApi()?.resolveNodeSourceSessionId?.(node)
        || trimText(node?.sourceSessionId || node?.sessionId);
      return resolvedSourceSessionId === normalizedSourceSessionId;
    });
  }

  function buildTaskCardPatchForSourceSession(nodes = [], sourceSessionId = "") {
    return buildTaskCardPatch(filterNodesForSourceSession(nodes, sourceSessionId));
  }

  root.MelodySyncWorkbenchNodeTaskCard = Object.freeze({
    resolveNodeTaskCardBindings,
    resolveNodeBindingValue,
    buildTaskCardPatchEntries,
    buildTaskCardPatch,
    filterNodesForSourceSession,
    buildTaskCardPatchForSourceSession,
  });
})();
