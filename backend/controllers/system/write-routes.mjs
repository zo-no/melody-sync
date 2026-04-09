import { getAuthSession } from '../../../lib/auth.mjs';
import { saveUiRuntimeSelection } from '../../../lib/runtime-selection.mjs';
import { readBody } from '../../../lib/utils.mjs';

import { enqueueHostCompletionSpeech } from '../../completion-speech-queue.mjs';
import { playHostCompletionSound } from '../../completion-sound.mjs';
import { addSubscription } from '../../push.mjs';
import { readJsonRequestBody } from '../../shared/http/request-body.mjs';

function jsonError(writeJson, res, statusCode, message) {
  writeJson(res, statusCode, { error: message });
}

export async function handleSystemWriteRoutes({
  req,
  res,
  pathname,
  writeJson,
  getAuthSession: getAuthSessionImpl = getAuthSession,
  playHostCompletionSound: playHostCompletionSoundImpl = playHostCompletionSound,
} = {}) {
  if (pathname === '/api/runtime-selection' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonRequestBody(req, 4096);
    } catch (err) {
      jsonError(writeJson, res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, err.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request');
      return true;
    }
    try {
      const selection = await saveUiRuntimeSelection(body || {});
      writeJson(res, 200, { selection });
    } catch (error) {
      jsonError(writeJson, res, 400, error.message || 'Failed to save runtime selection');
    }
    return true;
  }

  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonRequestBody(req, 4096);
    } catch {
      jsonError(writeJson, res, 400, 'Bad request');
      return true;
    }
    try {
      const sub = body;
      if (!sub.endpoint) throw new Error('Missing endpoint');
      await addSubscription(sub);
      writeJson(res, 200, { ok: true });
    } catch {
      jsonError(writeJson, res, 400, 'Invalid subscription');
    }
    return true;
  }

  if (pathname === '/api/system/completion-sound' && req.method === 'POST') {
    const authSession = getAuthSessionImpl(req);
    if (authSession?.role !== 'owner') {
      jsonError(writeJson, res, 403, 'Owner access required');
      return true;
    }
    try {
      let body = '';
      try {
        body = await readBody(req, 4096);
      } catch {}
      const parsedBody = body ? JSON.parse(body) : {};
      const completionNoticeKey = typeof parsedBody?.completionNoticeKey === 'string'
        ? parsedBody.completionNoticeKey.trim()
        : '';
      const runId = typeof parsedBody?.runId === 'string'
        ? parsedBody.runId.trim()
        : '';
      const speechText = typeof parsedBody?.speechText === 'string'
        ? parsedBody.speechText
        : undefined;
      const completionVoiceProvider = typeof parsedBody?.completionTtsProvider === 'string'
        ? parsedBody.completionTtsProvider
        : undefined;
      const completionFallbackToSay = typeof parsedBody?.fallbackToSay === 'boolean'
        ? parsedBody.fallbackToSay
        : undefined;
      const voice = typeof parsedBody?.voice === 'string'
        ? parsedBody.voice
        : undefined;
      const rate = Number.isFinite(Number(parsedBody?.rate))
        ? Number(parsedBody.rate)
        : undefined;

      if (completionNoticeKey) {
        const queuedPath = await enqueueHostCompletionSpeech({
          speechText,
          voice,
          rate,
          completionNoticeKey,
          runId,
          completionTtsProvider: completionVoiceProvider,
          fallbackToSay: completionFallbackToSay,
        });
        writeJson(res, 200, {
          ok: true,
          mode: queuedPath ? 'host:queued' : 'host:deduped',
          soundPath: '',
          queue: !!queuedPath,
        });
        return true;
      }

      const playback = await playHostCompletionSoundImpl({
        speechText,
        voice,
        rate,
        completionTtsProvider: completionVoiceProvider,
        fallbackToSay: completionFallbackToSay,
      });
      writeJson(res, 200, {
        ok: true,
        mode: playback?.provider ? `host:${playback.provider}` : 'host',
        soundPath: playback?.soundPath || '',
      });
    } catch (error) {
      jsonError(writeJson, res, 500, error?.message || 'Failed to play host completion sound');
    }
    return true;
  }

  return false;
}
