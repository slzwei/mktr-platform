/**
 * Email auto-send Phase B — outbox + sender + approval ramp
 * (docs/plans/redeem-ops-cadence-email-autosend.md §3/§4/§8-B).
 *
 * Google is DI-mocked at the sender factory. The non-negotiables under test,
 * each from a verified review finding: reply-loop gate (P1), no insta-send on
 * record fixes (P2), single-source-of-truth body/subject (C3/M3), manual
 * completion kills the queued send (C1b), cancellation coherence, approval
 * ramp + data-lint (P4), opt-out (P13), loud no-persona, flag-off reaper (P6).
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_CADENCES_ENABLED = 'true';
process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED = 'true';
process.env.OUTREACH_MAILBOX_ENCRYPTION_KEY = 'test-outreach-encryption-key-32chars!';

import request from 'supertest';
import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  OutreachAccount, OutreachPersona, OutreachEmail, OutreachTask,
  OutreachCadence, OutreachCadenceEnrollment, OutreachCadenceStep, OutreachActivity,
  PartnerOrganisation, sequelize,
} from '../src/models/index.js';
import { makeCadenceService, autoSendLint } from '../src/services/redeemOps/cadenceService.js';
import { makeOutreachSenderService } from '../src/services/redeemOps/outreachSenderService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';
import { makeTaskService } from '../src/services/redeemOps/taskService.js';
import { makeSecretBox } from '../src/utils/secretBox.js';
import { registerCadenceHooks, clearCadenceHooks } from '../src/services/redeemOps/cadenceHooks.js';

let app;
let admin, exec;
let account, persona;

const svc = makeCadenceService();
const partnerSvc = makePartnerService();
const claimSvc = makeClaimService();
const taskSvc = makeTaskService();

const google = {
  sendRaw: jest.fn(async () => ({ id: 'gm-100', threadId: 'th-100' })),
  wireId: '<real-wire-id@mail.gmail.com>',
  threadMessages: [{ id: 'm1', labelIds: ['SENT'] }],
  sentSearch: [],
};
const mockClient = () => ({
  sendRaw: google.sendRaw,
  getMessageHeaders: async () => ({ payload: { headers: [{ name: 'Message-ID', value: google.wireId }] } }),
  getThread: async () => ({ messages: google.threadMessages }),
  listMessages: async () => google.sentSearch,
});
// Pin the sender's clock to TODAY 12:00 SGT — inside the 07:00-21:00 send
// window (the service reschedules outside it, so an unpinned suite goes red
// on every night-SGT run: the 21:29/23:48/02:42-SGT CI failures). Row claiming
// compares against DB NOW(), so the pin only steers window/cap/freshness math.
const noonSgt = () => {
  const t = new Date();
  t.setUTCHours(4, 0, 0, 0); // 12:00 SGT
  return t;
};
const sender = makeOutreachSenderService({ makeClient: mockClient, now: noonSgt });

let phoneSeq = 82000000;
const nextPhone = () => `+65${phoneSeq++}`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await getApp();
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
    lastSuccessfulPollAt: new Date(), // reply loop healthy by default
  });
  persona = await OutreachPersona.create({
    accountId: account.id, address: 'emily@redeem.sg', displayName: 'Emily Wong',
    assignedUserId: exec.user.id, sendAsRegistered: true, sendAsVerified: true,
    isAccountAlias: true, dailySendCap: 50,
  });
});

afterAll(async () => {
  clearCadenceHooks();
  await closeDb();
});

beforeEach(async () => {
  google.sendRaw.mockClear();
  google.threadMessages = [{ id: 'm1', labelIds: ['SENT'] }];
  await OutreachAccount.update({ lastSuccessfulPollAt: new Date(), sentToday: 0 }, { where: { id: account.id } });
  await OutreachPersona.update({ sentToday: 0, isActive: true, consecutiveFailures: 0 }, { where: { id: persona.id } });
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

let cadenceSeq = 0;
async function autoCadence({ ramped = false } = {}) {
  cadenceSeq += 1;
  const cadence = await svc.createCadence({
    name: `Auto Mail ${cadenceSeq}`,
    steps: [
      {
        channel: 'email', title: `Auto intro ${cadenceSeq}`, mode: 'auto',
        subject: 'Bring customers to {{partner_name}}',
        script: 'Hi {{contact_name}}, quick idea for {{partner_name}}.',
        delayDays: 0, timeWindow: 'any',
      },
    ],
  }, admin.user);
  if (ramped) await OutreachCadence.update({ autoSendApprovals: 999 }, { where: { id: cadence.id } });
  return cadence;
}

const liveRow = (taskId) => OutreachEmail.findOne({
  where: { taskId }, order: [['createdAt', 'DESC']],
});

describe('authoring gate & lint helper', () => {
  test('mode=auto refuses without the env flag; subject required with it', async () => {
    const def = (over) => ({
      name: `Gate ${Date.now()}`,
      steps: [{ channel: 'email', title: 'E', delayDays: 0, mode: 'auto', subject: 'S', ...over }],
    });
    const before = process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED;
    try {
      process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED = 'false';
      await expect(svc.createCadence(def({}), admin.user)).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      process.env.REDEEM_OPS_EMAIL_AUTOSEND_ENABLED = before;
    }
    // A blank subject no longer refuses — it lands the house default, so the
    // wire never carries a task title.
    const defaulted = await svc.createCadence(def({ subject: null, name: `Gate default ${Date.now()}` }), admin.user);
    const step = await OutreachCadenceStep.findOne({ where: { cadenceId: defaulted.id } });
    expect(step.subjectTemplate).toBe('Bringing new customers to {{partner_name}}');
    await expect(svc.createCadence(def({ channel: 'call', subject: 'S' }), admin.user)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('autoSendLint holds junk merges but tolerates digit-bearing business names', () => {
    expect(autoSendLint({ contactName: 'Test' })).toBe('lint_contact_name');
    expect(autoSendLint({ contactName: 'Marcus2' })).toBe('lint_contact_name');
    expect(autoSendLint({ partnerName: '7-Eleven Bedok', contactName: 'Marcus' })).toBeNull();
    expect(autoSendLint({ body: 'Hi there, quick idea' })).toBe('lint_fallback_greeting');
    expect(autoSendLint({ recipient: 'x@mailinator.com' })).toBe('lint_test_domain');
  });
});

describe('enqueue at materialization', () => {
  test('ramp holds the first sends for approval; approving releases and counts', async () => {
    const cadence = await autoCadence();
    const p = await ownedPartner('RampCafe');
    await partnerSvc.addContact(p.id, { name: 'Marcus', email: 'marcus@rampcafe.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    expect(firstTask.emailSubject).toBe('Bring customers to RampCafe');

    let row = await liveRow(firstTask.id);
    expect(row.status).toBe('needs_approval');
    expect(row.holdReason).toBe('ramp');
    expect(row.toAddress).toBe('marcus@rampcafe.sg');

    const res = await request(app)
      .post(`/api/redeem-ops/outreach/emails/${row.id}/approve`)
      .set(auth(exec.token));
    expect(res.status).toBe(200);
    row = await OutreachEmail.findByPk(row.id);
    expect(row.status).toBe('queued');
    expect((await OutreachCadence.findByPk(cadence.id)).autoSendApprovals).toBe(1);
  });

  test('past the ramp it queues directly — but the data-lint still holds garbage', async () => {
    const cadence = await autoCadence({ ramped: true });
    const clean = await ownedPartner('CleanCafe');
    await partnerSvc.addContact(clean.id, { name: 'Sara', email: 'sara@cleancafe.sg' }, exec.user);
    const a = await svc.enrollPartner(clean.id, { cadenceId: cadence.id }, exec.user);
    expect((await liveRow(a.firstTask.id)).status).toBe('queued');

    const dirty = await ownedPartner('DirtyCafe');
    await partnerSvc.addContact(dirty.id, { name: 'Test', email: 'test@dirtycafe.sg' }, exec.user);
    const b = await svc.enrollPartner(dirty.id, { cadenceId: cadence.id }, exec.user);
    const held = await liveRow(b.firstTask.id);
    expect(held.status).toBe('needs_approval');
    expect(held.holdReason).toBe('lint_contact_name');
  });

  test('partner opt-out means NO machine send; a rep without a persona is a loud cancelled row', async () => {
    const cadence = await autoCadence({ ramped: true });
    const optedOut = await ownedPartner('OptOutCafe', { autoEmailOptOut: true });
    const r1 = await svc.enrollPartner(optedOut.id, { cadenceId: cadence.id }, exec.user);
    expect(await liveRow(r1.firstTask.id)).toBeNull();

    await OutreachPersona.update({ isActive: false }, { where: { id: persona.id } });
    try {
      const noPersona = await ownedPartner('NoPersonaCafe');
      const r2 = await svc.enrollPartner(noPersona.id, { cadenceId: cadence.id }, exec.user);
      const row = await liveRow(r2.firstTask.id);
      expect(row.status).toBe('cancelled');
      expect(row.lastError).toBe('no_sending_persona');
    } finally {
      await OutreachPersona.update({ isActive: true }, { where: { id: persona.id } });
    }
  });
});

describe('the sender', () => {
  test('refuses every send while the reply loop is dark (plan P1)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('DarkLoopCafe');
    await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { partnerOrganisationId: p.id } });

    await OutreachAccount.update({ lastSuccessfulPollAt: null }, { where: { id: account.id } });
    const out = await sender.tick();
    expect(out.skipped).toBe('reply_loop_dark');
    expect(google.sendRaw).not.toHaveBeenCalled();
  });

  test('happy path: sends FROM the persona, completes as sent with auto attribution, stores thread + wire id', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('HappyCafe');
    await partnerSvc.addContact(p.id, { name: 'Wei', email: 'wei@happycafe.sg' }, exec.user);
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { taskId: firstTask.id } });

    const out = await sender.tick();
    expect(out.sent).toBe(1);
    const rfc = google.sendRaw.mock.calls[0][0];
    expect(rfc).toContain('From: "Emily Wong" <emily@redeem.sg>');
    expect(rfc).toContain('To: <wei@happycafe.sg>');
    expect(rfc).toContain('Subject: Bring customers to HappyCafe');
    // Every send signs off AS the sending persona — and the body ends there:
    // no unsubscribe line, no corporate footer (Shawn's call, 2026-08-11).
    expect(rfc).toContain('Best regards');
    expect(rfc).toContain('Redeem · redeem.sg');
    expect(rfc).not.toContain('unsubscribe');
    expect(rfc).not.toContain('MKTR PTE. LTD.');

    const row = await OutreachEmail.findOne({ where: { taskId: firstTask.id } });
    expect(row.status).toBe('sent');
    expect(row.wireMessageId).toBe(google.wireId);
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('completed');
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.gmailThreadId).toBe('th-100');
    expect(['completed', 'exited']).toContain(e.state); // single-step cadence finishes
    const acts = await OutreachActivity.findAll({ where: { partnerOrganisationId: p.id } });
    expect(acts.some((a) => a.type === 'email_sent' && /auto-sent as emily@redeem\.sg/.test(a.summary))).toBe(true);
  });

  test('a script that already signs off gets no second signature', async () => {
    const cadence = await svc.createCadence({
      name: `Signed Mail ${Date.now()}`,
      steps: [{
        channel: 'email', title: 'E', mode: 'auto', subject: 'Quick idea for {{partner_name}}',
        script: 'Hi {{contact_name}}, quick idea.\n\nCheers,\n{{rep_name}}', delayDays: 0, timeWindow: 'any',
      }],
    }, admin.user);
    await OutreachCadence.update({ autoSendApprovals: 999 }, { where: { id: cadence.id } });
    const p = await ownedPartner('SignedCafe');
    await partnerSvc.addContact(p.id, { name: 'Ana', email: 'ana@signedcafe.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { taskId: firstTask.id } });
    await sender.tick();
    const rfc = google.sendRaw.mock.calls.map((c) => c[0]).find((r) => r.includes('ana@signedcafe.sg'));
    expect(rfc).toBeTruthy();
    expect(rfc).toContain('Cheers,');
    expect(rfc).not.toContain('Best regards'); // the script's own closing stands alone
    expect(rfc).not.toContain('unsubscribe'); // body ends at the closing — nothing appended
  });

  test('a rep completing the task manually kills the queued machine send in the same transaction (C1b)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('ManualFirstCafe');
    await partnerSvc.addContact(p.id, { name: 'Farah', email: 'farah@manualfirst.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    expect((await liveRow(firstTask.id)).status).toBe('queued');

    await svc.completeCadenceTask(firstTask.id, { disposition: 'sent' }, exec.user);
    const row = await liveRow(firstTask.id);
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toBe('superseded_by_completion');
    expect(google.sendRaw).not.toHaveBeenCalled();
  });

  test('pause and skip cancel queued sends (cancellation coherence)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('PauseCoherenceCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await svc.pauseEnrollment(p.id, exec.user);
    expect((await liveRow(firstTask.id)).status).toBe('cancelled');

    const p2 = await ownedPartner('SkipCoherenceCafe');
    const r2 = await svc.enrollPartner(p2.id, { cadenceId: cadence.id }, exec.user);
    await svc.skipCurrentStep(p2.id, { expectedStepId: r2.enrollment.currentStepId }, exec.user);
    expect((await liveRow(r2.firstTask.id)).status).toBe('cancelled');
  });

  test('send-time revalidation cancels on a changed recipient instead of mailing the old address', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('StaleAddrCafe');
    await partnerSvc.addContact(p.id, { name: 'Lena', email: 'old@staleaddr.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await OutreachEmail.update({ nextAttemptAt: new Date(Date.now() - 1000) }, { where: { taskId: firstTask.id } });

    // The rep fixes the typo AFTER enqueue — the send must not go to either
    // address silently; it cancels for review.
    await sequelize.query(
      `UPDATE partner_contacts SET email = 'new@staleaddr.sg' WHERE "partnerOrganisationId" = :pid`,
      { replacements: { pid: p.id } }
    );
    await sender.tick();
    const row = await OutreachEmail.findOne({ where: { taskId: firstTask.id } });
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toBe('recipient_changed');
    expect(google.sendRaw).not.toHaveBeenCalled();
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('open'); // stays manual work
  });

  test("editing the message mid-send 409s; otherwise the edit IS what sends (C3)", async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('EditRaceCafe');
    await partnerSvc.addContact(p.id, { name: 'Mei', email: 'mei@editrace.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    const row = await liveRow(firstTask.id);

    await row.update({ status: 'sending' });
    await expect(taskSvc.updateTask(firstTask.id, { description: 'edited' }, exec.user))
      .rejects.toMatchObject({ statusCode: 409 });
    await row.update({ status: 'queued', nextAttemptAt: new Date(Date.now() - 1000) });

    await taskSvc.updateTask(firstTask.id, { description: 'Hand-tuned body', emailSubject: 'Hand-tuned subject' }, exec.user);
    await sender.tick();
    const rfc = google.sendRaw.mock.calls.at(-1)[0];
    expect(rfc).toContain('Subject: Hand-tuned subject');
    expect(rfc).toContain('Hand-tuned body');
  });

  test('the flag-off reaper converts queued sends to visible manual work (P6)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('ReaperCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    const n = await sender.reapDisabled();
    expect(n).toBeGreaterThanOrEqual(1);
    const row = await liveRow(firstTask.id);
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toBe('autosend_disabled');
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('open');
  });

  test('automatic resume into an auto step schedules ≥1h out — no insta-send on a record fix (P2)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('InstaSendCafe', { primaryEmail: null });
    const { enrollment, pausedForInfo } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    expect(pausedForInfo).toBeTruthy(); // parked no_email

    await partnerSvc.addContact(p.id, { name: 'Ken', email: 'ken@instasend.sg' }, exec.user); // hook auto-resumes
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('active');
    const task = await OutreachTask.findOne({
      where: { cadenceEnrollmentId: enrollment.id, status: ['open', 'in_progress'] },
    });
    const minDue = Date.now() + 55 * 60_000;
    expect(new Date(task.dueAt).getTime()).toBeGreaterThan(minDue);
    const row = await liveRow(task.id);
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(minDue);
  });

  test('"Don\'t send" refuses once the worker holds the row — no false "won\'t send" acknowledgement (C-2)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('RaceCancelCafe');
    await partnerSvc.addContact(p.id, { name: 'Ivan', email: 'ivan@racecancel.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    const row = await liveRow(firstTask.id);
    await row.update({ status: 'sending' }); // the worker claimed it mid-click
    const res = await request(app)
      .post(`/api/redeem-ops/outreach/emails/${row.id}/convert-manual`)
      .set(auth(exec.token));
    expect(res.status).toBe(409);
    expect((await OutreachEmail.findByPk(row.id)).status).toBe('sending'); // untouched
  });

  test('Send now marks the row window-override and due immediately (P15)', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('SendNowCafe');
    await partnerSvc.addContact(p.id, { name: 'Yusof', email: 'yusof@sendnow.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    const row = await liveRow(firstTask.id);
    const res = await request(app)
      .post(`/api/redeem-ops/outreach/emails/${row.id}/send-now`)
      .set(auth(exec.token));
    expect(res.status).toBe(200);
    const fresh = await OutreachEmail.findByPk(row.id);
    expect(fresh.windowOverride).toBe(true);
    expect(new Date(fresh.nextAttemptAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('"Don\'t send" converts the machine send to a plain manual task via the route', async () => {
    const cadence = await autoCadence({ ramped: true });
    const p = await ownedPartner('DontSendCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    const row = await liveRow(firstTask.id);
    const res = await request(app)
      .post(`/api/redeem-ops/outreach/emails/${row.id}/convert-manual`)
      .set(auth(exec.token));
    expect(res.status).toBe(200);
    expect((await OutreachEmail.findByPk(row.id)).status).toBe('cancelled');
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('open');
  });
});

describe('one-click send on MANUAL email steps', () => {
  async function manualCadence(steps) {
    cadenceSeq += 1;
    return svc.createCadence({
      name: `Manual Mail ${cadenceSeq}`,
      steps: steps || [{
        channel: 'email', title: `Manual intro ${cadenceSeq}`,
        script: 'Hi {{contact_name}}, note for {{partner_name}}.', delayDays: 0, timeWindow: 'any',
      }],
    }, admin.user);
  }

  test('queues a window-override row with no ramp hold; the worker sends and completes it', async () => {
    const cadence = await manualCadence();
    const p = await ownedPartner('ManualSendCafe');
    await partnerSvc.addContact(p.id, { name: 'Nora', email: 'nora@manualsend.sg' }, exec.user);
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    expect(await liveRow(firstTask.id)).toBeNull(); // manual step — nothing enqueued
    // Materialization rendered the DEFAULT subject (the step was authored
    // without one) — the task title never reaches the wire.
    expect(firstTask.emailSubject).toBe('Bringing new customers to ManualSendCafe');

    let row = await sender.sendTaskEmail(firstTask.id, exec.user);
    expect(row.status).toBe('queued');
    expect(row.holdReason).toBeNull(); // human reviewed it — no ramp
    expect(row.windowOverride).toBe(true);
    expect(row.toAddress).toBe('nora@manualsend.sg');

    // The service fires a best-effort tick itself; settle to a terminal state
    // regardless of which pass wins the claim.
    const until = Date.now() + 4000;
    row = await OutreachEmail.findByPk(row.id);
    while (row.status !== 'sent' && Date.now() < until) {
      await sender.tick();
      row = await OutreachEmail.findByPk(row.id);
      if (row.status !== 'sent') await new Promise((r) => setTimeout(r, 50));
    }
    expect(row.status).toBe('sent');
    // Ticks may also flush stale queued rows from earlier tests — find OUR wire message.
    const rfc = google.sendRaw.mock.calls.map((c) => c[0]).find((r) => r.includes('To: <nora@manualsend.sg>'));
    expect(rfc).toBeTruthy();
    expect(rfc).toContain('From: "Emily Wong" <emily@redeem.sg>');
    expect(rfc).toContain('Subject: Bringing new customers to ManualSendCafe');
    expect(rfc).not.toContain('Subject: Manual intro'); // the task title is NOT a subject
    expect((await OutreachTask.findByPk(firstTask.id)).status).toBe('completed');
    const acts = await OutreachActivity.findAll({ where: { partnerOrganisationId: p.id } });
    expect(acts.some((a) => a.type === 'email_sent' && /auto-sent as emily@redeem\.sg/.test(a.summary))).toBe(true);
  });

  test('route: creating the row does not need reply-loop health (sending does); a second click 409s', async () => {
    // Loop dark → the inline tick refuses to SEND, so the row deterministically
    // stays queued — proving creation and dispatch are separate gates.
    await OutreachAccount.update({ lastSuccessfulPollAt: null }, { where: { id: account.id } });
    const cadence = await manualCadence();
    const p = await ownedPartner('ManualDupCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);

    const res = await request(app)
      .post(`/api/redeem-ops/outreach/tasks/${firstTask.id}/send-email`)
      .set(auth(exec.token));
    expect(res.status).toBe(201);
    expect(res.body.data.email.status).toBe('queued');

    const dup = await request(app)
      .post(`/api/redeem-ops/outreach/tasks/${firstTask.id}/send-email`)
      .set(auth(exec.token));
    expect(dup.status).toBe(409);
    expect(await OutreachEmail.count({ where: { taskId: firstTask.id } })).toBe(1);
  });

  test('a blanked subject blocks sending: the button 409s, and the worker cancels a queued row', async () => {
    const cadence = await manualCadence();
    const p = await ownedPartner('NoSubjectCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);

    await OutreachTask.update({ emailSubject: '' }, { where: { id: firstTask.id } });
    await expect(sender.sendTaskEmail(firstTask.id, exec.user))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/subject/i) });

    // Queue a valid send while the loop is dark (holds the row), then blank
    // the subject before the worker claims it — send-time revalidation must
    // cancel, never fall back to the task title.
    await OutreachTask.update({ emailSubject: 'Real subject' }, { where: { id: firstTask.id } });
    await OutreachAccount.update({ lastSuccessfulPollAt: null }, { where: { id: account.id } });
    await sender.sendTaskEmail(firstTask.id, exec.user);
    await OutreachTask.update({ emailSubject: '' }, { where: { id: firstTask.id } });
    await OutreachAccount.update({ lastSuccessfulPollAt: new Date() }, { where: { id: account.id } });
    await sender.tick();
    const row = await liveRow(firstTask.id);
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toBe('no_subject');
    // Ticks may flush other tests' stale rows — assert OUR address never sent.
    expect(google.sendRaw.mock.calls.some((c) => c[0].includes('nosubjectcafe'))).toBe(false);
  });

  test('the Task-created timeline entry hides via the task refKey path', async () => {
    const cadence = await manualCadence();
    const p = await ownedPartner('HideTaskCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await partnerSvc.hideTimelineEntry(
      p.id, { kind: 'task', refKey: `${firstTask.id}:created`, reason: 'noise' }, admin.user
    );
    const { entries } = await partnerSvc.getTimeline(p.id);
    expect(entries.some((e) => e.kind === 'task' && e.data.task.id === firstTask.id && e.data.event === 'created')).toBe(false);
    await expect(partnerSvc.hideTimelineEntry(p.id, { kind: 'task', refKey: 'garbage', reason: 'x' }, admin.user))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('deleting a business cascades its cadence enrollment, tasks, and outbox rows', async () => {
    // Guards the FK-cascade invariant — a future migration flipping one of
    // these to RESTRICT would break the admin Delete-business flow with a 500.
    await OutreachAccount.update({ lastSuccessfulPollAt: null }, { where: { id: account.id } });
    const cadence = await manualCadence();
    const p = await ownedPartner('DoomedCafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceId: cadence.id }, exec.user);
    await sender.sendTaskEmail(firstTask.id, exec.user); // queued row (loop dark)

    await partnerSvc.deletePartner(p.id, admin.user);
    expect(await PartnerOrganisation.findByPk(p.id)).toBeNull();
    expect(await OutreachCadenceEnrollment.count({ where: { partnerOrganisationId: p.id } })).toBe(0);
    expect(await OutreachTask.count({ where: { partnerOrganisationId: p.id } })).toBe(0);
    expect(await OutreachEmail.count({ where: { partnerOrganisationId: p.id } })).toBe(0);
  });

  test('refuses non-email steps, opted-out partners, and assignees with no persona — creating nothing', async () => {
    const callCadence = await manualCadence([{ channel: 'call', title: 'Call them', delayDays: 0, timeWindow: 'any' }]);
    const p1 = await ownedPartner('ManualCallCafe');
    const r1 = await svc.enrollPartner(p1.id, { cadenceId: callCadence.id }, exec.user);
    await expect(sender.sendTaskEmail(r1.firstTask.id, exec.user))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/email steps/i) });

    const emailCadence = await manualCadence();
    const p2 = await ownedPartner('ManualOptOutCafe', { autoEmailOptOut: true });
    const r2 = await svc.enrollPartner(p2.id, { cadenceId: emailCadence.id }, exec.user);
    await expect(sender.sendTaskEmail(r2.firstTask.id, exec.user))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/manual sending only/i) });

    await OutreachPersona.update({ isActive: false }, { where: { id: persona.id } });
    try {
      const p3 = await ownedPartner('ManualNoPersonaCafe');
      const r3 = await svc.enrollPartner(p3.id, { cadenceId: emailCadence.id }, exec.user);
      await expect(sender.sendTaskEmail(r3.firstTask.id, exec.user))
        .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/sending identity/i) });
      expect(await liveRow(r3.firstTask.id)).toBeNull();
    } finally {
      await OutreachPersona.update({ isActive: true }, { where: { id: persona.id } });
    }
  });
});
