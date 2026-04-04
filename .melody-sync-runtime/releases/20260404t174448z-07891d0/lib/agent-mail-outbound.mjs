import { spawnSync } from 'child_process';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => trimString(entry)).filter(Boolean);
  }
  const single = trimString(value);
  return single ? [single] : [];
}

function configuredAuthMode(config = {}) {
  return firstNonEmpty(config.provider, 'apple_mail').toLowerCase() === 'apple_mail'
    ? 'mail_app'
    : 'unconfigured';
}

export function summarizeOutboundConfig(config = {}) {
  return {
    provider: 'apple_mail',
    account: trimString(config.account),
    from: trimString(config.from),
    authMode: configuredAuthMode(config),
    configured: true,
  };
}

function prepareAppleMailConfig(config = {}, message = {}) {
  const to = normalizeRecipients(message.to);
  const subject = trimString(message.subject);
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const allowEmptySubject = Boolean(trimString(message.inReplyTo) || trimString(message.references));

  if (to.length === 0) {
    throw new Error('Outbound email requires at least one recipient');
  }
  if (!subject && !allowEmptySubject) {
    throw new Error('Outbound email requires a subject');
  }
  if (!text) {
    throw new Error('Outbound email requires a text body');
  }

  return {
    provider: 'apple_mail',
    account: trimString(config.account),
    from: '',
    to,
    subject,
    text,
  };
}

function sendAppleMailMessage(prepared, options = {}) {
  if (typeof options.sendAppleMailMessageImpl === 'function') {
    return options.sendAppleMailMessageImpl(prepared);
  }

  const script = [
    'set recipientText to system attribute "REMOTELAB_MAIL_TO"',
    'set subjectText to system attribute "REMOTELAB_MAIL_SUBJECT"',
    'set bodyText to system attribute "REMOTELAB_MAIL_TEXT"',
    'set desiredAccount to system attribute "REMOTELAB_MAIL_ACCOUNT"',
    'set desiredSender to system attribute "REMOTELAB_MAIL_SENDER"',
    'set recipientList to paragraphs of recipientText',
    'tell application "Mail"',
    '  set availableAccounts to every account',
    '  if (count of availableAccounts) is 0 then error "No Mail accounts are configured"',
    '  set selectedAccount to item 1 of availableAccounts',
    '  if desiredAccount is not "" then',
    '    set accountFound to false',
    '    repeat with currentAccount in availableAccounts',
    '      if ((name of currentAccount as text) is desiredAccount) or ((user name of currentAccount as text) is desiredAccount) then',
    '        set selectedAccount to currentAccount',
    '        set accountFound to true',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if accountFound is false then error "Mail account not found: " & desiredAccount',
    '  end if',
    '  set resolvedSender to desiredSender',
    '  if resolvedSender is "" then',
    '    try',
    '      set accountAddresses to email addresses of selectedAccount',
    '      if (count of accountAddresses) > 0 then set resolvedSender to item 1 of accountAddresses',
    '    end try',
    '  end if',
    '  if resolvedSender is "" then set resolvedSender to user name of selectedAccount',
    '  set outgoingMessage to make new outgoing message with properties {subject:subjectText, content:bodyText & return & return, visible:false}',
    '  tell outgoingMessage',
    '    repeat with recipientAddress in recipientList',
    '      if (recipientAddress as text) is not "" then',
    '        make new to recipient at end of to recipients with properties {address:recipientAddress as text}',
    '      end if',
    '    end repeat',
    '    if resolvedSender is not "" then set sender to resolvedSender',
    '    send',
    '  end tell',
    '  return resolvedSender',
    'end tell',
  ].join('\n');

  const result = spawnSync('osascript', ['-'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      REMOTELAB_MAIL_TO: prepared.to.join('\n'),
      REMOTELAB_MAIL_SUBJECT: prepared.subject,
      REMOTELAB_MAIL_TEXT: prepared.text,
      REMOTELAB_MAIL_ACCOUNT: prepared.account,
      REMOTELAB_MAIL_SENDER: prepared.from,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(trimString(result.stderr) || trimString(result.stdout) || `Mail.app send failed (${result.status})`);
  }

  return {
    sender: trimString(result.stdout),
  };
}

export async function sendOutboundEmail(message, config = {}, options = {}) {
  const provider = firstNonEmpty(config.provider, 'apple_mail').toLowerCase();
  if (provider !== 'apple_mail') {
    throw new Error(`Unsupported outbound email provider: ${provider}`);
  }

  const prepared = prepareAppleMailConfig(config, message);
  const response = await sendAppleMailMessage(prepared, options);
  return {
    provider: 'apple_mail',
    statusCode: 202,
    response: {
      message: 'queued in Mail.app',
      sender: trimString(response?.sender),
    },
    summary: {
      message: trimString(response?.sender)
        ? `queued in Mail.app via ${trimString(response.sender)}`
        : 'queued in Mail.app',
    },
  };
}
