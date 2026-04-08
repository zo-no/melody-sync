import { buildMelodySyncPaths } from '../../lib/config.mjs';
import {
  getMailboxStatus,
  loadAllowlist,
  loadIdentity,
  loadMailboxAutomation,
  loadOutboundConfig,
  mailboxPaths,
  normalizeInstanceAddressMode,
  saveAllowlist,
  saveMailboxAutomation,
  saveMailboxIdentity,
  saveOutboundConfig,
} from '../../lib/agent-mailbox.mjs';
import { ensureDir } from '../fs-utils.mjs';
import { readGeneralSettings } from './general-store.mjs';

const EMAIL_PROVIDER_OPTIONS = Object.freeze([
  { value: 'apple_mail', label: 'Apple Mail' },
]);

const DELIVERY_MODE_OPTIONS = Object.freeze([
  { value: 'reply_email', label: '直接回信' },
  { value: 'session_only', label: '仅生成会话' },
]);

const INSTANCE_ADDRESS_MODE_OPTIONS = Object.freeze([
  { value: 'plus', label: 'plus 地址' },
  { value: 'local_part', label: '本地地址' },
]);

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => trimString(value))
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

function normalizeIdentityPatch(value = {}) {
  return {
    ...(Object.prototype.hasOwnProperty.call(value, 'name') ? { name: trimString(value.name) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'localPart') ? { localPart: trimString(value.localPart) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'domain') ? { domain: trimString(value.domain) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'description') ? { description: trimString(value.description) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'instanceAddressMode')
      ? { instanceAddressMode: normalizeInstanceAddressMode(value.instanceAddressMode) }
      : {}),
  };
}

function normalizeOutboundPatch(value = {}, current = {}) {
  const requestedProvider = trimString(value.provider).toLowerCase();
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(value, 'provider')
      ? { provider: requestedProvider === 'apple_mail' ? 'apple_mail' : 'apple_mail' }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'account') ? { account: trimString(value.account) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'from') ? { from: trimString(value.from) } : {}),
  };
}

function normalizeAutomationPatch(value = {}, current = {}) {
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(value, 'enabled') ? { enabled: value.enabled === true } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'allowlistAutoApprove')
      ? { allowlistAutoApprove: value.allowlistAutoApprove === true }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'autoApproveReviewer')
      ? { autoApproveReviewer: trimString(value.autoApproveReviewer) || trimString(current.autoApproveReviewer) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'chatBaseUrl')
      ? { chatBaseUrl: trimString(value.chatBaseUrl) || trimString(current.chatBaseUrl) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'authFile')
      ? { authFile: trimString(value.authFile) || trimString(current.authFile) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'deliveryMode')
      ? { deliveryMode: trimString(value.deliveryMode) || trimString(current.deliveryMode) }
      : {}),
  };
}

async function resolveEmailSettingsContext() {
  const general = await readGeneralSettings();
  const paths = buildMelodySyncPaths({
    brainRoot: general.brainRoot || general.appRoot,
    runtimeRoot: general.runtimeRoot,
    machineConfigRoot: general.machineOverlayRoot,
    agentsFile: general.agentsPath,
  });
  await ensureDir(paths.emailDir);
  return {
    general,
    appPaths: paths,
    emailPaths: mailboxPaths(paths.emailDir),
  };
}

function buildEmailSettingsPayload({ general, appPaths, emailPaths }) {
  const identity = loadIdentity(appPaths.emailDir);
  const allowlist = loadAllowlist(appPaths.emailDir);
  const outbound = loadOutboundConfig(appPaths.emailDir);
  const automation = loadMailboxAutomation(appPaths.emailDir);
  return {
    appRoot: general.appRoot,
    emailRoot: appPaths.emailDir,
    paths: {
      emailRoot: appPaths.emailDir,
      identityFile: emailPaths.identityFile,
      allowlistFile: emailPaths.allowlistFile,
      outboundFile: emailPaths.outboundFile,
      automationFile: emailPaths.automationFile,
    },
    identity: identity || {
      name: '',
      localPart: '',
      domain: '',
      address: '',
      description: '',
      instanceAddressMode: 'plus',
    },
    allowlist,
    outbound: {
      provider: outbound.provider,
      account: outbound.account,
      from: outbound.from,
    },
    automation: {
      enabled: automation.enabled === true,
      allowlistAutoApprove: automation.allowlistAutoApprove === true,
      autoApproveReviewer: automation.autoApproveReviewer || '',
      chatBaseUrl: automation.chatBaseUrl || '',
      authFile: automation.authFile || '',
      deliveryMode: automation.deliveryMode || 'reply_email',
    },
    latest: {
      review: null,
      quarantine: null,
      approved: null,
    },
    counts: {
      review: 0,
      quarantine: 0,
      approved: 0,
    },
    options: {
      providers: EMAIL_PROVIDER_OPTIONS,
      deliveryModes: DELIVERY_MODE_OPTIONS,
      instanceAddressModes: INSTANCE_ADDRESS_MODE_OPTIONS,
    },
  };
}

export async function readEmailSettings() {
  const context = await resolveEmailSettingsContext();
  const payload = buildEmailSettingsPayload(context);
  const status = getMailboxStatus(context.appPaths.emailDir);
  return {
    ...payload,
    latest: {
      review: status.latest?.review || null,
      quarantine: status.latest?.quarantine || null,
      approved: status.latest?.approved || null,
    },
    counts: status.counts || payload.counts,
    effectiveStatus: status.effectiveStatus || '',
    publicIngress: status.publicIngress || '',
  };
}

export async function persistEmailSettings(payload = {}) {
  const context = await resolveEmailSettingsContext();
  const current = buildEmailSettingsPayload(context);
  const identityPatch = normalizeIdentityPatch(payload.identity || {});
  const hasIdentityPatch = Object.values(identityPatch).some(Boolean);
  if (hasIdentityPatch || current.identity?.address || current.identity?.name || current.identity?.localPart || current.identity?.domain) {
    saveMailboxIdentity(context.appPaths.emailDir, {
      ...current.identity,
      ...identityPatch,
    });
  }

  if (payload.allowlist && typeof payload.allowlist === 'object') {
    saveAllowlist(context.appPaths.emailDir, {
      allowedEmails: normalizeList(payload.allowlist.allowedEmails),
      allowedDomains: normalizeList(payload.allowlist.allowedDomains),
    });
  }

  if (payload.outbound && typeof payload.outbound === 'object') {
    saveOutboundConfig(
      context.appPaths.emailDir,
      normalizeOutboundPatch(payload.outbound, loadOutboundConfig(context.appPaths.emailDir)),
    );
  }

  if (payload.automation && typeof payload.automation === 'object') {
    saveMailboxAutomation(
      context.appPaths.emailDir,
      normalizeAutomationPatch(payload.automation, loadMailboxAutomation(context.appPaths.emailDir)),
    );
  }

  return readEmailSettings();
}
