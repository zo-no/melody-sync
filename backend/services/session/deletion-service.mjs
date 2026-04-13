import { resolve } from 'path';
import { CHAT_FILE_ASSET_CACHE_DIR, CHAT_IMAGES_DIR } from '../../../lib/config.mjs';
import { loadHistory } from '../../history.mjs';
import { deleteFileAssets } from '../../file-assets.mjs';
import { removePath } from '../../fs-utils.mjs';
import { getRun, listRunIds, runDir } from '../../run/store.mjs';
import { writeSessionDeletionJournalEntry } from '../../session/deletion-journal.mjs';
import { loadSessionsMeta, withSessionsMetaMutation } from '../../session/meta-store.mjs';
import { normalizePublishedResultAssetAttachments } from '../../result-assets.mjs';
import { workbenchQueue } from '../../workbench/queues.mjs';
import { loadWorkbenchState, saveWorkbenchState } from '../../workbench/state-store.mjs';
import { trimText } from '../../shared/text.mjs';

export function collectSessionTreeIds(rootSessionId, metas = []) {
  const queue = [rootSessionId];
  const collected = [];
  const seen = new Set();

  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    collected.push(sessionId);
    for (const meta of Array.isArray(metas) ? metas : []) {
      const parentSessionId = typeof meta?.sourceContext?.parentSessionId === 'string'
        ? meta.sourceContext.parentSessionId.trim()
        : '';
      if (parentSessionId && parentSessionId === sessionId && meta?.id && !seen.has(meta.id)) {
        queue.push(meta.id);
      }
    }
  }

  return collected;
}

function isManagedSessionPath(candidatePath, managedDir) {
  const target = trimText(candidatePath);
  const baseDir = trimText(managedDir);
  if (!target || !baseDir) return false;
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(managedDir);
  return resolvedTarget === resolvedBase
    || resolvedTarget.startsWith(`${resolvedBase}/`)
    || resolvedTarget.startsWith(`${resolvedBase}\\`);
}

function collectSessionManagedArtifacts(historiesBySessionId = {}, sessionIds = []) {
  const managedPaths = new Set();
  const fileAssetIds = new Set();

  for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      if (!Array.isArray(event?.images)) continue;
      for (const image of event.images) {
        const savedPath = trimText(image?.savedPath);
        const assetId = trimText(image?.assetId);
        if (savedPath && (
          isManagedSessionPath(savedPath, CHAT_IMAGES_DIR)
          || isManagedSessionPath(savedPath, CHAT_FILE_ASSET_CACHE_DIR)
        )) {
          managedPaths.add(savedPath);
        }
        if (assetId) {
          fileAssetIds.add(assetId);
        }
      }
    }
  }

  return {
    managedPaths: [...managedPaths],
    fileAssetIds: [...fileAssetIds],
  };
}

async function collectRunPublishedFileAssetIds(sessionIds = []) {
  const targets = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targets.size) return [];
  const fileAssetIds = new Set();
  const runIds = await listRunIds();
  for (const runId of runIds) {
    const run = await getRun(runId);
    if (!run?.sessionId || !targets.has(run.sessionId)) continue;
    for (const attachment of normalizePublishedResultAssetAttachments(run?.publishedResultAssets || [])) {
      if (trimText(attachment?.assetId)) {
        fileAssetIds.add(trimText(attachment.assetId));
      }
    }
  }
  return [...fileAssetIds];
}

async function pruneWorkbenchSessionArtifacts(sessionIds = []) {
  const targetIds = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targetIds.size) return;

  await workbenchQueue(async () => {
    const state = await loadWorkbenchState();
    const removedProjectIds = new Set(
      (state.projects || [])
        .filter((entry) => targetIds.has(trimText(entry?.scopeKey)))
        .map((entry) => trimText(entry?.id))
        .filter(Boolean),
    );

    state.projects = (state.projects || []).filter((entry) => !targetIds.has(trimText(entry?.scopeKey)));
    state.branchContexts = (state.branchContexts || []).filter((entry) => (
      !targetIds.has(trimText(entry?.sessionId))
      && !targetIds.has(trimText(entry?.parentSessionId))
    ));
    state.taskMapPlans = (state.taskMapPlans || []).flatMap((plan) => {
      if (targetIds.has(trimText(plan?.rootSessionId))) {
        return [];
      }
      const removedNodeIds = new Set(
        (Array.isArray(plan?.nodes) ? plan.nodes : [])
          .filter((node) => (
            targetIds.has(trimText(node?.sessionId))
            || targetIds.has(trimText(node?.sourceSessionId))
          ))
          .map((node) => trimText(node?.id))
          .filter(Boolean),
      );
      if (!removedNodeIds.size) {
        return [plan];
      }
      const nodes = (plan.nodes || []).filter((node) => !removedNodeIds.has(trimText(node?.id)));
      if (!nodes.length) {
        return [];
      }
      const nodeIds = new Set(nodes.map((node) => trimText(node?.id)).filter(Boolean));
      const edges = (plan.edges || []).filter((edge) => (
        nodeIds.has(trimText(edge?.fromNodeId))
        && nodeIds.has(trimText(edge?.toNodeId))
      ));
      return [{
        ...plan,
        nodes,
        edges,
        activeNodeId: nodeIds.has(trimText(plan?.activeNodeId))
          ? trimText(plan.activeNodeId)
          : trimText(nodes[0]?.id),
      }];
    });
    state.nodes = (state.nodes || []).filter((entry) => !removedProjectIds.has(trimText(entry?.projectId)));
    state.summaries = (state.summaries || []).filter((entry) => !removedProjectIds.has(trimText(entry?.projectId)));

    await saveWorkbenchState(state);
  });
}

async function deleteSessionRuns(sessionIds = [], { onDeleteRun } = {}) {
  const targets = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targets.size) return;
  const runIds = await listRunIds();
  for (const runId of runIds) {
    const run = await getRun(runId);
    if (!run?.sessionId || !targets.has(run.sessionId)) continue;
    if (typeof onDeleteRun === 'function') {
      onDeleteRun(runId);
    }
    await removePath(runDir(runId));
  }
}

export function assertSessionCanBeDeletedPermanently(session) {
  // Any session can be deleted directly — no archive prerequisite
  if (!session?.id) {
    const error = new Error('Session not found.');
    error.statusCode = 404;
    throw error;
  }
}

export async function buildPermanentSessionDeletionPlan(rootSessionId, current) {
  const metas = await loadSessionsMeta();
  const targetTreeIds = collectSessionTreeIds(rootSessionId, metas);
  if (!targetTreeIds.length) return null;
  const targetIdSet = new Set(targetTreeIds);
  const rootSession = metas.find((meta) => meta?.id === rootSessionId) || current;
  const relatedSessions = metas.filter((meta) => meta?.id && targetIdSet.has(meta.id) && meta.id !== rootSessionId);
  const historyEntries = await Promise.all(targetTreeIds.map(async (sessionId) => [
    sessionId,
    await loadHistory(sessionId, { includeBodies: true }).catch(() => []),
  ]));
  const historiesBySessionId = Object.fromEntries(historyEntries);
  return {
    rootSession,
    relatedSessions,
    targetTreeIds,
    targetIdSet,
    historiesBySessionId,
    deletionArtifacts: collectSessionManagedArtifacts(historiesBySessionId, targetTreeIds),
    runFileAssetIds: await collectRunPublishedFileAssetIds(targetTreeIds),
  };
}

export async function writePermanentSessionDeletionJournal(deletionPlan) {
  await writeSessionDeletionJournalEntry({
    rootSession: deletionPlan.rootSession,
    relatedSessions: deletionPlan.relatedSessions,
    historiesBySessionId: deletionPlan.historiesBySessionId,
    deletedSessionIds: deletionPlan.targetTreeIds,
  });
}

export async function deleteSessionTreeMetadata(targetIdSet) {
  return withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    const treeIds = metas
      .map((meta) => trimText(meta?.id))
      .filter((sessionId) => sessionId && targetIdSet.has(sessionId));
    if (!treeIds.length) return [];
    const matchedIds = new Set(treeIds);
    const nextMetas = metas.filter((meta) => !matchedIds.has(meta?.id));
    metas.splice(0, metas.length, ...nextMetas);
    await saveSessionsMeta(metas);
    return treeIds;
  });
}

export async function deletePermanentSessionArtifacts(sessionIds = [], {
  managedPaths = [],
  fileAssetIds = [],
  runFileAssetIds = [],
} = {}, {
  onDeleteRun,
} = {}) {
  await deleteSessionRuns(sessionIds, { onDeleteRun });
  await pruneWorkbenchSessionArtifacts(sessionIds).catch(() => {});

  for (const managedPath of managedPaths) {
    await removePath(managedPath).catch(() => {});
  }
  await deleteFileAssets([
    ...fileAssetIds,
    ...runFileAssetIds,
  ]).catch(() => {});
}
