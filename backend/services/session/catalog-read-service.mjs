import {
  getSessionForClient,
  getSessionListItemForClient,
  listSessionListItemsForClient,
} from './client-session-service.mjs';
import { createClientSessionSummaryRef } from '../../views/session/client.mjs';

export async function getSessionCatalogListForClient({
  sourceId = '',
  folder = '',
  archivedOnly = false,
  refsOnly = false,
} = {}) {
  const sessionList = await listSessionListItemsForClient({
    includeArchived: true,
    sourceId,
    taskListVisibility: 'primary',
  });
  const filtered = folder
    ? sessionList.filter((session) => session.folder === folder)
    : sessionList;
  const archivedSessions = filtered.filter((session) => session?.archived === true);
  const activeSessions = filtered.filter((session) => session?.archived !== true);
  const targetSessions = archivedOnly ? archivedSessions : activeSessions;
  if (refsOnly) {
    return {
      sessionRefs: targetSessions.map(createClientSessionSummaryRef).filter((ref) => ref?.id),
      archivedCount: archivedSessions.length,
    };
  }
  return {
    sessions: targetSessions,
    archivedCount: archivedSessions.length,
  };
}

export async function getSessionCatalogDetailForClient(sessionId, { summaryOnly = false } = {}) {
  return summaryOnly
    ? getSessionListItemForClient(sessionId)
    : getSessionForClient(sessionId, { includeQueuedMessages: true });
}
