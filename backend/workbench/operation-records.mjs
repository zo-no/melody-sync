import { loadHistory } from '../history.mjs';
import { buildPersistentDigest } from '../session-persistent/core.mjs';
import { getWorkbenchSession, listWorkbenchSessions } from './session-ports.mjs';
import { loadWorkbenchState } from './state-store.mjs';
import {
  normalizeBranchContextStatus,
  normalizeNullableText,
  trimText,
} from './shared.mjs';

function toOperationRecordCommit(event) {
  return {
    seq: event.seq,
    preview: trimText(typeof event.content === 'string' ? event.content : '').slice(0, 60) || '(message)',
    timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
  };
}

async function loadSessionOperationCommits(sessionId) {
  try {
    const events = await loadHistory(sessionId, { includeBodies: false });
    return events
      .filter((ev) => ev.type === 'message' && ev.role === 'user')
      .map(toOperationRecordCommit);
  } catch {
    return [];
  }
}

function branchContextRecencyKey(context) {
  return normalizeNullableText(context?.updatedAt) || normalizeNullableText(context?.createdAt) || '';
}

function isNewerBranchContext(candidate, existing) {
  const candidateKey = branchContextRecencyKey(candidate);
  const existingKey = branchContextRecencyKey(existing);
  if (candidateKey && existingKey && candidateKey !== existingKey) {
    return candidateKey > existingKey;
  }
  if (candidateKey && !existingKey) return true;
  if (!candidateKey && existingKey) return false;
  const candidateForkSeq = Number.isInteger(candidate?.forkAtSeq) ? candidate.forkAtSeq : -1;
  const existingForkSeq = Number.isInteger(existing?.forkAtSeq) ? existing.forkAtSeq : -1;
  if (candidateForkSeq !== existingForkSeq) {
    return candidateForkSeq > existingForkSeq;
  }
  return normalizeNullableText(candidate?.id) > normalizeNullableText(existing?.id);
}

function dedupeBranchContextsBySession(contexts) {
  const latestBySessionId = new Map();
  for (const context of Array.isArray(contexts) ? contexts : []) {
    const sessionId = normalizeNullableText(context?.sessionId);
    if (!sessionId) continue;
    const existing = latestBySessionId.get(sessionId);
    if (!existing || isNewerBranchContext(context, existing)) {
      latestBySessionId.set(sessionId, context);
    }
  }
  return Array.from(latestBySessionId.values());
}

function sortOperationRecordBranches(branches) {
  branches.sort((a, b) => {
    const aFork = a.forkAtSeq ?? Infinity;
    const bFork = b.forkAtSeq ?? Infinity;
    if (aFork !== bFork) return aFork - bFork;
    const aCreatedAt = a.createdAt || '';
    const bCreatedAt = b.createdAt || '';
    if (aCreatedAt !== bCreatedAt) return aCreatedAt < bCreatedAt ? -1 : 1;
    return a.branchSessionId < b.branchSessionId ? -1 : 1;
  });
  return branches;
}

function createBranchContextsByParent(contexts) {
  const contextsByParentId = new Map();
  for (const context of Array.isArray(contexts) ? contexts : []) {
    const parentSessionId = normalizeNullableText(context?.parentSessionId);
    if (!parentSessionId) continue;
    if (!contextsByParentId.has(parentSessionId)) {
      contextsByParentId.set(parentSessionId, []);
    }
    contextsByParentId.get(parentSessionId).push(context);
  }
  for (const childContexts of contextsByParentId.values()) {
    childContexts.sort((a, b) => {
      const aFork = Number.isInteger(a?.forkAtSeq) ? a.forkAtSeq : Infinity;
      const bFork = Number.isInteger(b?.forkAtSeq) ? b.forkAtSeq : Infinity;
      if (aFork !== bFork) return aFork - bFork;
      const aCreatedAt = normalizeNullableText(a?.createdAt);
      const bCreatedAt = normalizeNullableText(b?.createdAt);
      if (aCreatedAt !== bCreatedAt) return aCreatedAt < bCreatedAt ? -1 : 1;
      return normalizeNullableText(a?.sessionId) < normalizeNullableText(b?.sessionId) ? -1 : 1;
    });
  }
  return contextsByParentId;
}

function resolveOperationRecordRootSessionId(session, branchContextBySessionId) {
  const explicitRootSessionId = normalizeNullableText(session?.rootSessionId);
  if (explicitRootSessionId) return explicitRootSessionId;

  let cursorSessionId = normalizeNullableText(session?.id);
  const visited = new Set();
  while (cursorSessionId && !visited.has(cursorSessionId)) {
    visited.add(cursorSessionId);
    const context = branchContextBySessionId.get(cursorSessionId);
    const parentSessionId = normalizeNullableText(context?.parentSessionId);
    if (!parentSessionId) {
      return cursorSessionId;
    }
    cursorSessionId = parentSessionId;
  }
  return normalizeNullableText(session?.id);
}

async function buildBranchNode(ctx, sess, sessionMap, contextsByParentId) {
  const commits = await loadSessionOperationCommits(sess.id);
  const status = normalizeBranchContextStatus(ctx.status);
  const broughtBack = normalizeNullableText(ctx.checkpointSummary) || null;

  const childContexts = contextsByParentId.get(sess.id) || [];
  const subBranches = (await Promise.all(childContexts.map(async (subCtx) => {
    const subSessionId = normalizeNullableText(subCtx.sessionId);
    const subSess = sessionMap.get(subSessionId);
    if (!subSess) return null;
    return buildBranchNode(subCtx, subSess, sessionMap, contextsByParentId);
  }))).filter(Boolean);

  sortOperationRecordBranches(subBranches);

  return {
    branchSessionId: sess.id,
    name: normalizeNullableText(sess.name) || 'Untitled',
    goal: normalizeNullableText(sess.taskCard?.goal) || normalizeNullableText(ctx.goal) || '',
    forkAtSeq: Number.isInteger(ctx.forkAtSeq) ? ctx.forkAtSeq : null,
    status,
    broughtBack,
    createdAt: normalizeNullableText(ctx.createdAt),
    updatedAt: normalizeNullableText(ctx.updatedAt),
    lastEventAt: sess.lastEventAt ? new Date(sess.lastEventAt).toISOString() : null,
    commits,
    subBranches,
  };
}

export async function getSessionOperationRecords(sessionId) {
  const normalizedSessionId = normalizeNullableText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }

  const session = await getWorkbenchSession(normalizedSessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const state = await loadWorkbenchState();
  const allSessions = await listWorkbenchSessions({ includeArchived: true });
  const sessionMap = new Map(allSessions.map((entry) => [entry.id, entry]));
  const allContexts = dedupeBranchContextsBySession(state.branchContexts || []);
  const branchContextBySessionId = new Map(allContexts.map((ctx) => [normalizeNullableText(ctx.sessionId), ctx]));
  const contextsByParentId = createBranchContextsByParent(allContexts);

  const rootSessionId = resolveOperationRecordRootSessionId(session, branchContextBySessionId) || normalizedSessionId;
  const rootSession = sessionMap.get(rootSessionId) || session;
  const mainCommits = await loadSessionOperationCommits(rootSessionId);
  const persistentPreviewHistory = await loadHistory(normalizedSessionId, { includeBodies: false }).catch(() => []);

  const commitNodes = mainCommits.map((commit) => ({
    type: 'commit',
    ...commit,
    branches: [],
  }));
  const commitBySeq = new Map(commitNodes.map((commit) => [commit.seq, commit]));

  const topLevelBranchNodes = (await Promise.all((contextsByParentId.get(rootSessionId) || []).map(async (ctx) => {
    const branchSessionId = normalizeNullableText(ctx.sessionId);
    const branchSession = sessionMap.get(branchSessionId);
    if (!branchSession) return null;
    return buildBranchNode(ctx, branchSession, sessionMap, contextsByParentId);
  }))).filter(Boolean);

  const danglingBranches = [];
  for (const branchNode of topLevelBranchNodes) {
    const forkCommit = branchNode.forkAtSeq != null ? commitBySeq.get(branchNode.forkAtSeq) : null;
    if (forkCommit) {
      forkCommit.branches.push(branchNode);
    } else {
      danglingBranches.push(branchNode);
    }
  }

  for (const commit of commitNodes) {
    sortOperationRecordBranches(commit.branches);
  }
  sortOperationRecordBranches(danglingBranches);

  const items = [];
  for (const commit of commitNodes) {
    items.push(commit);
    for (const branch of commit.branches) {
      items.push({
        type: 'branch',
        ...branch,
      });
    }
  }
  for (const branch of danglingBranches) {
    items.push({
      type: 'branch',
      ...branch,
    });
  }

  return {
    sessionId: rootSessionId,
    name: normalizeNullableText(session.name) || normalizeNullableText(rootSession.name) || 'Untitled',
    goal: normalizeNullableText(session.taskCard?.goal) || normalizeNullableText(rootSession.taskCard?.goal) || '',
    persistent: session?.persistent || null,
    persistentPreview: buildPersistentDigest(session, persistentPreviewHistory),
    currentSessionId: normalizedSessionId,
    items,
  };
}
