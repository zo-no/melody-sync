import { readBody } from '../../../lib/utils.mjs';

export async function readJsonRequestBody(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  return raw ? JSON.parse(raw) : {};
}
