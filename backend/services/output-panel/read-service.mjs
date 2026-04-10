import { resolveSessionStateFromSession } from '../../session-runtime/session-state.mjs';
import { normalizeSessionWorkflowState } from '../../session/workflow-state.mjs';
import { getLatestSessionContext } from '../../workbench/continuity-store.mjs';
import {
  buildWorkbenchOutputMetrics,
  resolveOutputMetricsScopeForSession,
} from '../../workbench/output-metrics-service.mjs';
import { listWorkbenchSessions } from '../../workbench/session-ports.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';
import { loadWorkbenchState } from '../../workbench/state-store.mjs';

function normalizeList(values = []) {
  const items = Array.isArray(values) ? values : [];
  return items
    .map((entry) => normalizeNullableText(entry))
    .filter(Boolean);
}

function buildOutputPanelCurrentSession(state, sessions, sessionId = '') {
  const normalizedSessionId = normalizeNullableText(sessionId);
  if (!normalizedSessionId) return null;
  const session = (Array.isArray(sessions) ? sessions : []).find((entry) => entry?.id === normalizedSessionId);
  if (!session) return null;

  const latestContext = getLatestSessionContext(state, normalizedSessionId);
  const sessionState = resolveSessionStateFromSession(session, latestContext || null);
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const lineRole = sessionState?.lineRole === 'branch' ? 'branch' : 'main';
  const title = normalizeNullableText(sessionState?.goal || session?.name || '当前任务');
  const mainGoal = normalizeNullableText(sessionState?.mainGoal);
  const branchFrom = normalizeNullableText(sessionState?.branchFrom);
  const overview = lineRole === 'branch'
    ? (branchFrom || mainGoal)
    : (mainGoal && mainGoal !== title ? mainGoal : '');
  const knownConclusionsCount = normalizeList(taskCard?.knownConclusions).length;
  const updatedAt = normalizeNullableText(
    session?.updatedAt
    || session?.lastEventAt
    || session?.createdAt
    || session?.created,
  );

  return {
    id: normalizedSessionId,
    title,
    lineRole,
    workflowState: normalizeSessionWorkflowState(session?.workflowState || ''),
    overview,
    checkpoint: normalizeNullableText(sessionState?.checkpoint || taskCard?.checkpoint || ''),
    knownConclusionsCount,
    updatedAt,
  };
}

export function buildOutputPanelPayload(state, sessions, options = {}) {
  const sessionId = normalizeNullableText(options?.sessionId);
  const scope = resolveOutputMetricsScopeForSession(sessions, sessionId, options?.scope);
  return {
    ...buildWorkbenchOutputMetrics(state, sessions, {
      ...options,
      scope,
    }),
    currentSession: buildOutputPanelCurrentSession(state, sessions, sessionId),
  };
}

export async function getOutputPanelPayload(options = {}) {
  const [state, sessions] = await Promise.all([
    loadWorkbenchState(),
    listWorkbenchSessions({ includeArchived: true }),
  ]);
  return buildOutputPanelPayload(state, sessions, options);
}
