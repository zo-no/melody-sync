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
  });
  const filtered = folder
    ? sessionList.filter((session) => session.folder === folder)
    : sessionList;
  const archivedSessions = filtered.filter((session) => {
    // Persistent sessions are never "completed" — always active
    const persistentKind = String(session?.persistent?.kind || '').trim().toLowerCase();
    if (persistentKind === 'skill' || persistentKind === 'recurring_task' || persistentKind === 'scheduled_task' || persistentKind === 'waiting_task') return false;
    if (session?.archived === true) return true;
    const wf = String(session?.workflowState || '').trim().toLowerCase();
    return wf === 'done' || wf === 'complete' || wf === 'completed';
  });
  const activeSessions = filtered.filter((session) => {
    // Persistent sessions are always active
    const persistentKind = String(session?.persistent?.kind || '').trim().toLowerCase();
    if (persistentKind === 'skill' || persistentKind === 'recurring_task' || persistentKind === 'scheduled_task' || persistentKind === 'waiting_task') return true;
    if (session?.archived === true) return false;
    const wf = String(session?.workflowState || '').trim().toLowerCase();
    return wf !== 'done' && wf !== 'complete' && wf !== 'completed';
  });
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
