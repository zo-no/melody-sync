import { createSessionDetail, createSessionListItem } from '../../session/api-shapes.mjs';

export function createClientSessionDetail(session) {
  return createSessionDetail(session);
}

export function createClientSessionListItem(session) {
  return createSessionListItem(session);
}
