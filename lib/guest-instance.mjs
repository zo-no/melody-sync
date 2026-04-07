export const DEFAULT_GUEST_INSTANCE_START_PORT = 7696;
export const DEFAULT_GUEST_SESSION_EXPIRY_DAYS = 30;
export const DEFAULT_GUEST_CHAT_BIND_HOST = '127.0.0.1';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function sanitizeGuestInstanceName(value) {
  return trimString(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pickNextGuestPort(usedPorts = [], { startPort = DEFAULT_GUEST_INSTANCE_START_PORT } = {}) {
  const normalizedStartPort = Number.parseInt(startPort, 10);
  if (!Number.isInteger(normalizedStartPort) || normalizedStartPort < 1 || normalizedStartPort > 65535) {
    throw new Error(`Invalid start port: ${startPort}`);
  }

  const reservedPorts = new Set(
    Array.from(usedPorts || [])
      .map((port) => Number.parseInt(port, 10))
      .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535),
  );

  for (let port = normalizedStartPort; port <= 65535; port += 1) {
    if (!reservedPorts.has(port)) {
      return port;
    }
  }

  throw new Error(`No free isolated-instance port available from ${normalizedStartPort}`);
}

export function buildGuestBootstrapText({ name, hostname = '' } = {}) {
  const lines = [
    '# Instance Bootstrap',
    '',
    `- Instance: \`${trimString(name) || 'guest'}\``,
    '- Purpose: isolated MelodySync workspace on the same machine.',
    '- Boundary: keep auth, memory, chat history, runs, and sessions inside this instance only.',
    '- Default: optimize for out-of-box use; do not assume access to the owner\'s main memory or config.',
  ];
  if (trimString(hostname)) {
    lines.push(`- Public hostname: \`${trimString(hostname)}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildLaunchAgentPlist({
  label,
  nodePath,
  chatServerPath,
  workingDirectory,
  standardOutPath,
  standardErrorPath,
  environmentVariables = {},
} = {}) {
  const normalizedLabel = trimString(label);
  const normalizedNodePath = trimString(nodePath);
  const normalizedChatServerPath = trimString(chatServerPath);
  const normalizedWorkingDirectory = trimString(workingDirectory);
  const normalizedStandardOutPath = trimString(standardOutPath);
  const normalizedStandardErrorPath = trimString(standardErrorPath);

  if (!normalizedLabel || !normalizedNodePath || !normalizedChatServerPath) {
    throw new Error('label, nodePath, and chatServerPath are required');
  }

  const envEntries = Object.entries(environmentVariables)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const envBlock = envEntries.map(([key, value]) => [
    '        <key>',
    xmlEscape(key),
    '</key>',
    '<string>',
    xmlEscape(value),
    '</string>',
  ].join('')).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '    <key>Label</key>',
    `    <string>${xmlEscape(normalizedLabel)}</string>`,
    '    <key>ProgramArguments</key>',
    '    <array>',
    `        <string>${xmlEscape(normalizedNodePath)}</string>`,
    `        <string>${xmlEscape(normalizedChatServerPath)}</string>`,
    '    </array>',
    '    <key>EnvironmentVariables</key>',
    '    <dict>',
    envBlock,
    '    </dict>',
    '    <key>RunAtLoad</key>',
    '    <true/>',
    '    <key>KeepAlive</key>',
    '    <true/>',
    '    <key>WorkingDirectory</key>',
    `    <string>${xmlEscape(normalizedWorkingDirectory)}</string>`,
    '    <key>StandardOutPath</key>',
    `    <string>${xmlEscape(normalizedStandardOutPath)}</string>`,
    '    <key>StandardErrorPath</key>',
    `    <string>${xmlEscape(normalizedStandardErrorPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}
