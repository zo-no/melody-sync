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
import { getRun, listRunIds } from '../../run/store.mjs';

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

const RECENT_RUNS_LIMIT = 30;
const RUNS_PER_PROJECT_LIMIT = 5;

async function buildRecentRunsByProject(state, sessions) {
  const allRunIds = await listRunIds();
  // Read recent runs in reverse order (newest first), limit scan
  const scanLimit = Math.min(allRunIds.length, 200);
  const recentRunIds = allRunIds.slice(-scanLimit).reverse();

  const runs = [];
  for (const runId of recentRunIds) {
    if (runs.length >= RECENT_RUNS_LIMIT) break;
    const run = await getRun(runId);
    if (!run) continue;
    runs.push(run);
  }

  // Build sessionId -> session name map
  const sessionMap = new Map();
  for (const s of (Array.isArray(sessions) ? sessions : [])) {
    if (s?.id) sessionMap.set(s.id, s.name || s.id.slice(0, 8));
  }

  // Build sessionId -> projectId map from branchContexts
  const sessionToProject = new Map();
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const branchContexts = Array.isArray(state?.branchContexts) ? state.branchContexts : [];
  for (const ctx of branchContexts) {
    if (ctx?.sessionId && ctx?.projectId) {
      sessionToProject.set(ctx.sessionId, ctx.projectId);
    }
  }

  // Build projectId -> project title map
  const projectMap = new Map();
  for (const p of projects) {
    if (p?.id) projectMap.set(p.id, p.title || p.id);
  }

  // Group runs by project
  const projectGroups = new Map(); // projectId -> { title, runs[] }
  const ungroupedRuns = [];

  for (const run of runs) {
    const projectId = sessionToProject.get(run.sessionId);
    const sessionName = sessionMap.get(run.sessionId) || '';
    const entry = {
      id: run.id,
      sessionId: run.sessionId,
      sessionName,
      state: run.state,
      tool: run.tool || '',
      model: run.model || '',
      createdAt: run.createdAt || '',
      completedAt: run.completedAt || '',
      failureReason: run.failureReason || '',
    };
    if (projectId) {
      if (!projectGroups.has(projectId)) {
        projectGroups.set(projectId, {
          projectId,
          title: projectMap.get(projectId) || projectId,
          runs: [],
        });
      }
      const group = projectGroups.get(projectId);
      if (group.runs.length < RUNS_PER_PROJECT_LIMIT) {
        group.runs.push(entry);
      }
    } else {
      ungroupedRuns.push(entry);
    }
  }

  const groups = [...projectGroups.values()];
  if (ungroupedRuns.length > 0) {
    groups.push({
      projectId: null,
      title: '其他',
      runs: ungroupedRuns.slice(0, RUNS_PER_PROJECT_LIMIT),
    });
  }

  return groups;
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
  const [payload, recentRunsByProject] = await Promise.all([
    Promise.resolve(buildOutputPanelPayload(state, sessions, options)),
    buildRecentRunsByProject(state, sessions),
  ]);
  return { ...payload, recentRunsByProject };
}
