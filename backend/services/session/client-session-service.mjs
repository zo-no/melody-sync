import { getSession, listSessions } from '../../session/manager.mjs';
import {
  createClientSessionDetail,
  createClientSessionListItem,
} from '../../views/session/client.mjs';

export async function listSessionsForClient(options = {}) {
  const sessions = await listSessions(options);
  return sessions.map(createClientSessionDetail);
}

export async function listSessionListItemsForClient(options = {}) {
  const sessions = await listSessions(options);
  return sessions.map(createClientSessionListItem);
}

export async function getSessionForClient(id, options = {}) {
  return createClientSessionDetail(await getSession(id, options));
}

export async function getSessionListItemForClient(id, options = {}) {
  return createClientSessionListItem(await getSession(id, options));
}
