(function (global) {
  const FALLBACK_PHASE_DEFINITIONS = Object.freeze({
    startup: Object.freeze({
      id: 'startup',
      label: '启动准备',
      description: '实例启动、首次初始化和恢复相关的闭环起点。',
    }),
    entry: Object.freeze({
      id: 'entry',
      label: '进入任务',
      description: '任务建立并首次进入真实对话的阶段。',
    }),
    execution: Object.freeze({
      id: 'execution',
      label: '本轮处理',
      description: '任务进入本轮处理并持续推进的阶段。',
    }),
    closeout: Object.freeze({
      id: 'closeout',
      label: '收尾与分流',
      description: '执行结束后的命名、通知、用户接手、失败回执和支线建议。',
    }),
    branch_followup: Object.freeze({
      id: 'branch_followup',
      label: '支线处理与回流',
      description: '支线被打开后继续推进，并在合适时回流主线。',
    }),
  });

  const FALLBACK_PHASE_ORDER = Object.freeze([
    'startup',
    'entry',
    'execution',
    'closeout',
    'branch_followup',
  ]);

  const FALLBACK_EVENT_DEFINITIONS = Object.freeze({
    'instance.first_boot': {
      id: 'instance.first_boot',
      phase: 'startup',
      scope: 'instance',
      label: '实例首次启动',
      description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。',
    },
    'instance.startup': {
      id: 'instance.startup',
      phase: 'startup',
      scope: 'instance',
      label: '实例启动完成',
      description: '服务启动完成、基础目录准备完毕之后。',
    },
    'instance.resume': {
      id: 'instance.resume',
      phase: 'startup',
      scope: 'instance',
      label: '实例恢复完成',
      description: '服务完成启动期恢复动作之后。',
    },
    'session.created': {
      id: 'session.created',
      phase: 'entry',
      scope: 'session',
      label: '新建任务',
      description: '新任务完成初始化并写入元数据之后。',
    },
    'session.first_user_message': {
      id: 'session.first_user_message',
      phase: 'entry',
      scope: 'session',
      label: '首次发送消息',
      description: '任务第一条真实用户消息进入历史之后。',
    },
    'session.waiting_user': {
      id: 'session.waiting_user',
      phase: 'closeout',
      scope: 'session',
      label: '需要用户接手',
      description: '任务进入需要用户确认、选择、补资料或手动验证的状态之后。',
    },
    'session.completed': {
      id: 'session.completed',
      phase: 'closeout',
      scope: 'session',
      label: '任务完成',
      description: '任务 workflowState 从非 done 变为 done 之后。',
    },
    'run.started': {
      id: 'run.started',
      phase: 'execution',
      scope: 'run',
      label: '开始执行',
      description: '新的一次执行建立并进入处理流程之后。',
    },
    'run.completed': {
      id: 'run.completed',
      phase: 'closeout',
      scope: 'run',
      label: '执行完成',
      description: '一次执行成功完成并且结果已经回写之后。',
    },
    'run.failed': {
      id: 'run.failed',
      phase: 'closeout',
      scope: 'run',
      label: '执行失败或取消',
      description: '一次执行失败、终止或取消之后。',
    },
    'branch.suggested': {
      id: 'branch.suggested',
      phase: 'closeout',
      scope: 'branch',
      label: '识别支线建议',
      description: '检测到适合独立处理的话题，并产出候选支线事件之后。',
    },
    'branch.opened': {
      id: 'branch.opened',
      phase: 'branch_followup',
      scope: 'branch',
      label: '开启支线',
      description: '新的支线任务和 branch context 已持久化并进入处理状态之后。',
    },
    'branch.merged': {
      id: 'branch.merged',
      phase: 'branch_followup',
      scope: 'branch',
      label: '支线合并回主线',
      description: '支线结果已经回流主线并写入合并记录之后。',
    },
  });

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizePhaseId(value) {
    const normalized = normalizeText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(FALLBACK_PHASE_DEFINITIONS, normalized)
      ? normalized
      : '';
  }

  function derivePhaseIdFromEventId(eventId) {
    const normalized = normalizeText(eventId);
    return normalizePhaseId(FALLBACK_EVENT_DEFINITIONS[normalized]?.phase);
  }

  function normalizePhaseDefinitions(data) {
    const providedDefinitions = Array.isArray(data?.phaseDefinitions) ? data.phaseDefinitions : [];
    const normalizedDefinitions = providedDefinitions.map((definition) => {
      const id = normalizePhaseId(definition?.id);
      const fallback = FALLBACK_PHASE_DEFINITIONS[id] || null;
      return {
        id,
        label: normalizeText(definition?.label || fallback?.label || id),
        description: normalizeText(definition?.description || fallback?.description || ''),
      };
    }).filter((definition) => definition.id);

    const seen = new Set(normalizedDefinitions.map((definition) => definition.id));
    const fallbackOrder = Array.isArray(data?.phaseOrder) && data.phaseOrder.length > 0
      ? data.phaseOrder.map((phaseId) => normalizePhaseId(phaseId)).filter(Boolean)
      : [...FALLBACK_PHASE_ORDER];

    for (const phaseId of fallbackOrder) {
      if (seen.has(phaseId)) continue;
      seen.add(phaseId);
      const fallback = FALLBACK_PHASE_DEFINITIONS[phaseId];
      if (!fallback) continue;
      normalizedDefinitions.push({ ...fallback });
    }

    return normalizedDefinitions;
  }

  function normalizePhaseOrder(data, phaseDefinitions) {
    const providedOrder = Array.isArray(data?.phaseOrder) ? data.phaseOrder : [];
    const normalizedOrder = providedOrder
      .map((phaseId) => normalizePhaseId(phaseId))
      .filter(Boolean);
    if (normalizedOrder.length > 0) {
      return normalizedOrder;
    }
    return Array.isArray(phaseDefinitions)
      ? phaseDefinitions.map((definition) => definition.id).filter(Boolean)
      : [...FALLBACK_PHASE_ORDER];
  }

  function normalizeEventDefinitions(data) {
    const definitions = Array.isArray(data?.eventDefinitions) ? data.eventDefinitions : [];
    if (definitions.length > 0) {
      return definitions.map((definition) => {
        const id = normalizeText(definition?.id);
        const fallback = FALLBACK_EVENT_DEFINITIONS[id] || null;
        const phase = normalizePhaseId(definition?.phase || fallback?.phase || derivePhaseIdFromEventId(id));
        return {
          id,
          phase,
          scope: normalizeText(definition?.scope || fallback?.scope || ''),
          label: normalizeText(definition?.label || fallback?.label || id),
          description: normalizeText(definition?.description || fallback?.description || ''),
        };
      }).filter((definition) => definition.id);
    }
    return (Array.isArray(data?.events) ? data.events : []).map((eventId) => {
      const fallback = FALLBACK_EVENT_DEFINITIONS[eventId] || null;
      return {
        id: eventId,
        phase: normalizePhaseId(fallback?.phase || derivePhaseIdFromEventId(eventId)),
        scope: normalizeText(fallback?.scope || ''),
        label: normalizeText(fallback?.label || eventId),
        description: normalizeText(fallback?.description || ''),
      };
    });
  }

  function createEventHookIndex(hooks) {
    const next = new Map();
    for (const hook of Array.isArray(hooks) ? hooks : []) {
      const eventId = normalizeText(hook?.eventPattern);
      if (!eventId) continue;
      if (!next.has(eventId)) next.set(eventId, []);
      next.get(eventId).push(hook);
    }
    return next;
  }

  function buildPhaseSections(data) {
    const phaseDefinitions = normalizePhaseDefinitions(data);
    const eventDefinitions = normalizeEventDefinitions(data);
    const phaseOrder = normalizePhaseOrder(data, phaseDefinitions);
    const phaseIndex = new Map(
      phaseDefinitions.map((definition) => [definition.id, {
        definition,
        events: [],
      }]),
    );

    for (const eventDefinition of eventDefinitions) {
      const phaseId = normalizePhaseId(eventDefinition.phase || derivePhaseIdFromEventId(eventDefinition.id));
      if (!phaseId) continue;
      if (!phaseIndex.has(phaseId)) {
        const fallbackPhase = FALLBACK_PHASE_DEFINITIONS[phaseId];
        if (!fallbackPhase) continue;
        phaseIndex.set(phaseId, {
          definition: { ...fallbackPhase },
          events: [],
        });
      }
      phaseIndex.get(phaseId).events.push(eventDefinition);
    }

    return phaseOrder
      .map((phaseId) => phaseIndex.get(phaseId))
      .filter((entry) => entry && entry.events.length > 0);
  }

  function buildLifecycleFlow(data) {
    return buildPhaseSections(data).map((phaseEntry) => ({
      id: phaseEntry.definition.id,
      label: phaseEntry.definition.label,
      description: phaseEntry.definition.description,
      eventLabels: phaseEntry.events.map((eventDefinition) => eventDefinition.label).filter(Boolean),
    }));
  }

  global.MelodySyncHooksSettingsModel = Object.freeze({
    buildLifecycleFlow,
    buildPhaseSections,
    createEventHookIndex,
    normalizeEventDefinitions,
    normalizePhaseDefinitions,
  });
})(window);
