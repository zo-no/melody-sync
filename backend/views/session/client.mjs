import { createHash } from 'crypto';
import { createSessionDetail, createSessionListItem } from '../../session/api-shapes.mjs';

export function createClientSessionDetail(session) {
  return createSessionDetail(session);
}

export function createClientSessionListItem(session) {
  return createSessionListItem(session);
}

export function createClientSessionSummaryPayload(session) {
  return { session: createClientSessionListItem(session) };
}

export function createClientSessionSummaryEtag(session) {
  return createHash('sha1')
    .update(JSON.stringify(createClientSessionSummaryPayload(session)))
    .digest('base64url');
}

export function createClientSessionSummaryRef(session) {
  const projected = createClientSessionListItem(session);
  return {
    id: projected?.id,
    summaryEtag: createClientSessionSummaryEtag(projected),
  };
}
