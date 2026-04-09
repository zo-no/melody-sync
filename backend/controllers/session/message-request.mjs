import { readBody } from '../../lib/utils.mjs';

const MESSAGE_SUBMISSION_MAX_BYTES = 256 * 1024 * 1024;

function bodyTooLargeError() {
  return Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' });
}

function getMultipartBodyLength(req) {
  const rawLength = Array.isArray(req.headers['content-length'])
    ? req.headers['content-length'][0]
    : req.headers['content-length'];
  const parsedLength = Number.parseInt(rawLength || '', 10);
  return Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : null;
}

function parseFormString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseFormJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function readSessionMessagePayload(req, pathname) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    const body = await readBody(req, MESSAGE_SUBMISSION_MAX_BYTES);
    return JSON.parse(body);
  }

  const contentLength = getMultipartBodyLength(req);
  if (contentLength !== null && contentLength > MESSAGE_SUBMISSION_MAX_BYTES) {
    throw bodyTooLargeError();
  }

  const formRequest = new Request(`http://127.0.0.1${pathname}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  const formData = await formRequest.formData();
  const images = [];
  for (const entry of formData.getAll('images')) {
    if (!entry || typeof entry.arrayBuffer !== 'function') continue;
    images.push({
      buffer: Buffer.from(await entry.arrayBuffer()),
      mimeType: typeof entry.type === 'string' ? entry.type : '',
      originalName: typeof entry.name === 'string' ? entry.name : '',
    });
  }
  const existingImages = parseFormJson(parseFormString(formData.get('existingImages')), []);
  if (Array.isArray(existingImages)) {
    for (const image of existingImages) {
      if (!image || typeof image !== 'object') continue;
      if (typeof image.filename !== 'string' || !image.filename.trim()) continue;
      images.push({
        filename: image.filename.trim(),
        originalName: parseFormString(image.originalName),
        mimeType: parseFormString(image.mimeType),
      });
    }
  }
  const externalAssets = parseFormJson(parseFormString(formData.get('externalAssets')), []);
  if (Array.isArray(externalAssets)) {
    for (const asset of externalAssets) {
      if (!asset || typeof asset !== 'object') continue;
      if (typeof asset.assetId !== 'string' || !asset.assetId.trim()) continue;
      images.push({
        assetId: asset.assetId.trim(),
        originalName: parseFormString(asset.originalName),
        mimeType: parseFormString(asset.mimeType),
      });
    }
  }

  return {
    requestId: parseFormString(formData.get('requestId')),
    text: parseFormString(formData.get('text')),
    tool: parseFormString(formData.get('tool')),
    model: parseFormString(formData.get('model')),
    effort: parseFormString(formData.get('effort')),
    thinking: parseFormString(formData.get('thinking')) === 'true',
    sourceContext: parseFormJson(parseFormString(formData.get('sourceContext')), null),
    images,
  };
}
