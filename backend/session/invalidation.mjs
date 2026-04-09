import { getClientsMatching, broadcastOwners } from '../ws-clients.mjs';

import { findSessionMetaCached } from './meta-store.mjs';
import { shouldExposeSession } from './visibility.mjs';

function sendToClients(clients, msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {}
  }
}

export function broadcastSessionsInvalidation() {
  broadcastOwners({ type: 'sessions_invalidated' });
}

export function broadcastSessionInvalidation(sessionId) {
  const session = findSessionMetaCached(sessionId);
  const clients = getClientsMatching((client) => {
    const authSession = client._authSession;
    if (!authSession) return false;
    return authSession.role === 'owner' && shouldExposeSession(session);
  });
  sendToClients(clients, { type: 'session_invalidated', sessionId });
}
