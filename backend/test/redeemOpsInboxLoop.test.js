/**
 * Email auto-send Phase C — the inbox loop
 * (docs/plans/redeem-ops-cadence-email-autosend.md §5/§8-C).
 *
 * Under test, all Google-mocked: the poll stamps lastSuccessfulPollAt (the
 * ONLY key that unlocks the Phase-B sender), replies on tracked threads exit
 * cadences + forward to the rep, bounces/unsubscribes write the FIRST
 * outreach_suppressions rows, merged partners are chased to the survivor,
 * cursor 404s re-baseline, unmatched persona mail is counted, and the
 * send-time no_email discovery now PARKS the enrollment (deferred P5).
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_CADENCES_ENABLED = 'true';
process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED = 'true';
process.env.OUTREACH_MAILBOX_ENCRYPTION_KEY = 'test-outreach-encryption-key-32chars!';

import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  OutreachAccount, OutreachPersona, OutreachEmail, OutreachTask,
  OutreachSuppression, OutreachCadenceEnrollment, OutreachActivity,
  PartnerOrganisation, sequelize,
} from '../src/models/index.js';
import { makeCadenceService } from '../src/services/redeemOps/cadenceService.js';
import { makeOutreachInboxService, extractPlainText } from '../src/services/redeemOps/outreachInboxService.js';
import { makeOutreachSenderService } from '../src/services/redeemOps/outreachSenderService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';
import { makeSecretBox } from '../src/utils/secretBox.js';
import { registerCadenceHooks, clearCadenceHooks } from '../src/services/redeemOps/cadenceHooks.js';

let admin, exec;
let account, persona;

const svc = makeCadenceService();
const partnerSvc = makePartnerService();
const claimSvc = makeClaimService();

const google = {
  history: { messages: [], historyId: '2000' },
  historyError: null,
  messagesById: {},
  profileHistoryId: '1000',
  sendRaw: jest.fn(async () => ({ id: 'fwd-1', threadId: 'fwd-th-1' })),
};
const mockClient = () => ({
  getProfile: async () => ({ emailAddress: 'business@mktr.sg', historyId: google.profileHistoryId }),
  listInboxHistory: async () => {
    if (google.historyError) { const e = new Error('history 404'); e.status = google.historyError; throw e; }
    return google.history;
  },
  getMessage: async (id) => google.messagesById[id] || null,
  sendRaw: google.sendRaw,
  getMessageHeaders: async () => ({ payload: { headers: [{ name: 'Message-ID', value: '<w@x>' }] } }),
  getThread: async () => ({ messages: [{ id: 'm', labelIds: ['SENT'] }] }),
  listMessages: async () => [],
});
const inbox = makeOutreachInboxService({ makeClient: mockClient });
const sender = makeOutreachSenderService({ makeClient: mockClient });

let phoneSeq = 83000000;
const nextPhone = () => `+65${phoneSeq++}`;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  registerCadenceHooks(svc.hookHandlers());
  const box = makeSecretBox('OUTREACH_MAILBOX_ENCRYPTION_KEY', 'outreach mailbox');
  account = await OutreachAccount.create({
    accountEmail: 'business@mktr.sg',
    encryptedCredentials: box.encrypt(JSON.stringify({
      type: 'service_account', client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
    })),
    historyCursor: '1500',
  });
  persona = await OutreachPersona.create({
    accountId: account.id, address: 'emily@redeem.sg', displayName: 'Emily Wong',
    assignedUserId: exec.user.id, sendAsRegistered: true, sendAsVerified: true,
    isAccountAlias: true,
  });
});

afterAll(async () => {
  clearCadenceHooks();
  await closeDb();
});

beforeEach(async () => {
  google.sendRaw.mockClear();
  google.history = { messages: [], historyId: '2000' };
  google.historyError = null;
  google.messagesById = {};
  await OutreachAccount.update(
    { historyCursor: '1500', lastSuccessfulPollAt: null, unmatchedInboxCount: 0 },
    { where: { id: account.id } }
  );
});

async function ownedPartner(name, patch = {}) {
  const { partner } = await partnerSvc.createPartner(
    { tradingName: name, primaryPhone: nextPhone(), primaryEmail: `${name.replace(/\W/g, '').toLowerCase()}@biz.sg` },
    admin.user
  );
  await claimSvc.claimPartner(partner.id, exec.user);
  if (Object.keys(patch).length) await partner.update(patch);
  return PartnerOrganisation.findByPk(partner.id);
}

let seq = 0;
async function trackedSend(partner, { threadId }) {
  seq += 1;
  const cadence = await svc.createCadence({
    name: `Inbox Cad ${seq}`,
    steps: [
      { channel: 'email', title: `Step A ${seq}`, mode: 'auto', subject: 'Idea for {{partner_name}}', script: 'Hi {{contact_name}}.', delayDays: 0, timeWindow: 'any' },
      { channel: 'email', title: `Step B ${seq}`, mode: 'auto', subject: 'Idea for {{partner_name}}', script: 'Bump.', delayDays: 3, timeWindow: 'any' },
    ],
  }, admin.user);
  const { enrollment, firstTask } = await svc.enrollPartner(partner.id, { cadenceId: cadence.id }, exec.user);
  const row = await OutreachEmail.findOne({ where: { taskId: firstTask.id } });
  await row.update({ status: 'sent', sentAt: new Date(), gmailThreadId: threadId, wireMessageId: `<w-${seq}@mail>` });
  await enrollment.update({ gmailThreadId: threadId, gmailThreadSubject: `Idea for ${partner.tradingName}` });
  return { cadence, enrollment, firstTask, row };
}

const inboundMsg = (id, { threadId, from, to = 'emily@redeem.sg', subject = 'Re: Idea', text = 'Sounds interesting, tell me more', mime = 'text/plain' }) => ({
  id, threadId, snippet: text.slice(0, 100),
  payload: {
    mimeType: mime,
    headers: [
      { name: 'From', value: from },
      { name: 'To', value: to },
      { name: 'Subject', value: subject },
    ],
    body: { data: Buffer.from(text, 'utf8').toString('base64url') },
  },
});

describe('the poll stamp (what unlocks the sender)', () => {
  test('a clean pass — even empty — stamps lastSuccessfulPollAt and advances the cursor', async () => {
    const [result] = await inbox.poll();
    expect(result.processed).toBe(0);
    const a = await OutreachAccount.findByPk(account.id);
    expect(a.lastSuccessfulPollAt).toBeTruthy();
    expect(a.historyCursor).toBe('2000');
  });

  test('a 404 cursor re-baselines from the profile and STILL stamps (the loop is alive)', async () => {
    google.historyError = 404;
    google.profileHistoryId = '9999';
    const [result] = await inbox.poll();
    expect(result.processed).toBe(0);
    const a = await OutreachAccount.findByPk(account.id);
    expect(a.historyCursor).toBe('9999');
    expect(a.lastSuccessfulPollAt).toBeTruthy();
  });

  test('a hard poll failure does NOT stamp — the sender stays gated', async () => {
    google.historyError = 500;
    await inbox.poll();
    const a = await OutreachAccount.findByPk(account.id);
    expect(a.lastSuccessfulPollAt).toBeNull();
    expect(a.lastError).toMatch(/poll/);
  });

  test('end to end: dark sender → poll → sender sends', async () => {
    const p = await ownedPartner('UnlockCafe');
    await partnerSvc.addContact(p.id, { name: 'Zul', email: 'zul@unlock.sg' }, exec.user);
    const cadence = await svc.createCadence({
      name: 'Unlock Cad',
      steps: [{ channel: 'email', title: 'Unlock step', mode: 'auto', subject: 'Hello {{partner_name}}', script: 'Hi {{contact_name}}.', delayDays: 0, timeWindow: 'any' }],
    }, admin.user);
    await sequelize.query('UPDATE outreach_cadences SET "autoSendApprovals" = 999 WHERE id = :id', { replacements: { id: cadence.id } });
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { taskId: firstTask.id } });

    expect((await sender.tick()).skipped).toBe('reply_loop_dark');
    await inbox.poll();
    const out = await sender.tick();
    expect(out.sent).toBe(1);
  });
});

describe('replies on tracked threads', () => {
  test('exits the cadence, cancels the NEXT queued step, forwards to the rep, audits', async () => {
    const p = await ownedPartner('ReplyCafe');
    const { enrollment } = await trackedSend(p, { threadId: 'th-reply-1' });
    google.history = { messages: [{ id: 'in-1' }], historyId: '2100' };
    google.messagesById['in-1'] = inboundMsg('in-1', { threadId: 'th-reply-1', from: 'Owner <owner@replycafe.sg>' });

    await inbox.poll();

    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('exited');
    expect(e.exitReason).toBe('replied');
    const acts = await OutreachActivity.findAll({ where: { partnerOrganisationId: p.id } });
    expect(acts.some((a) => a.type === 'email_reply' && a.direction === 'inbound')).toBe(true);
    // forward to the rep's real login mailbox
    const fwd = google.sendRaw.mock.calls.at(-1)[0];
    expect(fwd).toContain(`To: <${exec.user.email}>`);
    expect(fwd).toContain('Reply from ReplyCafe');
    expect(fwd).toContain('Sounds interesting');
  });

  test('an unsubscribe-phrased reply also writes the opt_out suppression (twice = upsert)', async () => {
    const p = await ownedPartner('UnsubCafe');
    await trackedSend(p, { threadId: 'th-unsub-1' });
    google.history = { messages: [{ id: 'in-2' }], historyId: '2200' };
    google.messagesById['in-2'] = inboundMsg('in-2', {
      threadId: 'th-unsub-1', from: 'Owner <boss@unsub.sg>', text: 'Please unsubscribe me from these emails.',
    });
    await inbox.poll();
    await OutreachAccount.update({ historyCursor: '1500' }, { where: { id: account.id } });
    await inbox.poll(); // replay — findOrCreate must not violate the unique index

    const rows = await OutreachSuppression.findAll({ where: { value: 'unsubcafe@biz.sg' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('opt_out');
  });

  test('a reply to a MERGED partner lands on the survivor', async () => {
    const survivor = await ownedPartner('SurvivorCafe');
    const dup = await ownedPartner('DupCafe');
    const { enrollment } = await trackedSend(dup, { threadId: 'th-merge-1' });
    // simulate a completed merge: dup points at survivor, dup's cadence exited
    await svc.stopEnrollment(dup.id, exec.user).catch(() => {});
    await sequelize.query(
      'UPDATE partner_organisations SET "mergedIntoId" = :sid WHERE id = :did',
      { replacements: { sid: survivor.id, did: dup.id } }
    );
    google.history = { messages: [{ id: 'in-3' }], historyId: '2300' };
    google.messagesById['in-3'] = inboundMsg('in-3', { threadId: 'th-merge-1', from: 'Owner <o@dup.sg>' });
    await inbox.poll();
    const acts = await OutreachActivity.findAll({ where: { partnerOrganisationId: survivor.id } });
    expect(acts.some((a) => a.type === 'email_reply')).toBe(true);
    void enrollment;
  });
});

describe('bounces and unmatched mail', () => {
  test('a mailer-daemon message on a tracked thread suppresses the address and fails the row', async () => {
    const p = await ownedPartner('BounceCafe');
    const { row } = await trackedSend(p, { threadId: 'th-bounce-1' });
    google.history = { messages: [{ id: 'in-4' }], historyId: '2400' };
    google.messagesById['in-4'] = inboundMsg('in-4', {
      threadId: 'th-bounce-1', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      subject: 'Delivery Status Notification (Failure)', text: 'Address not found',
    });
    await inbox.poll();
    const sup = await OutreachSuppression.findOne({ where: { value: row.toAddress.toLowerCase() } });
    expect(sup.reason).toBe('bounced');
    expect((await OutreachEmail.findByPk(row.id)).status).toBe('failed');
  });

  test('human mail TO a persona with no tracked thread bumps the unmatched counter; ordinary business@ mail is ignored', async () => {
    google.history = { messages: [{ id: 'in-5' }, { id: 'in-6' }], historyId: '2500' };
    google.messagesById['in-5'] = inboundMsg('in-5', { threadId: 'th-none-1', from: 'Someone <x@y.sg>', to: 'emily@redeem.sg' });
    google.messagesById['in-6'] = inboundMsg('in-6', { threadId: 'th-none-2', from: 'Vendor <v@z.sg>', to: 'business@mktr.sg' });
    await inbox.poll();
    expect((await OutreachAccount.findByPk(account.id)).unmatchedInboxCount).toBe(1);
  });
});

describe('send-time no_email now PARKS (deferred P5)', () => {
  test('recipient vanished → row cancelled, task cancelled, enrollment paused missing_info/no_email', async () => {
    const p = await ownedPartner('VanishCafe');
    const cadence = await svc.createCadence({
      name: 'Vanish Cad',
      steps: [{ channel: 'email', title: 'Vanish step', mode: 'auto', subject: 'Hi {{partner_name}}', script: 'Hi.', delayDays: 0, timeWindow: 'any' }],
    }, admin.user);
    await sequelize.query('UPDATE outreach_cadences SET "autoSendApprovals" = 999 WHERE id = :id', { replacements: { id: cadence.id } });
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { taskId: firstTask.id } });
    await OutreachAccount.update({ lastSuccessfulPollAt: new Date() }, { where: { id: account.id } });
    // every email source vanishes after enqueue
    await sequelize.query('UPDATE partner_organisations SET "primaryEmail" = NULL WHERE id = :id', { replacements: { id: p.id } });

    await sender.tick();

    const row = await OutreachEmail.findOne({ where: { taskId: firstTask.id } });
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toBe('no_email');
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('cancelled');
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('paused');
    expect(e.pausedReason).toBe('missing_info');
    expect(e.blockedReason).toBe('no_email');
  });
});

describe('extractPlainText', () => {
  test('walks multipart payloads and decodes base64url', () => {
    const nested = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: Buffer.from('<b>hi</b>').toString('base64url') } },
        { mimeType: 'text/plain', body: { data: Buffer.from('plain hello').toString('base64url') } },
      ],
    };
    expect(extractPlainText(nested)).toBe('plain hello');
  });
});
