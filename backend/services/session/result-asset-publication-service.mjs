import { loadHistory } from '../../history.mjs';

async function findResultAssetMessageForRun(sessionId, runId) {
  const events = await loadHistory(sessionId, { includeBodies: false });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'assistant') continue;
    if (event?.source !== 'result_file_assets') continue;
    if (event?.resultRunId !== runId) continue;
    return event;
  }
  return null;
}

export function createResultAssetPublicationService({
  appendEvent,
  buildResultAssetReadyMessage,
  collectGeneratedResultFilesFromRun,
  messageEvent,
  normalizePublishedResultAssetAttachments,
  nowIso,
  publishLocalFileAssetFromPath,
  updateRun,
}) {
  async function maybePublishRunResultAssets(sessionId, run, manifest, normalizedEvents) {
    if (manifest?.internalOperation) {
      return false;
    }

    let attachments = normalizePublishedResultAssetAttachments(run?.publishedResultAssets || []);
    if (attachments.length === 0) {
      const generatedFiles = await collectGeneratedResultFilesFromRun(run, manifest, normalizedEvents);
      if (generatedFiles.length === 0) {
        return false;
      }

      const publishedAssets = [];
      for (const file of generatedFiles) {
        try {
          const published = await publishLocalFileAssetFromPath({
            sessionId,
            localPath: file.localPath,
            originalName: file.originalName,
            mimeType: file.mimeType,
            createdBy: 'assistant',
          });
          publishedAssets.push({
            assetId: published.id,
            originalName: published.originalName || file.originalName,
            mimeType: published.mimeType || file.mimeType,
          });
        } catch (error) {
          console.error(`[result-file-assets] Failed to publish ${file.localPath}: ${error?.message || error}`);
        }
      }

      if (publishedAssets.length === 0) {
        return false;
      }

      const updatedRun = await updateRun(run.id, (current) => ({
        ...current,
        publishedResultAssets: Array.isArray(current.publishedResultAssets) && current.publishedResultAssets.length > 0
          ? current.publishedResultAssets
          : publishedAssets,
        publishedResultAssetsAt: current.publishedResultAssetsAt || nowIso(),
      })) || run;
      attachments = normalizePublishedResultAssetAttachments(updatedRun.publishedResultAssets || publishedAssets);
    }

    if (attachments.length === 0) {
      return false;
    }
    if (await findResultAssetMessageForRun(sessionId, run.id)) {
      return false;
    }

    await appendEvent(sessionId, messageEvent('assistant', buildResultAssetReadyMessage(attachments), attachments, {
      source: 'result_file_assets',
      resultRunId: run.id,
      ...(run.requestId ? { requestId: run.requestId } : {}),
    }));
    return true;
  }

  return {
    maybePublishRunResultAssets,
  };
}
