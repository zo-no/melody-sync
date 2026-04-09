import { SERVICE_BUILD_INFO } from '../../services/system/page-build-service.mjs';

export function serializeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildTemplateReplacements(buildInfo) {
  return {
    ASSET_VERSION: buildInfo.assetVersion,
    BUILD_LABEL: buildInfo.label,
    BUILD_TITLE: buildInfo.title,
    BUILD_JSON: serializeJsonForScript(buildInfo),
  };
}

export function renderPageTemplate(template, nonce, replacements = {}) {
  const merged = {
    NONCE: nonce,
    ASSET_VERSION: SERVICE_BUILD_INFO.assetVersion,
    BUILD_LABEL: SERVICE_BUILD_INFO.label,
    BUILD_TITLE: SERVICE_BUILD_INFO.title,
    BUILD_JSON: serializeJsonForScript(SERVICE_BUILD_INFO),
    PAGE_TITLE: 'MelodySync Chat',
    PAGE_HEAD_TAGS: '',
    BODY_CLASS: '',
    BOOTSTRAP_JSON: serializeJsonForScript({ auth: null }),
    EXTRA_BOOTSTRAP_SCRIPTS: '',
    ...replacements,
  };
  if (!Object.prototype.hasOwnProperty.call(replacements, 'BOOTSTRAP_SCRIPT_TAGS')) {
    merged.BOOTSTRAP_SCRIPT_TAGS = [
      `<script nonce="${merged.NONCE}">window.__MELODYSYNC_BUILD__ = ${merged.BUILD_JSON};</script>`,
      `<script nonce="${merged.NONCE}">window.__MELODYSYNC_BOOTSTRAP__ = ${merged.BOOTSTRAP_JSON};</script>`,
    ].join('\n');
  }
  return Object.entries(merged).reduce(
    (output, [key, value]) => output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => String(value ?? '')),
    template,
  );
}
