import { createTaskMapPlanContractPayload } from './task-map-plan-contract.mjs';

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clipText(value, max = 88) {
  const text = trimText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatNodeKinds(definitions = []) {
  const rows = [];
  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const id = trimText(definition?.id);
    if (!id) continue;
    const label = trimText(definition?.label) || id;
    const composition = definition?.composition && typeof definition.composition === 'object'
      ? definition.composition
      : {};
    const parentKinds = Array.isArray(composition.allowedParentKinds) ? composition.allowedParentKinds : [];
    const childKinds = Array.isArray(composition.allowedChildKinds) ? composition.allowedChildKinds : [];
    const capabilities = Array.isArray(composition.capabilities) ? composition.capabilities : [];
    const viewType = trimText(composition.defaultViewType || '');
    const parts = [];
    if (parentKinds.length === 0) {
      parts.push('root');
    } else {
      parts.push(`parents: ${parentKinds.join(', ')}`);
    }
    if (childKinds.length > 0) {
      parts.push(`children: ${childKinds.join(', ')}`);
    }
    if (capabilities.length > 0) {
      parts.push(`actions: ${capabilities.join(', ')}`);
    }
    if (viewType) {
      parts.push(`view: ${viewType}`);
    }
    rows.push(`- ${id} (${label})${parts.length > 0 ? ` — ${parts.join(' · ')}` : ''}`);
  }
  return rows.join('\n');
}

export function buildGraphBootstrapPromptContext({ session = null } = {}) {
  const contract = createTaskMapPlanContractPayload();
  const sessionTitle = clipText(
    session?.name
      || session?.taskCard?.mainGoal
      || session?.taskCard?.goal
      || '当前任务',
    72,
  );
  const rootSessionId = trimText(session?.rootSessionId || session?.id);
  const lines = [
    '[Graph planning bootstrap]',
    'This session is node-aware from the start. Use MelodySync node kinds and task-map plans when you need to express goals, branches, suggestions, or rich canvas content.',
    '',
    `Current session root: ${rootSessionId || '(unknown)'}`,
    `Default root node: main (${sessionTitle})`,
  ];

  if (Array.isArray(contract?.surfaceSlots) && contract.surfaceSlots.length > 0) {
    lines.push(`Surface slots: ${contract.surfaceSlots.join(', ')}`);
  }
  if (Array.isArray(contract?.viewTypes) && contract.viewTypes.length > 0) {
    lines.push(`Canvas view types: ${contract.viewTypes.join(', ')}`);
  }
  if (Array.isArray(contract?.taskCardBindingKeys) && contract.taskCardBindingKeys.length > 0) {
    lines.push(`Writable task-card bindings: ${contract.taskCardBindingKeys.join(', ')}`);
  }

  const nodeKindsBlock = formatNodeKinds(contract?.nodeKindDefinitions);
  if (nodeKindsBlock) {
    lines.push('', 'Available node kinds:', nodeKindsBlock);
  }

  lines.push(
    '',
    'When you need to shape the task map, prefer declaring node-backed structure that matches this contract instead of inventing ad hoc UI.',
    'If you can safely clean up the task map, you may append one extra hidden block before the final task_card block:',
    '<private><graph_ops>{"operations":[{"type":"attach","source":"重复任务A","target":"主线任务","reason":"并到更合适的父任务下"},{"type":"archive","source":"重复任务B","target":"主线任务","reason":"重复任务已融合"}]}</graph_ops></private>',
    'Supported graph ops are attach, promote_main, and archive. Prefer session titles or ids; `current`, `self`, `当前任务`, `main`, `root`, and `主线` are valid refs.',
    'Use graph_ops only for high-confidence, reversible cleanup such as reparenting a task under a better parent or archiving obvious duplicates. The final hidden block must still be task_card.',
  );
  return lines.join('\n').trim();
}

export async function appendGraphBootstrapPromptContext({
  sessionId = '',
  session = null,
  appendEvents,
  loadHistory,
} = {}) {
  const normalizedSessionId = trimText(sessionId || session?.id);
  if (!normalizedSessionId || !session) return false;
  if (typeof appendEvents !== 'function') {
    throw new Error('appendGraphBootstrapPromptContext requires appendEvents');
  }

  if (typeof loadHistory === 'function') {
    const existingEvents = await loadHistory(normalizedSessionId, { includeBodies: false });
    const hasExistingBootstrap = existingEvents.some(
      (event) => event?.type === 'template_context' && event?.templateName === 'graph-planning',
    );
    if (hasExistingBootstrap) {
      return false;
    }
  }

  const content = buildGraphBootstrapPromptContext({ session });
  if (!content) return false;
  await appendEvents(normalizedSessionId, [
    {
      type: 'template_context',
      role: 'system',
      templateName: 'graph-planning',
      content,
    },
  ]);
  return true;
}
