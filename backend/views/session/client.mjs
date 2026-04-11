import { createHash } from 'crypto';
import { createSessionDetail as createClientSessionDetail, createSessionListItem as createClientSessionListItem } from '../../session/api-shapes.mjs';

export { createClientSessionDetail, createClientSessionListItem };

export function createClientSessionSummaryPayload(session) {
  return { session };
}

export function createClientSessionSummaryEtag(session) {
  return `"${createHash('sha1')
    .update(JSON.stringify(createClientSessionSummaryPayload(session)))
    .digest('hex')}"`;
}

export function createClientSessionSummaryRef(session) {
  const projected = createClientSessionListItem(session);
  return {
    id: projected?.id,
    summaryEtag: createClientSessionSummaryEtag(projected),
  };
}
