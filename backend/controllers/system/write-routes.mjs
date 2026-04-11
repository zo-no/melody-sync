import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { getAuthSession } from '../../../lib/auth.mjs';
import { saveUiRuntimeSelection } from '../../../lib/runtime-selection.mjs';
import { readBody } from '../../../lib/utils.mjs';

import { enqueueHostCompletionSpeech } from '../../completion-speech-queue.mjs';
import { playHostCompletionSound } from '../../completion-sound.mjs';
import { addSubscription } from '../../push.mjs';
import { buildWorkbenchSessionMutationResponse } from '../../services/workbench/http-service.mjs';
import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import { createBranchFromSession } from '../../workbench/index.mjs';
import { recordBranchDispatchSignal } from '../../workbench/branch-dispatch-signals.mjs';
import { getWorkbenchSession } from '../../workbench/session-ports.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';

const PM_LOOP_ROOT = join(homedir(), 'code', 'pm-loop');
const PM_LOOP_DATA_DIR = join(PM_LOOP_ROOT, 'data');
const PM_LOOP_APPROVAL_STATE_PATH = join(PM_LOOP_DATA_DIR, 'approval-state.json');
const PM_LOOP_STATE_PATH = join(PM_LOOP_DATA_DIR, 'state.json');
const PM_LOOP_EMPTY_APPROVAL_STATE = {
  proposals: [],
  approvals: [],
};

function jsonError(writeJson, res, statusCode, message) {
  writeJson(res, statusCode, { error: message });
}

async function readJsonIfExists(filepath, fallback) {
  try {
    return JSON.parse(await readFile(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filepath, payload) {
  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, JSON.stringify(payload, null, 2));
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
    sessionId,
    branchTitle,
    checkpointSummary,
    branchReason,
  };
}

export async function handleSystemWriteRoutes(ctx) {
  const {
    req,
    res,
    pathname,
    writeJson,
    getAuthSession: getAuthSessionImpl = getAuthSession,
    playHostCompletionSound: playHostCompletionSoundImpl = playHostCompletionSound,
    readPmLoopState = () => readJsonIfExists(PM_LOOP_STATE_PATH, {
      opportunities: [],
      specs: [],
    }),
    readPmLoopApprovalState = () => readJsonIfExists(PM_LOOP_APPROVAL_STATE_PATH, PM_LOOP_EMPTY_APPROVAL_STATE),
    writePmLoopApprovalState = (payload) => writeJsonFile(PM_LOOP_APPROVAL_STATE_PATH, payload),
    getWorkbenchSession: getWorkbenchSessionImpl = getWorkbenchSession,
    createBranchFromSession: createBranchFromSessionImpl = createBranchFromSession,
    recordBranchDispatchSignal: recordBranchDispatchSignalImpl = recordBranchDispatchSignal,
  } = ctx;
  if (pathname === '/api/runtime-selection' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonRequestBody(req, 4096);
    } catch (err) {
      jsonError(writeJson, res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, err.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request');
      return true;
    }
    try {
      const selection = await saveUiRuntimeSelection(body || {});
      writeJson(res, 200, { selection });
    } catch (error) {
      jsonError(writeJson, res, 400, error.message || 'Failed to save runtime selection');
    }
    return true;
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonRequestBody(req, 4096);
    } catch {
      jsonError(writeJson, res, 400, 'Bad request');
      return true;
    }
    try {
      const sub = body;
      if (!sub.endpoint) throw new Error('Missing endpoint');
      await addSubscription(sub);
      writeJson(res, 200, { ok: true });
    } catch {
      jsonError(writeJson, res, 400, 'Invalid subscription');
    }
    return true;
  }

  if (pathname === '/api/system/completion-sound' && req.method === 'POST') {
    const authSession = getAuthSessionImpl(req);
    if (authSession?.role !== 'owner') {
      jsonError(writeJson, res, 403, 'Owner access required');
      return true;
    }
    try {
      let body = '';
      try {
        body = await readBody(req, 4096);
      } catch {}
      const parsedBody = body ? JSON.parse(body) : {};
      const completionNoticeKey = typeof parsedBody?.completionNoticeKey === 'string'
        ? parsedBody.completionNoticeKey.trim()
        : '';
      const runId = typeof parsedBody?.runId === 'string'
        ? parsedBody.runId.trim()
        : '';
      const speechText = typeof parsedBody?.speechText === 'string'
        ? parsedBody.speechText
        : undefined;
      const completionVoiceProvider = typeof parsedBody?.completionTtsProvider === 'string'
        ? parsedBody.completionTtsProvider
        : undefined;
      const completionFallbackToSay = typeof parsedBody?.fallbackToSay === 'boolean'
        ? parsedBody.fallbackToSay
        : undefined;
      const voice = typeof parsedBody?.voice === 'string'
        ? parsedBody.voice
        : undefined;
      const rate = Number.isFinite(Number(parsedBody?.rate))
        ? Number(parsedBody.rate)
        : undefined;

      if (completionNoticeKey) {
        const queuedPath = await enqueueHostCompletionSpeech({
          speechText,
          voice,
          rate,
          completionNoticeKey,
          runId,
          completionTtsProvider: completionVoiceProvider,
          fallbackToSay: completionFallbackToSay,
        });
        writeJson(res, 200, {
          ok: true,
          mode: queuedPath ? 'host:queued' : 'host:deduped',
          soundPath: '',
          queue: !!queuedPath,
        });
        return true;
      }

      const playback = await playHostCompletionSoundImpl({
        speechText,
        voice,
        rate,
        completionTtsProvider: completionVoiceProvider,
        fallbackToSay: completionFallbackToSay,
      });
      writeJson(res, 200, {
        ok: true,
        mode: playback?.provider ? `host:${playback.provider}` : 'host',
        soundPath: playback?.soundPath || '',
      });
    } catch (error) {
      jsonError(writeJson, res, 500, error?.message || 'Failed to play host completion sound');
    }
    return true;
  }

  const proposalActionMatch = pathname.match(/^\/api\/pm-loop\/proposals\/([^/]+)\/(approve|reject|defer)$/);
  if (proposalActionMatch && req.method === 'POST') {
    const authSession = getAuthSessionImpl(req);
    if (authSession?.role !== 'owner') {
      jsonError(writeJson, res, 403, 'Owner access required');
      return true;
    }
    const [, rawProposalId, action] = proposalActionMatch;
    const proposalId = decodeURIComponent(rawProposalId);
    let body = {};
    try {
      body = await readJsonRequestBody(req, 4096);
    } catch {}
    const approvalState = await readPmLoopApprovalState();
    const proposals = Array.isArray(approvalState?.proposals) ? approvalState.proposals : [];
    const approvals = Array.isArray(approvalState?.approvals) ? approvalState.approvals : [];
    const proposal = proposals.find((candidate) => normalizeNullableText(candidate?.id) === proposalId);
    if (!proposal) {
      jsonError(writeJson, res, 404, 'Proposal not found');
      return true;
    }
    const outcome = action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : 'deferred';
    const updatedProposal = {
      ...proposal,
      status: outcome,
    };
    const actor = normalizeNullableText(authSession?.email)
      || normalizeNullableText(authSession?.username)
      || normalizeNullableText(authSession?.role)
      || 'owner';
    const approval = {
      id: `approval:${proposalId}:${Date.now()}`,
      proposalId,
      outcome,
      actor,
      note: normalizeNullableText(body?.note),
      ts: new Date().toISOString(),
    };
    await writePmLoopApprovalState({
      proposals: proposals.map((candidate) => (
        normalizeNullableText(candidate?.id) === proposalId ? updatedProposal : candidate
      )),
      approvals: [...approvals, approval],
    });
    writeJson(res, 200, {
      ok: true,
      proposal: updatedProposal,
      approval,
    });
    return true;
  }

  if (pathname.startsWith('/api/pm-loop/opportunities/') && pathname.endsWith('/dispatch') && req.method === 'POST') {
    const authSession = getAuthSessionImpl(req);
    if (authSession?.role !== 'owner') {
      jsonError(writeJson, res, 403, 'Owner access required');
      return true;
    }
    const opportunityId = decodeURIComponent(
      pathname.slice('/api/pm-loop/opportunities/'.length, -('/dispatch'.length)),
    );
    const state = await readPmLoopState();
    const opportunity = Array.isArray(state?.opportunities)
      ? state.opportunities.find((entry) => normalizeNullableText(entry?.id) === opportunityId)
      : null;
    if (!opportunity) {
      jsonError(writeJson, res, 404, 'Opportunity not found');
      return true;
    }
    const spec = Array.isArray(state?.specs)
      ? state.specs.find((entry) => normalizeNullableText(entry?.opportunityId) === opportunityId) || null
      : null;
    const dispatch = buildOpportunityDispatchPayload(opportunity, spec);
    if (!dispatch.sessionId) {
      jsonError(writeJson, res, 400, 'Opportunity has no primary session to dispatch from');
      return true;
    }
    const sourceSession = await getWorkbenchSessionImpl(dispatch.sessionId);
    if (!sourceSession) {
      jsonError(writeJson, res, 404, 'Source session not found');
      return true;
    }
    await recordBranchDispatchSignalImpl(dispatch.sessionId, {
      outcome: 'attempt',
      sourceSessionId: dispatch.sessionId,
    });
    try {
      const outcome = await createBranchFromSessionImpl(dispatch.sessionId, {
        goal: dispatch.branchTitle,
        branchReason: dispatch.branchReason,
        checkpointSummary: dispatch.checkpointSummary,
      });
      await recordBranchDispatchSignalImpl(dispatch.sessionId, {
        outcome: 'success',
        branchTitle: dispatch.branchTitle,
        sourceSessionId: dispatch.sessionId,
      });
      writeJson(res, 201, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
        dispatch: {
          opportunityId,
          sourceSessionId: dispatch.sessionId,
          branchTitle: dispatch.branchTitle,
          checkpointSummary: dispatch.checkpointSummary,
        },
      }));
    } catch (error) {
      await recordBranchDispatchSignalImpl(dispatch.sessionId, {
        outcome: 'failure',
        failureReason: String(error?.message || ''),
        sourceSessionId: dispatch.sessionId,
      });
      jsonError(writeJson, res, 400, error?.message || 'Failed to dispatch opportunity');
    }
    return true;
  }

  return false;
}
