export function createFollowUpQueueHelpers({
  normalizeSourceContext,
  sanitizeQueuedFollowUpAttachments,
  formatAttachmentContextLine,
  maxRecentFollowUpRequestIds,
}) {
  function getFollowUpQueue(meta) {
    return Array.isArray(meta?.followUpQueue) ? meta.followUpQueue : [];
  }

  function getFollowUpQueueCount(meta) {
    return getFollowUpQueue(meta).length;
  }

  function buildQueuedFollowUpSourceContext(queue = []) {
    if (!Array.isArray(queue) || queue.length === 0) return null;
    if (queue.length === 1) {
      return normalizeSourceContext(queue[0]?.sourceContext);
    }
    const queuedMessages = queue
      .map((entry) => {
        const sourceContext = normalizeSourceContext(entry?.sourceContext);
        if (!sourceContext) return null;
        const requestId = typeof entry?.requestId === 'string' ? entry.requestId.trim() : '';
        return {
          ...(requestId ? { requestId } : {}),
          sourceContext,
        };
      })
      .filter(Boolean);
    return queuedMessages.length > 0 ? { queuedMessages } : null;
  }

  function serializeQueuedFollowUp(entry) {
    return {
      requestId: typeof entry?.requestId === 'string' ? entry.requestId : '',
      text: typeof entry?.text === 'string' ? entry.text : '',
      queuedAt: typeof entry?.queuedAt === 'string' ? entry.queuedAt : '',
      images: (entry?.images || []).map((image) => ({
        ...(image?.filename ? { filename: image.filename } : {}),
        ...(image?.assetId ? { assetId: image.assetId } : {}),
        ...(image?.originalName ? { originalName: image.originalName } : {}),
        ...(image?.mimeType ? { mimeType: image.mimeType } : {}),
      })),
    };
  }

  function serializeQueuedFollowUpForMatch(entry) {
    return JSON.stringify({
      requestId: typeof entry?.requestId === 'string' ? entry.requestId : '',
      text: typeof entry?.text === 'string' ? entry.text : '',
      queuedAt: typeof entry?.queuedAt === 'string' ? entry.queuedAt : '',
      images: sanitizeQueuedFollowUpAttachments(entry?.images),
      tool: typeof entry?.tool === 'string' ? entry.tool : '',
      model: typeof entry?.model === 'string' ? entry.model : '',
      effort: typeof entry?.effort === 'string' ? entry.effort : '',
      thinking: entry?.thinking === true,
      sourceContext: normalizeSourceContext(entry?.sourceContext),
    });
  }

  function removeDispatchedQueuedFollowUps(currentQueue, dispatchedQueue) {
    const current = Array.isArray(currentQueue) ? currentQueue : [];
    const dispatched = Array.isArray(dispatchedQueue) ? dispatchedQueue : [];
    if (current.length === 0 || dispatched.length === 0) return current;

    const prefixMatches = current.length >= dispatched.length
      && dispatched.every((entry, index) => (
        serializeQueuedFollowUpForMatch(current[index]) === serializeQueuedFollowUpForMatch(entry)
      ));
    if (prefixMatches) {
      return current.slice(dispatched.length);
    }

    const requestIdSet = new Set(
      dispatched
        .map((entry) => (typeof entry?.requestId === 'string' ? entry.requestId.trim() : ''))
        .filter(Boolean),
    );
    if (requestIdSet.size === 0) {
      return current;
    }
    return current.filter((entry) => !requestIdSet.has(typeof entry?.requestId === 'string' ? entry.requestId : ''));
  }

  function trimRecentFollowUpRequestIds(ids) {
    if (!Array.isArray(ids)) return [];
    const unique = [];
    const seen = new Set();
    for (const value of ids) {
      const requestId = typeof value === 'string' ? value.trim() : '';
      if (!requestId || seen.has(requestId)) continue;
      seen.add(requestId);
      unique.push(requestId);
    }
    return unique.slice(-maxRecentFollowUpRequestIds);
  }

  function hasRecentFollowUpRequestId(meta, requestId) {
    const normalized = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalized) return false;
    return trimRecentFollowUpRequestIds(meta?.recentFollowUpRequestIds).includes(normalized);
  }

  function findQueuedFollowUpByRequest(meta, requestId) {
    const normalized = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalized) return null;
    return getFollowUpQueue(meta).find((entry) => entry.requestId === normalized) || null;
  }

  function formatQueuedFollowUpTextEntry(entry, index) {
    const lines = [];
    if (index !== null) {
      lines.push(`${index + 1}.`);
    }
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (text) {
      if (index !== null) {
        lines[0] = `${lines[0]} ${text}`;
      } else {
        lines.push(text);
      }
    }
    const attachmentLine = formatAttachmentContextLine(entry?.images);
    if (attachmentLine) lines.push(attachmentLine);
    return lines.join('\n');
  }

  function buildQueuedFollowUpTranscriptText(queue) {
    if (!Array.isArray(queue) || queue.length === 0) return '';
    if (queue.length === 1) {
      return formatQueuedFollowUpTextEntry(queue[0], null);
    }
    return [
      'Queued follow-up messages sent while MelodySync was busy:',
      '',
      ...queue.map((entry, index) => formatQueuedFollowUpTextEntry(entry, index)),
    ].join('\n\n');
  }

  function buildQueuedFollowUpDispatchText(queue) {
    if (!Array.isArray(queue) || queue.length === 0) return '';
    if (queue.length === 1) {
      return buildQueuedFollowUpTranscriptText(queue);
    }
    return [
      `The user sent ${queue.length} follow-up messages while you were busy.`,
      'Treat the ordered items below as the next user turn.',
      'If a later item corrects or overrides an earlier one, follow the latest correction.',
      '',
      ...queue.map((entry, index) => formatQueuedFollowUpTextEntry(entry, index)),
    ].join('\n\n');
  }

  function resolveQueuedFollowUpDispatchOptions(queue, session) {
    const resolved = {
      tool: session?.tool || '',
      model: undefined,
      effort: undefined,
      thinking: false,
    };
    for (const entry of queue || []) {
      if (typeof entry?.tool === 'string' && entry.tool.trim()) {
        resolved.tool = entry.tool.trim();
      }
      if (typeof entry?.model === 'string' && entry.model.trim()) {
        resolved.model = entry.model.trim();
      }
      if (typeof entry?.effort === 'string' && entry.effort.trim()) {
        resolved.effort = entry.effort.trim();
      }
      if (entry?.thinking === true) {
        resolved.thinking = true;
      }
    }
    if (!resolved.tool) {
      resolved.tool = session?.tool || 'codex';
    }
    return resolved;
  }

  return {
    getFollowUpQueue,
    getFollowUpQueueCount,
    buildQueuedFollowUpSourceContext,
    serializeQueuedFollowUp,
    removeDispatchedQueuedFollowUps,
    trimRecentFollowUpRequestIds,
    hasRecentFollowUpRequestId,
    findQueuedFollowUpByRequest,
    buildQueuedFollowUpTranscriptText,
    buildQueuedFollowUpDispatchText,
    resolveQueuedFollowUpDispatchOptions,
  };
}
