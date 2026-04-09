import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'zlib';
import { createHash } from 'crypto';

const DEFAULT_COMPRESSIBLE_CONTENT_TYPES = [
  'application/javascript',
  'application/json',
  'application/manifest+json',
  'application/xml',
  'image/svg+xml',
];

const DEFAULT_MIN_COMPRESSIBLE_RESPONSE_BYTES = 1024;
const DEFAULT_MAX_COMPRESSED_RESPONSE_CACHE_ENTRIES = 256;
const DEFAULT_BROTLI_COMPRESSION_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
  },
};
const DEFAULT_GZIP_COMPRESSION_OPTIONS = { level: 6 };

function normalizeContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function isCompressibleContentType(contentType, compressibleContentTypes) {
  const normalized = normalizeContentType(contentType);
  return normalized.startsWith('text/') || compressibleContentTypes.includes(normalized);
}

function appendVaryValue(currentValue, nextToken) {
  const currentTokens = String(currentValue || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (currentTokens.some((token) => token.toLowerCase() === nextToken.toLowerCase())) {
    return currentTokens.join(', ');
  }
  currentTokens.push(nextToken);
  return currentTokens.join(', ');
}

function parseAcceptEncodingHeader(value) {
  const weights = new Map();
  for (const part of String(value || '').split(',')) {
    const [namePart, ...parameterParts] = part.split(';');
    const name = namePart.trim().toLowerCase();
    if (!name) continue;
    let weight = 1;
    for (const parameter of parameterParts) {
      const [key, rawValue] = parameter.split('=');
      if (key?.trim().toLowerCase() !== 'q') continue;
      const parsedValue = Number.parseFloat(String(rawValue || '').trim());
      if (Number.isFinite(parsedValue)) {
        weight = Math.max(0, Math.min(1, parsedValue));
      }
    }
    weights.set(name, weight);
  }
  return weights;
}

function getAcceptedEncodingWeight(weights, name) {
  if (weights.has(name)) return weights.get(name) || 0;
  if (weights.has('*')) return weights.get('*') || 0;
  return 0;
}

function createEtag(value) {
  return `"${createHash('sha1').update(value).digest('hex')}"`;
}

function normalizeEtag(value) {
  return String(value || '').trim().replace(/^W\//, '');
}

function requestHasFreshEtag(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  const candidates = String(header)
    .split(',')
    .map((value) => normalizeEtag(value))
    .filter(Boolean);
  if (candidates.includes('*')) return true;
  return candidates.includes(normalizeEtag(etag));
}

function createJsonBody(value) {
  return JSON.stringify(value);
}

export function createResponseCacheHelpers({
  defaultHeaders = {},
  compressibleContentTypes = DEFAULT_COMPRESSIBLE_CONTENT_TYPES,
  minCompressibleResponseBytes = DEFAULT_MIN_COMPRESSIBLE_RESPONSE_BYTES,
  maxCompressedResponseCacheEntries = DEFAULT_MAX_COMPRESSED_RESPONSE_CACHE_ENTRIES,
  brotliCompressionOptions = DEFAULT_BROTLI_COMPRESSION_OPTIONS,
  gzipCompressionOptions = DEFAULT_GZIP_COMPRESSION_OPTIONS,
} = {}) {
  const compressedResponseCache = new Map();

  function selectCompressionEncoding(req, contentType, body) {
    if (!isCompressibleContentType(contentType, compressibleContentTypes)) return null;
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
    if (bodyBuffer.length < minCompressibleResponseBytes) return null;
    const acceptedEncodings = parseAcceptEncodingHeader(req.headers['accept-encoding']);
    const brotliWeight = getAcceptedEncodingWeight(acceptedEncodings, 'br');
    const gzipWeight = getAcceptedEncodingWeight(acceptedEncodings, 'gzip');
    if (brotliWeight <= 0 && gzipWeight <= 0) return null;
    return brotliWeight >= gzipWeight ? 'br' : 'gzip';
  }

  function getCompressedResponseBody(body, encoding) {
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
    const cacheKey = `${encoding}:${createEtag(bodyBuffer)}`;
    const cached = compressedResponseCache.get(cacheKey);
    if (cached) {
      compressedResponseCache.delete(cacheKey);
      compressedResponseCache.set(cacheKey, cached);
      return cached;
    }

    const compressedBody = encoding === 'br'
      ? brotliCompressSync(bodyBuffer, brotliCompressionOptions)
      : gzipSync(bodyBuffer, gzipCompressionOptions);
    compressedResponseCache.set(cacheKey, compressedBody);
    while (compressedResponseCache.size > maxCompressedResponseCacheEntries) {
      const oldestKey = compressedResponseCache.keys().next().value;
      if (!oldestKey) break;
      compressedResponseCache.delete(oldestKey);
    }
    return compressedBody;
  }

  function prepareResponseBody(req, {
    contentType,
    body,
    vary,
    allowCompression = false,
  } = {}) {
    const responseBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
    let responseVary = vary;
    if (!allowCompression || !isCompressibleContentType(contentType, compressibleContentTypes)) {
      return {
        body: responseBody,
        headers: {},
        vary: responseVary,
      };
    }

    responseVary = appendVaryValue(responseVary, 'Accept-Encoding');
    const encoding = selectCompressionEncoding(req, contentType, responseBody);
    if (!encoding) {
      return {
        body: responseBody,
        headers: {},
        vary: responseVary,
      };
    }

    return {
      body: getCompressedResponseBody(responseBody, encoding),
      headers: { 'Content-Encoding': encoding },
      vary: responseVary,
    };
  }

  function writeCachedResponse(req, res, {
    statusCode = 200,
    contentType,
    body,
    cacheControl,
    vary,
    allowCompression = false,
    headers: extraHeaders = {},
  } = {}) {
    const preparedResponse = prepareResponseBody(req, {
      contentType,
      body,
      vary,
      allowCompression,
    });
    const etag = createEtag(preparedResponse.body);
    const headers = {
      'Cache-Control': cacheControl,
      ETag: etag,
      ...defaultHeaders,
      ...preparedResponse.headers,
      ...extraHeaders,
    };
    if (preparedResponse.vary) headers.Vary = preparedResponse.vary;

    if (requestHasFreshEtag(req, etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    if (contentType) headers['Content-Type'] = contentType;
    res.writeHead(statusCode, headers);
    res.end(preparedResponse.body);
  }

  function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      ...defaultHeaders,
    });
    res.end(JSON.stringify(payload));
  }

  function createWriteJsonWriter(req) {
    return function writeJsonForReq(
      res,
      statusCode,
      payload,
      {
        cacheControl = 'private, no-store, max-age=0, must-revalidate',
        vary = 'Cookie',
        headers = {},
      } = {},
    ) {
      writeCachedResponse(req, res, {
        statusCode,
        contentType: 'application/json',
        body: createJsonBody(payload),
        cacheControl,
        vary,
        allowCompression: true,
        headers,
      });
    };
  }

  function writeJsonCached(req, res, payload, {
    statusCode = 200,
    cacheControl = 'private, no-cache',
    vary = 'Cookie',
    headers,
  } = {}) {
    writeCachedResponse(req, res, {
      statusCode,
      contentType: 'application/json',
      body: createJsonBody(payload),
      cacheControl,
      vary,
      allowCompression: true,
      headers,
    });
  }

  function writeFileCached(req, res, contentType, body, {
    cacheControl = 'public, no-cache',
    vary,
    allowCompression = true,
  } = {}) {
    writeCachedResponse(req, res, {
      statusCode: 200,
      contentType,
      body,
      cacheControl,
      vary,
      allowCompression,
    });
  }

  return {
    prepareResponseBody,
    writeJson,
    createWriteJsonWriter,
    writeJsonCached,
    writeFileCached,
  };
}
