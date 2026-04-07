function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const HOOK_PHASE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'startup',
    label: '启动准备',
    description: '实例启动、首次初始化和恢复相关的闭环起点。',
  }),
  Object.freeze({
    id: 'entry',
    label: '进入任务',
    description: '任务建立并首次进入真实对话的阶段。',
  }),
  Object.freeze({
    id: 'execution',
    label: '本轮处理',
    description: '任务进入本轮处理并持续推进的阶段。',
  }),
  Object.freeze({
    id: 'closeout',
    label: '收尾与分流',
    description: '执行完成后的命名、通知、失败回执和支线建议。',
  }),
  Object.freeze({
    id: 'branch_followup',
    label: '支线处理与回流',
    description: '支线被打开后继续推进，并在合适时回流主线。',
  }),
]);

export const HOOK_PHASE_ORDER = Object.freeze(
  HOOK_PHASE_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_PHASE_INDEX = new Map(
  HOOK_PHASE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const EVENT_PHASE_INDEX = Object.freeze({
  'instance.first_boot': 'startup',
  'instance.startup': 'startup',
  'instance.resume': 'startup',
  'session.created': 'entry',
  'session.first_user_message': 'entry',
  'session.waiting_user': 'closeout',
  'session.completed': 'closeout',
  'run.started': 'execution',
  'run.completed': 'closeout',
  'run.failed': 'closeout',
  'branch.suggested': 'closeout',
  'branch.opened': 'branch_followup',
  'branch.merged': 'branch_followup',
});

export function normalizeHookPhase(value) {
  const normalized = normalizeText(value).toLowerCase();
  return HOOK_PHASE_INDEX.has(normalized) ? normalized : '';
}

export function deriveHookPhaseFromEventId(eventId) {
  return normalizeHookPhase(EVENT_PHASE_INDEX[normalizeText(eventId)]);
}

export function listHookPhaseDefinitions() {
  return HOOK_PHASE_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getHookPhaseDefinition(phaseId) {
  const definition = HOOK_PHASE_INDEX.get(normalizeHookPhase(phaseId));
  return definition ? { ...definition } : null;
}
