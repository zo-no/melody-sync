import { readBody } from '../../../lib/utils.mjs';
import { readJsonRequestBody } from '../../shared/http/request-body.mjs';

function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export async function readSessionOrganizeRequest(req) {
  let payload = {};
  try {
    payload = await readJsonRequestBody(req, 8192);
  } catch {
    throw requestError('Invalid request body');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'tool') && payload.tool !== null && typeof payload.tool !== 'string') {
    throw requestError('tool must be a string when provided');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'model') && payload.model !== null && typeof payload.model !== 'string') {
    throw requestError('model must be a string when provided');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'effort') && payload.effort !== null && typeof payload.effort !== 'string') {
    throw requestError('effort must be a string when provided');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'thinking') && typeof payload.thinking !== 'boolean') {
    throw requestError('thinking must be a boolean when provided');
  }
  return payload;
}

export async function readSessionPersistentRequest(req) {
  try {
    return await readJsonRequestBody(req, 16384);
  } catch {
    throw requestError('Invalid request body');
  }
}

export async function readSessionDelegateRequest(req) {
  let payload = {};
  try {
    payload = await readJsonRequestBody(req, 32768);
  } catch {
    throw requestError('Invalid request body');
  }
  const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
  if (!task) throw requestError('task is required');
  if (Object.prototype.hasOwnProperty.call(payload, 'tool') && payload.tool !== null && typeof payload.tool !== 'string') {
    throw requestError('tool must be a string when provided');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'internal') && typeof payload.internal !== 'boolean') {
    throw requestError('internal must be a boolean when provided');
  }
  return payload;
}

export async function readCreateSessionRequest(req) {
  try {
    const body = await readBody(req, 10240);
    return JSON.parse(body);
  } catch (error) {
    throw requestError(
      error?.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Invalid request body',
      error?.code === 'BODY_TOO_LARGE' ? 413 : 400,
    );
  }
}
