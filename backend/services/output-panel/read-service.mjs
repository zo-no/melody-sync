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

// Global view: 30 total runs, 5 per project
const RECENT_RUNS_GLOBAL_LIMIT = 30;
const RUNS_PER_PROJECT_LIMIT = 5;
// Project view: show all runs for the project (up to 100)
const RUNS_PER_PROJECT_DETAIL_LIMIT = 100;

async function buildRecentRunsByProject(state, sessions, options = {}) {
  const filterProjectSessionId = options?.filterProjectSessionId || null;

  const allRunIds = await listRunIds();
  // For project view scan more; for global view scan fewer
  const scanLimit = filterProjectSessionId
    ? Math.min(allRunIds.length, 500)
    : Math.min(allRunIds.length, 200);
  const recentRunIds = allRunIds.slice(-scanLimit).reverse();

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

  // Build the set of sessionIds belonging to the target project (for project view)
  // Members are stored in session.taskPoolMembership.longTerm.projectSessionId
  let targetProjectSessionIds = null;
  if (filterProjectSessionId) {
    targetProjectSessionIds = new Set();
    // The project session itself
    targetProjectSessionIds.add(filterProjectSessionId);
    // All member sessions: check taskPoolMembership.longTerm.projectSessionId in sessions
    for (const s of (Array.isArray(sessions) ? sessions : [])) {
      const lt = s?.taskPoolMembership?.longTerm;
      if (lt?.projectSessionId === filterProjectSessionId && s?.id) {
        targetProjectSessionIds.add(s.id);
      }
    }
    // Also check branchContexts (some projects use this path)
    for (const ctx of branchContexts) {
      if (ctx?.projectId === filterProjectSessionId && ctx?.sessionId) {
        targetProjectSessionIds.add(ctx.sessionId);
      }
    }
    // Also include sessions whose projectId maps to this project via sessionToProject
    for (const [sid, pid] of sessionToProject) {
      if (pid === filterProjectSessionId) targetProjectSessionIds.add(sid);
    }
  }

  // Group runs by project
  const projectGroups = new Map(); // projectId -> { title, runs[] }
  const ungroupedRuns = [];
  let globalCount = 0;

  for (const runId of recentRunIds) {
    // Stop scanning for global view when we have enough
    if (!filterProjectSessionId && globalCount >= RECENT_RUNS_GLOBAL_LIMIT) break;

    const run = await getRun(runId);
    if (!run) continue;

    const projectId = sessionToProject.get(run.sessionId);
    const sessionName = sessionMap.get(run.sessionId) || '';
    // Classify trigger type from requestId
    const reqId = run.requestId || '';
    let triggerType = 'manual';
    if (reqId.startsWith('persistent_run_branch_')) triggerType = 'branch';
    else if (reqId.startsWith('persistent_recurring_')) triggerType = 'recurring';
    else if (reqId.startsWith('persistent_schedule_')) triggerType = 'schedule';
    else if (reqId.startsWith('persistent_run_')) triggerType = 'persistent';
    else if (reqId.startsWith('voice:')) triggerType = 'voice';
    else if (reqId.startsWith('compat_')) triggerType = 'compat';
    else if (reqId.startsWith('queued_batch_')) triggerType = 'batch';
    const entry = {
      id: run.id,
      sessionId: run.sessionId,
      sessionName,
      state: run.state,
      tool: run.tool || '',
      model: run.model || '',
      effort: run.effort || '',
      thinking: run.thinking === true,
      triggerType,
      createdAt: run.createdAt || '',
      startedAt: run.startedAt || '',
      completedAt: run.completedAt || '',
      failureReason: run.failureReason || '',
      contextInputTokens: run.contextInputTokens || null,
      normalizedEventCount: run.normalizedEventCount || 0,
    };

    if (filterProjectSessionId) {
      // Project view: only include runs from this project's sessions
      if (!targetProjectSessionIds.has(run.sessionId)) continue;
      if (!projectGroups.has(filterProjectSessionId)) {
        projectGroups.set(filterProjectSessionId, {
          projectId: filterProjectSessionId,
          title: projectMap.get(filterProjectSessionId) || filterProjectSessionId,
          runs: [],
        });
      }
      const group = projectGroups.get(filterProjectSessionId);
      if (group.runs.length < RUNS_PER_PROJECT_DETAIL_LIMIT) {
        group.runs.push(entry);
      }
    } else {
      // Global view: group by project, limit per project
      globalCount++;
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
  }

  const groups = [...projectGroups.values()];
  if (!filterProjectSessionId && ungroupedRuns.length > 0) {
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
  // When a specific project sessionId is provided, filter runs to that project only
  const filterProjectSessionId = normalizeNullableText(options?.sessionId) || null;
  const [payload, recentRunsByProject] = await Promise.all([
    Promise.resolve(buildOutputPanelPayload(state, sessions, options)),
    buildRecentRunsByProject(state, sessions, { filterProjectSessionId }),
  ]);
  return { ...payload, recentRunsByProject };
}
