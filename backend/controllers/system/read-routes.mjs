import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

import { getAuthSession, refreshAuthSession } from '../../../lib/auth.mjs';
import { CHAT_IMAGES_DIR } from '../../../lib/config.mjs';
import { getAvailableToolsAsync } from '../../../lib/tools.mjs';

import { pathExists, statOrNull } from '../../fs-utils.mjs';
import { getModelsForTool } from '../../models.mjs';
import { getQueryValue } from '../../shared/http/query.mjs';
import { getPublicKey } from '../../push.mjs';
import { buildAuthInfo } from '../../views/system/auth.mjs';
import { normalizeBranchDispatchSignal } from '../../workbench/branch-dispatch-signals.mjs';
import { listWorkbenchSessions } from '../../workbench/session-ports.mjs';
import { getWorkbenchOutputMetrics } from '../../workbench/output-metrics-service.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';

const uploadedMediaMimeTypes = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  m4a: 'audio/mp4',
  m4v: 'video/x-m4v',
  md: 'text/markdown; charset=utf-8',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  zip: 'application/zip',
};

const PM_LOOP_ROOT = join(homedir(), 'code', 'pm-loop');
const PM_LOOP_DATA_DIR = join(PM_LOOP_ROOT, 'data');
const PM_LOOP_CATALOG_DIR = join(PM_LOOP_ROOT, 'catalog');
const PM_LOOP_STATE_PATH = join(PM_LOOP_DATA_DIR, 'state.json');
const PM_LOOP_APPROVAL_STATE_PATH = join(PM_LOOP_DATA_DIR, 'approval-state.json');
const PM_LOOP_REPORT_PATH = join(PM_LOOP_DATA_DIR, 'latest-report.md');
const PM_LOOP_TARGETS_PATH = join(PM_LOOP_CATALOG_DIR, 'targets.json');
const PM_LOOP_WORKER_LOG_PATH = join(PM_LOOP_DATA_DIR, 'worker.log');
const PM_LOOP_WORKER_PID_PATH = join(PM_LOOP_DATA_DIR, 'worker.pid');

const PM_LOOP_EMPTY_STATE = {
  events: [],
  signals: [],
  opportunities: [],
  specs: [],
  experiments: [],
  decisions: [],
};

const PM_LOOP_EMPTY_APPROVAL_STATE = {
  proposals: [],
  approvals: [],
};

function jsonError(writeJson, res, statusCode, message) {
  writeJson(res, statusCode, { error: message });
}

async function readTextIfExists(filepath, fallback = '') {
  try {
    return await readFile(filepath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonIfExists(filepath, fallback) {
  try {
    return JSON.parse(await readFile(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function getFileUpdatedAt(filepath) {
  return (await statOrNull(filepath))?.mtime?.toISOString?.() || null;
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function countByStatus(items = []) {
  const counts = {};
  for (const item of items) {
    const status = typeof item?.status === 'string' ? item.status : 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function tailLines(content, count = 120) {
  return String(content || '')
    .trim()
    .split('\n')
    .slice(-count)
    .join('\n');
}

function clipText(value, max = 120) {
  const text = normalizeNullableText(value).replace(/\s+/g, ' ');
  if (!text || !Number.isInteger(max) || max <= 0 || text.length <= max) {
    return text;
  }
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function buildOpportunityDispatchPayload(opportunity = {}, spec = null) {
  const sessionId = normalizeNullableText(opportunity?.primarySessionId);
  const branchTitle = clipText(
    spec?.title
    || opportunity?.title
    || spec?.trigger
    || '处理当前机会',
    72,
  );
  const checkpointSummary = clipText(
    spec?.desiredBehavior
    || opportunity?.problem
    || spec?.trigger
    || branchTitle,
    180,
  );
  const trigger = normalizeNullableText(spec?.trigger);
  const branchReason = clipText(
    [
      'PM loop 自动派发',
      trigger ? `触发：${trigger}` : '',
    ].filter(Boolean).join(' / '),
    180,
  );
  return {
    available: Boolean(sessionId && branchTitle),
    sessionId,
    branchTitle,
    checkpointSummary,
    branchReason,
    pattern: 'Next Best Action',
    label: '开启',
  };
}

export async function buildPmLoopOverview(options = {}) {
  const loadWorkbenchOutputMetrics = typeof options.loadWorkbenchOutputMetrics === 'function'
    ? options.loadWorkbenchOutputMetrics
    : getWorkbenchOutputMetrics;
  const loadWorkbenchSessions = typeof options.loadWorkbenchSessions === 'function'
    ? options.loadWorkbenchSessions
    : (() => listWorkbenchSessions({ includeArchived: true }));
  const loadState = typeof options.loadState === 'function'
    ? options.loadState
    : (() => readJsonIfExists(PM_LOOP_STATE_PATH, PM_LOOP_EMPTY_STATE));
  const loadApprovalState = typeof options.loadApprovalState === 'function'
    ? options.loadApprovalState
    : (() => readJsonIfExists(PM_LOOP_APPROVAL_STATE_PATH, PM_LOOP_EMPTY_APPROVAL_STATE));
  const loadReport = typeof options.loadReport === 'function'
    ? options.loadReport
    : (() => readTextIfExists(PM_LOOP_REPORT_PATH, ''));
  const loadTargets = typeof options.loadTargets === 'function'
    ? options.loadTargets
    : (() => readJsonIfExists(PM_LOOP_TARGETS_PATH, { targets: [] }));
  const loadWorkerLog = typeof options.loadWorkerLog === 'function'
    ? options.loadWorkerLog
    : (() => readTextIfExists(PM_LOOP_WORKER_LOG_PATH, ''));
  const loadWorkerPid = typeof options.loadWorkerPid === 'function'
    ? options.loadWorkerPid
    : (() => readTextIfExists(PM_LOOP_WORKER_PID_PATH, ''));
  const loadStateUpdatedAt = typeof options.loadStateUpdatedAt === 'function'
    ? options.loadStateUpdatedAt
    : (() => getFileUpdatedAt(PM_LOOP_STATE_PATH));
  const loadReportUpdatedAt = typeof options.loadReportUpdatedAt === 'function'
    ? options.loadReportUpdatedAt
    : (() => getFileUpdatedAt(PM_LOOP_REPORT_PATH));
  const loadWorkerLogUpdatedAt = typeof options.loadWorkerLogUpdatedAt === 'function'
    ? options.loadWorkerLogUpdatedAt
    : (() => getFileUpdatedAt(PM_LOOP_WORKER_LOG_PATH));
  const [state, approvalState, report, targetsFile, workerLog, workerPidRaw, stateUpdatedAt, reportUpdatedAt, workerLogUpdatedAt, workbenchMetrics, workbenchSessions] =
    await Promise.all([
      loadState(),
      loadApprovalState(),
      loadReport(),
      loadTargets(),
      loadWorkerLog(),
      loadWorkerPid(),
      loadStateUpdatedAt(),
      loadReportUpdatedAt(),
      loadWorkerLogUpdatedAt(),
      loadWorkbenchOutputMetrics(),
      loadWorkbenchSessions(),
    ]);

  const workerPid = Number(String(workerPidRaw || '').trim()) || null;
  const specsByOpportunityId = new Map((state.specs || []).map((spec) => [spec.opportunityId, spec]));
  const opportunitiesById = new Map((state.opportunities || []).map((opportunity) => [opportunity.id, opportunity]));
  const targets = Array.isArray(targetsFile?.targets) ? targetsFile.targets : [];
  const targetsById = new Map(targets.map((target) => [normalizeNullableText(target?.id), target]));
  const proposals = Array.isArray(approvalState?.proposals) ? approvalState.proposals : [];
  const approvals = Array.isArray(approvalState?.approvals) ? approvalState.approvals : [];
  const latestProposalByOpportunityId = new Map();
  for (const proposal of [...proposals].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))) {
    if (!latestProposalByOpportunityId.has(proposal.opportunityId)) {
      latestProposalByOpportunityId.set(proposal.opportunityId, proposal);
    }
  }
  const experimentsByOpportunityId = new Map();
  const sessionsById = new Map(
    (Array.isArray(workbenchSessions) ? workbenchSessions : [])
      .filter((session) => normalizeNullableText(session?.id))
      .map((session) => [normalizeNullableText(session.id), session]),
  );
  for (const experiment of state.experiments || []) {
    const list = experimentsByOpportunityId.get(experiment.opportunityId) || [];
    list.push(experiment);
    experimentsByOpportunityId.set(experiment.opportunityId, list);
  }
  const decisionsByExperimentId = new Map((state.decisions || []).map((decision) => [decision.experimentId, decision]));
  const proposalQueue = [...proposals]
    .filter((proposal) => proposal.status === 'queued' || proposal.status === 'deferred')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 8)
    .map((proposal) => ({
      ...proposal,
      targetLabel: normalizeNullableText(targetsById.get(normalizeNullableText(proposal.targetId))?.label) || normalizeNullableText(proposal.targetId),
      opportunityTitle: normalizeNullableText(opportunitiesById.get(proposal.opportunityId)?.title),
      specTitle: normalizeNullableText(specsByOpportunityId.get(proposal.opportunityId)?.title),
    }));
  const recentApprovals = [...approvals]
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
    .slice(0, 8);

  const opportunities = [...(state.opportunities || [])]
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, 8)
    .map((opportunity) => {
      const spec = specsByOpportunityId.get(opportunity.id) || null;
      const sourceSessionId = normalizeNullableText(opportunity.primarySessionId);
      const sourceSession = sessionsById.get(sourceSessionId) || null;
      const proposal = latestProposalByOpportunityId.get(opportunity.id) || null;
      const workflowSignals = sourceSession?.workflowSignals && typeof sourceSession.workflowSignals === 'object'
        ? sourceSession.workflowSignals
        : {};
      const experiments = (experimentsByOpportunityId.get(opportunity.id) || []).map((experiment) => ({
        id: experiment.id,
        status: experiment.status,
        mode: experiment.mode,
        owner: experiment.owner,
        summary: experiment.summary || '',
        decision: decisionsByExperimentId.get(experiment.id)?.outcome || null,
      }));
      return {
        ...opportunity,
        spec: spec ? {
          title: spec.title,
          trigger: spec.trigger,
          desiredBehavior: spec.desiredBehavior,
          references: Array.isArray(spec.references) ? spec.references : [],
        } : null,
        experiments,
        proposal: proposal ? {
          id: proposal.id,
          status: proposal.status,
          changeType: proposal.changeType,
          createdAt: proposal.createdAt,
          targetId: proposal.targetId,
          targetLabel: normalizeNullableText(targetsById.get(normalizeNullableText(proposal.targetId))?.label) || normalizeNullableText(proposal.targetId),
        } : null,
        dispatch: {
          ...buildOpportunityDispatchPayload(opportunity, spec),
          sessionTitle: normalizeNullableText(sourceSession?.name),
        },
        telemetry: {
          repeatedClarificationCount: Number.isInteger(workflowSignals.repeatedClarificationCount)
            ? workflowSignals.repeatedClarificationCount
            : 0,
          lastRepeatedClarificationAt: normalizeNullableText(workflowSignals.lastRepeatedClarificationAt),
          branchDispatch: normalizeBranchDispatchSignal(workflowSignals.branchDispatch),
        },
      };
    });

  const recentSignals = [...(state.signals || [])]
    .sort((a, b) => (b.impactedUsers || 0) - (a.impactedUsers || 0))
    .slice(0, 6);

  const activeExperiments = [...(state.experiments || [])]
    .filter((experiment) => experiment.status === 'running' || experiment.status === 'draft')
    .map((experiment) => ({
      ...experiment,
      decision: decisionsByExperimentId.get(experiment.id) || null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    rootDir: PM_LOOP_ROOT,
    worker: {
      pid: workerPid,
      alive: isProcessAlive(workerPid),
      logUpdatedAt: workerLogUpdatedAt,
    },
    freshness: {
      stateUpdatedAt,
      reportUpdatedAt,
    },
    files: {
      approvalState: PM_LOOP_APPROVAL_STATE_PATH,
      state: PM_LOOP_STATE_PATH,
      report: PM_LOOP_REPORT_PATH,
      workerLog: PM_LOOP_WORKER_LOG_PATH,
      workerPid: PM_LOOP_WORKER_PID_PATH,
    },
    counts: {
      events: (state.events || []).length,
      signals: (state.signals || []).length,
      opportunities: (state.opportunities || []).length,
      proposals: proposals.length,
      approvals: approvals.length,
      experiments: (state.experiments || []).length,
      decisions: (state.decisions || []).length,
    },
    stages: {
      opportunities: countByStatus(state.opportunities || []),
      proposals: countByStatus(proposals),
      experiments: countByStatus(state.experiments || []),
    },
    workbench: {
      generatedAt: normalizeNullableText(workbenchMetrics?.generatedAt),
      workflowSignals: workbenchMetrics?.workflowSignals || {
        repeatedClarificationCount: 0,
        repeatedClarificationInWindow: 0,
        branchDispatch: {
          attempts: 0,
          successes: 0,
          failures: 0,
          dayAttempts: 0,
          daySuccesses: 0,
          dayFailures: 0,
          successRate: 0,
          daySuccessRate: 0,
        },
      },
    },
    proposalQueue,
    recentApprovals,
    recentSignals,
    opportunities,
    activeExperiments,
    report,
    workerLog: tailLines(workerLog, 120),
  };
}

async function isDirectoryPath(path) {
  return (await statOrNull(path))?.isDirectory() === true;
}

export async function handleSystemReadRoutes(ctx) {
  const {
    req,
    res,
    pathname,
    parsedUrl,
    writeJson,
    writeJsonCached,
    writeFileCached,
    getAuthSession: getAuthSessionImpl = getAuthSession,
    refreshAuthSession: refreshAuthSessionImpl = refreshAuthSession,
  } = ctx;
  if (pathname === '/api/models' && req.method === 'GET') {
    const toolId = getQueryValue(parsedUrl?.query?.tool);
    const result = await getModelsForTool(toolId);
    writeJsonCached(req, res, result);
    return true;
  }

  if (pathname === '/api/tools' && req.method === 'GET') {
    const tools = await getAvailableToolsAsync();
    writeJsonCached(req, res, { tools });
    return true;
  }

  if (pathname === '/api/autocomplete' && req.method === 'GET') {
    const query = getQueryValue(parsedUrl?.query?.q);
    const suggestions = [];
    try {
      const resolvedQuery = query.startsWith('~') ? join(homedir(), query.slice(1)) : query;
      const parentDir = dirname(resolvedQuery);
      const prefix = basename(resolvedQuery);
      if (await isDirectoryPath(parentDir)) {
        for (const entry of await readdir(parentDir)) {
          if (!prefix.startsWith('.') && entry.startsWith('.')) continue;
          const fullPath = join(parentDir, entry);
          if (await isDirectoryPath(fullPath) && entry.toLowerCase().startsWith(prefix.toLowerCase())) {
            suggestions.push(fullPath);
          }
        }
      }
    } catch {}
    writeJsonCached(req, res, { suggestions: suggestions.slice(0, 20) });
    return true;
  }

  if (pathname === '/api/browse' && req.method === 'GET') {
    const pathQuery = getQueryValue(parsedUrl?.query?.path, '~') || '~';
    try {
      const resolvedPath = pathQuery === '~' || pathQuery === ''
        ? homedir()
        : pathQuery.startsWith('~')
          ? join(homedir(), pathQuery.slice(1))
          : resolve(pathQuery);
      const children = [];
      let parent = null;
      if (await isDirectoryPath(resolvedPath)) {
        const parentPath = dirname(resolvedPath);
        parent = parentPath !== resolvedPath ? parentPath : null;
        for (const entry of await readdir(resolvedPath)) {
          if (entry.startsWith('.')) continue;
          const fullPath = join(resolvedPath, entry);
          try {
            if (await isDirectoryPath(fullPath)) children.push({ name: entry, path: fullPath });
          } catch {}
        }
        children.sort((a, b) => a.name.localeCompare(b.name));
      }
      writeJsonCached(req, res, { path: resolvedPath, parent, children });
    } catch {
      jsonError(writeJson, res, 500, 'Failed to browse directory');
    }
    return true;
  }

  if (pathname === '/api/pm-loop/overview' && req.method === 'GET') {
    writeJsonCached(req, res, await buildPmLoopOverview());
    return true;
  }

  if (pathname.startsWith('/api/pm-loop/raw/') && req.method === 'GET') {
    const kind = pathname.slice('/api/pm-loop/raw/'.length);
    if (kind === 'report') {
      writeFileCached(
        req,
        res,
        'text/markdown; charset=utf-8',
        await readFile(PM_LOOP_REPORT_PATH),
        { cacheControl: 'no-cache, max-age=0, must-revalidate' },
      );
      return true;
    }

    if (kind === 'state') {
      writeFileCached(
        req,
        res,
        'application/json; charset=utf-8',
        await readFile(PM_LOOP_STATE_PATH),
        { cacheControl: 'no-cache, max-age=0, must-revalidate' },
      );
      return true;
    }

    if (kind === 'approval-state') {
      writeFileCached(
        req,
        res,
        'application/json; charset=utf-8',
        Buffer.from(JSON.stringify(await readJsonIfExists(PM_LOOP_APPROVAL_STATE_PATH, PM_LOOP_EMPTY_APPROVAL_STATE), null, 2)),
        { cacheControl: 'no-cache, max-age=0, must-revalidate' },
      );
      return true;
    }

    if (kind === 'log') {
      writeFileCached(
        req,
        res,
        'text/plain; charset=utf-8',
        Buffer.from(await readTextIfExists(PM_LOOP_WORKER_LOG_PATH)),
        { cacheControl: 'no-cache, max-age=0, must-revalidate' },
      );
      return true;
    }

    jsonError(writeJson, res, 404, 'Unknown pm-loop artifact');
    return true;
  }

  if ((pathname.startsWith('/api/images/') || pathname.startsWith('/api/media/')) && req.method === 'GET') {
    const prefix = pathname.startsWith('/api/media/') ? '/api/media/' : '/api/images/';
    const filename = pathname.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return true;
    }
    const filepath = join(CHAT_IMAGES_DIR, filename);
    if (!await pathExists(filepath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return true;
    }
    const ext = filename.split('.').pop()?.toLowerCase();
    writeFileCached(
      req,
      res,
      uploadedMediaMimeTypes[ext] || 'application/octet-stream',
      await readFile(filepath),
      { cacheControl: 'public, max-age=31536000, immutable' },
    );
    return true;
  }

  if (pathname === '/api/push/vapid-public-key' && req.method === 'GET') {
    writeJsonCached(req, res, { publicKey: await getPublicKey() });
    return true;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const authSession = getAuthSessionImpl(req);
    if (!authSession) {
      jsonError(writeJson, res, 401, 'Not authenticated');
      return true;
    }
    const info = buildAuthInfo(authSession);
    const refreshedCookie = await refreshAuthSessionImpl(req);
    writeJsonCached(req, res, info, {
      headers: refreshedCookie ? { 'Set-Cookie': refreshedCookie } : undefined,
    });
    return true;
  }

  return false;
}
