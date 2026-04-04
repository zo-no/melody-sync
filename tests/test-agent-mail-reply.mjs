#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-agent-mail-reply-'));
process.env.HOME = tempHome;

const mailboxRoot = join(tempHome, '.config', 'remotelab', 'agent-mailbox');
const workspace = join(tempHome, 'workspace');
mkdirSync(workspace, { recursive: true });

const {
  findQueueItem,
  initializeMailbox,
  ingestRawMessage,
  approveMessage,
  saveOutboundConfig,
} = await import(pathToFileURL(join(repoRoot, 'lib', 'agent-mailbox.mjs')).href);
const { createSession } = await import(pathToFileURL(join(repoRoot, 'backend', 'session-manager.mjs')).href);
const { appendEvent } = await import(pathToFileURL(join(repoRoot, 'backend', 'history.mjs')).href);
const { messageEvent } = await import(pathToFileURL(join(repoRoot, 'backend', 'normalizer.mjs')).href);
const { createRun } = await import(pathToFileURL(join(repoRoot, 'backend', 'runs.mjs')).href);
const { dispatchSessionEmailCompletionTargets } = await import(pathToFileURL(join(repoRoot, 'lib', 'agent-mail-completion-targets.mjs')).href);

try {
  initializeMailbox({
    rootDir: mailboxRoot,
    name: 'Rowan',
    localPart: 'rowan',
    domain: 'example.com',
    allowEmails: ['owner@example.com'],
  });

  saveOutboundConfig(mailboxRoot, {
    provider: 'apple_mail',
    account: 'Google',
  });

  const ingestedAppleMail = ingestRawMessage(
    [
      'From: owner@example.com',
      'To: rowan@example.com',
      'Subject: hello from apple mail!',
      'Date: Tue, 10 Mar 2026 02:00:00 +0800',
      'Message-ID: <mail-apple-test@example.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'please test the Mail app sender!',
    ].join('\n'),
    'apple-mail-test.eml',
    mailboxRoot,
    { text: 'please test the Mail app sender!' },
  );

  const approvedAppleMail = approveMessage(ingestedAppleMail.id, mailboxRoot, 'tester');
  const appleRequestId = `mailbox_reply_${approvedAppleMail.id}`;
  const appleSession = await createSession(workspace, 'codex', 'Mail app reply test', {
    completionTargets: [{
      type: 'email',
      requestId: appleRequestId,
      to: 'owner@example.com',
      subject: 'Re: hello from apple mail!',
      mailboxRoot,
      mailboxItemId: approvedAppleMail.id,
    }],
  });
  const appleRun = await createRun({
    status: {
      sessionId: appleSession.id,
      requestId: appleRequestId,
      state: 'completed',
      tool: 'codex',
    },
    manifest: {
      sessionId: appleSession.id,
      requestId: appleRequestId,
      folder: workspace,
      tool: 'codex',
      prompt: 'reply to the email via Mail app',
      options: {},
    },
  });

  await appendEvent(appleSession.id, messageEvent('assistant', 'Received — Mail.app test successful.', undefined, {
    runId: appleRun.id,
    requestId: appleRequestId,
  }));

  const appleDeliveries = await dispatchSessionEmailCompletionTargets(appleSession, appleRun, {
    sendAppleMailMessageImpl: async (message) => ({
      sender: `${message.account || 'Google'} <owner@example.com>`,
    }),
  });
  assert.equal(appleDeliveries.length, 1);
  assert.equal(appleDeliveries[0].state, 'sent');

  const updatedAppleMail = findQueueItem(approvedAppleMail.id, mailboxRoot)?.item;
  assert.equal(updatedAppleMail?.status, 'reply_sent');
  assert.equal(updatedAppleMail?.automation?.status, 'reply_sent');
  assert.equal(updatedAppleMail?.automation?.runId, appleRun.id);
  assert.equal(updatedAppleMail?.automation?.delivery?.provider, 'apple_mail');

  const ingestedBlankSubject = ingestRawMessage(
    [
      'From: owner@example.com',
      'To: rowan@example.com',
      'Date: Tue, 10 Mar 2026 03:05:00 +0800',
      'Message-ID: <mail-blank-subject@example.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'please preserve the empty subject when replying.',
    ].join('\n'),
    'apple-mail-blank-subject.eml',
    mailboxRoot,
    { text: 'please preserve the empty subject when replying.' },
  );

  const approvedBlankSubject = approveMessage(ingestedBlankSubject.id, mailboxRoot, 'tester');
  const blankSubjectRequestId = `mailbox_reply_${approvedBlankSubject.id}`;
  const blankSubjectSession = await createSession(workspace, 'codex', 'Mail app blank subject reply test', {
    completionTargets: [{
      type: 'email',
      requestId: blankSubjectRequestId,
      to: 'owner@example.com',
      subject: '',
      inReplyTo: '<mail-blank-subject@example.com>',
      references: '<mail-blank-subject@example.com>',
      mailboxRoot,
      mailboxItemId: approvedBlankSubject.id,
    }],
  });
  const blankSubjectRun = await createRun({
    status: {
      sessionId: blankSubjectSession.id,
      requestId: blankSubjectRequestId,
      state: 'completed',
      tool: 'codex',
    },
    manifest: {
      sessionId: blankSubjectSession.id,
      requestId: blankSubjectRequestId,
      folder: workspace,
      tool: 'codex',
      prompt: 'reply to the blank-subject email via Mail app',
      options: {},
    },
  });

  await appendEvent(blankSubjectSession.id, messageEvent('assistant', 'Blank subject reply successful.', undefined, {
    runId: blankSubjectRun.id,
    requestId: blankSubjectRequestId,
  }));

  const blankSubjectDeliveries = await dispatchSessionEmailCompletionTargets(blankSubjectSession, blankSubjectRun, {
    sendAppleMailMessageImpl: async () => ({ sender: 'owner@example.com' }),
  });
  assert.equal(blankSubjectDeliveries.length, 1);
  assert.equal(blankSubjectDeliveries[0].state, 'sent');

  const updatedBlankSubject = findQueueItem(approvedBlankSubject.id, mailboxRoot)?.item;
  assert.equal(updatedBlankSubject?.status, 'reply_sent');
  assert.equal(updatedBlankSubject?.automation?.delivery?.provider, 'apple_mail');

  const ingestedRetry = ingestRawMessage(
    [
      'From: owner@example.com',
      'To: rowan@example.com',
      'Subject: clear retry error state',
      'Date: Tue, 10 Mar 2026 03:15:00 +0800',
      'Message-ID: <mail-retry-clear@example.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'please verify that a later success clears the prior failure state.',
    ].join('\n'),
    'apple-mail-retry-clear.eml',
    mailboxRoot,
    { text: 'please verify that a later success clears the prior failure state.' },
  );

  const approvedRetry = approveMessage(ingestedRetry.id, mailboxRoot, 'tester');
  const retryRequestId = `mailbox_reply_${approvedRetry.id}`;
  const retrySession = await createSession(workspace, 'codex', 'Mail app retry clear test', {
    completionTargets: [{
      type: 'email',
      requestId: retryRequestId,
      to: 'owner@example.com',
      subject: 'Re: clear retry error state',
      inReplyTo: '<mail-retry-clear@example.com>',
      references: '<mail-retry-clear@example.com>',
      mailboxRoot,
      mailboxItemId: approvedRetry.id,
    }],
  });
  const retryRun = await createRun({
    status: {
      sessionId: retrySession.id,
      requestId: retryRequestId,
      state: 'completed',
      tool: 'codex',
    },
    manifest: {
      sessionId: retrySession.id,
      requestId: retryRequestId,
      folder: workspace,
      tool: 'codex',
      prompt: 'reply to the email, fail once, then succeed',
      options: {},
    },
  });

  await appendEvent(retrySession.id, messageEvent('assistant', 'Retry-success reply body.', undefined, {
    runId: retryRun.id,
    requestId: retryRequestId,
  }));

  const forcedFailureDeliveries = await dispatchSessionEmailCompletionTargets(retrySession, retryRun, {
    sendAppleMailMessageImpl: async () => {
      throw new Error('Mail.app send failed');
    },
  });
  assert.equal(forcedFailureDeliveries.length, 1);
  assert.equal(forcedFailureDeliveries[0].state, 'failed');

  const failedRetryItem = findQueueItem(approvedRetry.id, mailboxRoot)?.item;
  assert.equal(failedRetryItem?.status, 'reply_failed');
  assert.equal(failedRetryItem?.automation?.status, 'reply_failed');
  assert.equal(failedRetryItem?.automation?.lastError, 'Mail.app send failed');

  const successfulRetryDeliveries = await dispatchSessionEmailCompletionTargets(retrySession, retryRun, {
    sendAppleMailMessageImpl: async () => ({ sender: 'owner@example.com' }),
  });
  assert.equal(successfulRetryDeliveries.length, 1);
  assert.equal(successfulRetryDeliveries[0].state, 'sent');

  const updatedRetryItem = findQueueItem(approvedRetry.id, mailboxRoot)?.item;
  assert.equal(updatedRetryItem?.status, 'reply_sent');
  assert.equal(updatedRetryItem?.automation?.status, 'reply_sent');
  assert.equal(updatedRetryItem?.automation?.lastError, null);
  assert.equal(updatedRetryItem?.automation?.delivery?.provider, 'apple_mail');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('agent mail reply tests passed');
