import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import {
  EmailBroadcast, EmailBroadcastRecipient, Cohort, Consumer, ConsentEvent, ConsumerSuppression,
} from '../src/models/index.js';
import { makeEmailBroadcastService } from '../src/services/emailBroadcastService.js';
import { normalizeDefinition } from '../src/services/cohortService.js';
import { hashPhone } from '../src/utils/piiHashing.js';

/**
 * Email broadcast pipeline (tracker "emailpush",
 * docs/plans/email-broadcast-push.md) on real Postgres with the REAL cohort
 * resolution + consent gate — only transport (`sendEmail`), transporter
 * presence and `sleep` are injected. What this file proves is the safety
 * story: send-time re-gating (post-claim suppression bites), the
 * at-most-once fence (`attempting` never retried), per-address dedupe +
 * cross-consumer address suppression, verify-before-send unsubscribe
 * tokens, cancel, resume-only-pending, the one-in-flight fence, and the
 * boot sweep.
 */

const RUN = Date.now() % 1000000000;
let seq = 0;
const nextPhone = () => `+658${String(RUN + (seq += 1)).padStart(7, '0').slice(-7)}`;
const nextEmail = () => `push-${RUN}-${seq += 1}@example.test`;

let admin;
let campA; let campB;

async function makeConsumer({ email = nextEmail(), campaign = campA, scope = null, granted = true, verified = true } = {}) {
  const phone = nextPhone();
  const consumer = await Consumer.create({
    phone, phoneHash: hashPhone(phone), firstName: 'Push', lastName: 'Fixture', email,
    firstSeenAt: new Date(), lastSeenAt: new Date(), signupCount: 1,
  });
  await createTestProspect(campaign.id, {
    phone, consumerId: consumer.id, demographics: { dateOfBirth: '1990-05-12' },
  });
  if (granted !== null) {
    await ConsentEvent.create({
      consumerId: consumer.id, campaignId: scope, kind: 'contact', granted,
      channels: ['phone'], version: `emailpush-${RUN}`, source: 'signup',
      verified, occurredAt: new Date(),
    });
  }
  return consumer;
}

function cohortDefFor(campaign) {
  return normalizeDefinition({ filters: { campaignIds: [campaign.id] } });
}

async function makeCohort(campaign, name) {
  return Cohort.create({ name: `${name} ${RUN}-${seq += 1}`, definition: cohortDefFor(campaign) });
}

function makeSvc(overrides = {}) {
  const sendEmail = overrides.sendEmail || jest.fn(async () => ({ success: true }));
  const sleep = jest.fn(async () => {});
  const svc = makeEmailBroadcastService({
    sendEmail,
    getTransporter: () => ({ fake: true }),
    sleep,
    ...overrides,
  });
  return { svc, sendEmail, sleep };
}

async function makeDraft({ cohort, campaign = campA, subject = 'Hello there', bodyText = 'First paragraph.\n\nSecond paragraph.', ctaLabel = 'See it' } = {}) {
  return EmailBroadcast.create({
    cohortId: cohort.id, campaignId: campaign.id, subject, bodyText, ctaLabel, createdBy: admin.user.id,
  });
}

/** A broadcast frozen mid-flight (for resume/drift tests) with claimed rows. */
async function makeInterrupted({ cohort, campaign = campA, consumers, subject = 'Resume me' }) {
  const def = cohortDefFor(campaign);
  def.marketingContext = { ...def.marketingContext, campaignId: campaign.id };
  const b = await EmailBroadcast.create({
    cohortId: cohort.id, campaignId: campaign.id, subject, bodyText: 'Body.',
    ctaLabel: 'Go', status: 'interrupted', definitionSnapshot: def,
    hostChoice: 'redeem', emailContext: 'redeem',
    ctaUrl: `https://redeem.sg/LeadCapture?campaign_id=${campaign.id}`,
    totalRecipients: consumers.length, startedAt: new Date(),
  });
  for (const c of consumers) {
    await EmailBroadcastRecipient.create({ broadcastId: b.id, consumerId: c.id, email: c.email, status: 'pending' });
  }
  return b;
}

const rowsOf = (b) => EmailBroadcastRecipient.findAll({ where: { broadcastId: b.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  campA = await createTestCampaign(admin.user.id, { name: `Push A ${RUN}` });
  campB = await createTestCampaign(admin.user.id, { name: `Push B ${RUN}` });
});

afterAll(async () => {
  await closeDb();
});

afterEach(async () => {
  // Keep the global one-in-flight fence clean for the next test.
  await EmailBroadcast.update(
    { status: 'cancelled' },
    { where: { status: ['preparing', 'sending', 'cancelling'] } }
  );
});

describe('full send happy path', () => {
  test('resolves, freezes context, gates, sends with PR-B rails, finalizes counts', async () => {
    const c1 = await makeConsumer(); // global grant
    const c2 = await makeConsumer({ scope: campA.id }); // scoped to the push campaign
    const cohort = await makeCohort(campA, 'Happy');
    const draft = await makeDraft({ cohort, subject: 'Big <news> tonight' });

    const { svc, sendEmail, sleep } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(draft.id);
    await workerPromise;

    const done = await EmailBroadcast.findByPk(draft.id);
    expect(done.status).toBe('completed');
    expect(done.totalRecipients).toBe(2);
    expect(done.sentCount).toBe(2);
    expect(done.skippedCount).toBe(0);
    expect(done.failedCount).toBe(0);
    expect(done.completedAt).toBeTruthy();

    // Frozen context: snapshot re-aimed at the push campaign, CTA has utm.
    expect(done.definitionSnapshot.marketingContext.campaignId).toBe(campA.id);
    expect(done.hostChoice).toBe('redeem');
    expect(done.ctaUrl).toContain(`campaign_id=${campA.id}`);
    expect(done.ctaUrl).toContain('utm_source=mktr');
    expect(done.ctaUrl).toContain('utm_medium=email');
    expect(done.ctaUrl).toContain(`utm_campaign=broadcast-${draft.id.slice(0, 8)}`);

    const rows = await rowsOf(draft);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(rows.map((r) => r.email).sort()).toEqual([c1.email, c2.email].sort());
    expect(rows.every((r) => r.sentAt)).toBe(true);

    // The PR-B rails on every message, escaping, and the working unsub link.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const [args] of sendEmail.mock.calls) {
      expect(args.headers['List-Unsubscribe']).toMatch(/^<https:\/\/api\.mktr\.sg\/api\/unsubscribe\?t=[0-9a-f]{64}>$/);
      expect(args.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(args.context).toBe('redeem');
      expect(args.subject).toBe('Big <news> tonight');
      expect(args.html).not.toContain('<news>');
      expect(args.html).toContain('Big &lt;news&gt; tonight');
      // The href is attribute-escaped (& → &amp;) — assert the escaped form.
      expect(args.html).toContain(done.ctaUrl.replace(/&/g, '&amp;'));
      expect(args.html).toContain('MKTR PTE. LTD. (UEN 202507548M), Singapore');
      expect(args.text).toContain('Unsubscribe: https://api.mktr.sg/api/unsubscribe?t=');
    }

    // Throttle: one pause per processed row at the default 2/s.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(500);
  });

  test('body/script escaping never reaches the html raw', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'Escape');
    const draft = await makeDraft({ cohort, bodyText: 'Look <script>alert(1)</script>\n\nBye.' });
    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(draft.id);
    await workerPromise;
    const html = sendEmail.mock.calls.find(([a]) => a.to === c.email)[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('preflight (all-or-back-to-draft)', () => {
  test('unconfigured transporter reverts to draft with the reason', async () => {
    await makeConsumer();
    const cohort = await makeCohort(campA, 'NoSmtp');
    const draft = await makeDraft({ cohort });
    const { svc } = makeSvc({ getTransporter: () => null });
    await expect(svc.startBroadcastSend(draft.id)).rejects.toThrow(/transport is not configured/i);
    const after = await EmailBroadcast.findByPk(draft.id);
    expect(after.status).toBe('draft');
    expect(after.lastError).toMatch(/transport/i);
  });

  test('inactive campaign (is_active=false with status active) reverts', async () => {
    const dark = await createTestCampaign(admin.user.id, { name: `Dark ${RUN}`, status: 'active', is_active: false });
    await makeConsumer({ campaign: dark });
    const cohort = await makeCohort(dark, 'Dark');
    const draft = await makeDraft({ cohort, campaign: dark });
    const { svc } = makeSvc();
    await expect(svc.startBroadcastSend(draft.id)).rejects.toThrow(/must be active/i);
    expect((await EmailBroadcast.findByPk(draft.id)).status).toBe('draft');
  });

  test('empty reachable audience reverts', async () => {
    const lonely = await createTestCampaign(admin.user.id, { name: `Lonely ${RUN}` });
    const cohort = await makeCohort(lonely, 'Empty');
    const draft = await makeDraft({ cohort, campaign: lonely });
    const { svc } = makeSvc();
    await expect(svc.startBroadcastSend(draft.id)).rejects.toThrow(/no reachable email recipients/i);
    expect((await EmailBroadcast.findByPk(draft.id)).status).toBe('draft');
  });

  test('audience over the recipient cap reverts', async () => {
    const crowd = await createTestCampaign(admin.user.id, { name: `Crowd ${RUN}` });
    await makeConsumer({ campaign: crowd });
    await makeConsumer({ campaign: crowd });
    const cohort = await makeCohort(crowd, 'Cap');
    const draft = await makeDraft({ cohort, campaign: crowd });
    process.env.EMAIL_BROADCAST_MAX_RECIPIENTS = '1';
    try {
      const { svc } = makeSvc();
      await expect(svc.startBroadcastSend(draft.id)).rejects.toThrow(/exceeds EMAIL_BROADCAST_MAX_RECIPIENTS/);
      expect((await EmailBroadcast.findByPk(draft.id)).status).toBe('draft');
    } finally {
      delete process.env.EMAIL_BROADCAST_MAX_RECIPIENTS;
    }
  });

  test('audience resolution excludes people outside the PUSH campaign scope', async () => {
    // Scoped-to-B consumer signs up under campA population but has no basis
    // for a campA push — resolution (gate re-aimed at campA) leaves them out.
    const scopedElsewhere = await makeConsumer({ scope: campB.id });
    const ok = await makeConsumer();
    const cohort = await makeCohort(campA, 'Scope');
    const draft = await makeDraft({ cohort });
    const { svc } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(draft.id);
    await workerPromise;
    const rows = await rowsOf(draft);
    expect(rows.map((r) => r.consumerId)).toContain(ok.id);
    expect(rows.map((r) => r.consumerId)).not.toContain(scopedElsewhere.id);
  });
});

describe('send-time re-gate (the §5 obligation) + drift', () => {
  test('suppression landing AFTER claim skips at send with the gate reason', async () => {
    const c1 = await makeConsumer();
    const c2 = await makeConsumer();
    const cohort = await makeCohort(campA, 'Drift');
    const b = await makeInterrupted({ cohort, consumers: [c1, c2] });
    await ConsumerSuppression.create({ consumerId: c2.id, channel: 'all', reason: 'unsubscribe', source: 'unsubscribe_link' });

    const { svc } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const rows = await rowsOf(b);
    const byConsumer = Object.fromEntries(rows.map((r) => [r.consumerId, r]));
    expect(byConsumer[c1.id].status).toBe('sent');
    expect(byConsumer[c2.id].status).toBe('skipped');
    expect(byConsumer[c2.id].reason).toBe('suppressed');
    expect((await EmailBroadcast.findByPk(b.id)).status).toBe('completed');
  });

  test('email removed after claim skips missing_email; changed email sends to the CURRENT address', async () => {
    const gone = await makeConsumer();
    const moved = await makeConsumer();
    const cohort = await makeCohort(campA, 'Dest');
    const b = await makeInterrupted({ cohort, consumers: [gone, moved] });
    await gone.update({ email: null });
    const newAddr = `moved-${RUN}@example.test`;
    await moved.update({ email: newAddr });

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const rows = await rowsOf(b);
    const byConsumer = Object.fromEntries(rows.map((r) => [r.consumerId, r]));
    expect(byConsumer[gone.id].status).toBe('skipped');
    expect(byConsumer[gone.id].reason).toBe('missing_email');
    expect(byConsumer[moved.id].status).toBe('sent');
    expect(byConsumer[moved.id].email).toBe(newAddr);
    expect(sendEmail.mock.calls.some(([a]) => a.to === newAddr)).toBe(true);
  });

  test('two consumers sharing one normalized address: one copy, one duplicate_email', async () => {
    const sharedAddr = `shared-${RUN}@example.test`;
    const one = await makeConsumer({ email: sharedAddr });
    const two = await makeConsumer({ email: `  ${sharedAddr.toUpperCase()}  ` });
    const cohort = await makeCohort(campA, 'Dupe');
    const b = await makeInterrupted({ cohort, consumers: [one, two] });

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const rows = await rowsOf(b);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['sent', 'skipped']);
    expect(rows.find((r) => r.status === 'skipped').reason).toBe('duplicate_email');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('an address unsubscribed through ANOTHER consumer id is address_suppressed', async () => {
    const sharedAddr = `cross-${RUN}@example.test`;
    // The other identity of this person: same inbox, suppressed, NOT in the push.
    const otherSelf = await makeConsumer({ email: sharedAddr, campaign: campB });
    await ConsumerSuppression.create({ consumerId: otherSelf.id, channel: 'email', reason: 'unsubscribe', source: 'unsubscribe_link' });
    const target = await makeConsumer({ email: sharedAddr });
    const cohort = await makeCohort(campA, 'Cross');
    const b = await makeInterrupted({ cohort, consumers: [target] });

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const [row] = await rowsOf(b);
    expect(row.status).toBe('skipped');
    expect(row.reason).toBe('address_suppressed');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('an unverifiable unsubscribe token blocks the send (verify-before-send)', async () => {
    const c = await makeConsumer();
    // A stored hash that cannot match any freshly-derived token (secret
    // rotation aftermath): ensureUnsubToken keeps the stored value, the
    // verify step sees the mismatch, the mail is never sent.
    await c.update({ unsubTokenHash: 'f'.repeat(64) });
    const cohort = await makeCohort(campA, 'Token');
    const b = await makeInterrupted({ cohort, consumers: [c] });

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const [row] = await rowsOf(b);
    expect(row.status).toBe('skipped');
    expect(row.reason).toBe('unsub_token_error');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('transport failures', () => {
  test('sendEmail {success:false} marks failed/send_error (never sent)', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'SoftFail');
    const b = await makeInterrupted({ cohort, consumers: [c] });
    const sendEmail = jest.fn(async () => ({ success: false, message: 'Mailer not configured; logged instead.' }));
    const { svc } = makeSvc({ sendEmail });
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;
    const [row] = await rowsOf(b);
    expect(row.status).toBe('failed');
    expect(row.reason).toBe('send_error');
    expect(row.error).toMatch(/not configured/i);
    const done = await EmailBroadcast.findByPk(b.id);
    expect(done.status).toBe('completed');
    expect(done.failedCount).toBe(1);
  });

  test('a throwing transport marks that row failed and the loop continues', async () => {
    const bad = await makeConsumer();
    const good = await makeConsumer();
    const cohort = await makeCohort(campA, 'Throw');
    const b = await makeInterrupted({ cohort, consumers: [bad, good] });
    const sendEmail = jest.fn(async ({ to }) => {
      if (to === bad.email) throw new Error('SMTP 550 rejected');
      return { success: true };
    });
    const { svc } = makeSvc({ sendEmail });
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;
    const rows = await rowsOf(b);
    const byConsumer = Object.fromEntries(rows.map((r) => [r.consumerId, r]));
    expect(byConsumer[bad.id].status).toBe('failed');
    expect(byConsumer[bad.id].error).toMatch(/550/);
    expect(byConsumer[good.id].status).toBe('sent');
  });
});

describe('at-most-once + resume + cancel + fences', () => {
  test('resume marks attempting rows ambiguous_crash and never re-sends them', async () => {
    const ambiguous = await makeConsumer();
    const fresh = await makeConsumer();
    const cohort = await makeCohort(campA, 'Ambig');
    const b = await makeInterrupted({ cohort, consumers: [ambiguous, fresh] });
    await EmailBroadcastRecipient.update(
      { status: 'attempting' },
      { where: { broadcastId: b.id, consumerId: ambiguous.id } }
    );

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const rows = await rowsOf(b);
    const byConsumer = Object.fromEntries(rows.map((r) => [r.consumerId, r]));
    expect(byConsumer[ambiguous.id].status).toBe('failed');
    expect(byConsumer[ambiguous.id].reason).toBe('ambiguous_crash');
    expect(byConsumer[fresh.id].status).toBe('sent');
    // The crashed row's address got NO second copy.
    expect(sendEmail.mock.calls.map(([a]) => a.to)).toEqual([fresh.email]);
  });

  test('resume never re-resolves: a new signup after the freeze is not added', async () => {
    const original = await makeConsumer();
    const cohort = await makeCohort(campA, 'Frozen');
    const b = await makeInterrupted({ cohort, consumers: [original] });
    const late = await makeConsumer(); // matches the cohort NOW, but after the freeze

    const { svc } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const rows = await rowsOf(b);
    expect(rows).toHaveLength(1);
    expect(rows[0].consumerId).toBe(original.id);
    expect(rows.map((r) => r.consumerId)).not.toContain(late.id);
  });

  test('resume of a draft (no snapshot) is rejected', async () => {
    const cohort = await makeCohort(campA, 'NoSnap');
    const draft = await makeDraft({ cohort });
    const { svc } = makeSvc();
    await expect(svc.startBroadcastSend(draft.id, { resume: true })).rejects.toThrow(/no frozen send context/i);
  });

  test('cancel mid-loop stops within one iteration and marks the rest cancelled', async () => {
    const first = await makeConsumer();
    const second = await makeConsumer();
    const third = await makeConsumer();
    const cohort = await makeCohort(campA, 'Cancel');
    const b = await makeInterrupted({ cohort, consumers: [first, second, third] });
    const sendEmail = jest.fn(async () => {
      // An admin hits Cancel while the first mail is in flight.
      await EmailBroadcast.update({ status: 'cancelling' }, { where: { id: b.id, status: 'sending' } });
      return { success: true };
    });
    const { svc } = makeSvc({ sendEmail });
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const done = await EmailBroadcast.findByPk(b.id);
    expect(done.status).toBe('cancelled');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const rows = await rowsOf(b);
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
    const rest = rows.filter((r) => r.status === 'skipped');
    expect(rest).toHaveLength(2);
    expect(rest.every((r) => r.reason === 'cancelled')).toBe(true);
  });

  test('one broadcast in flight globally', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'Fence');
    const inFlight = await makeInterrupted({ cohort, consumers: [c] });
    await inFlight.update({ status: 'sending', workerHeartbeatAt: new Date() });
    const draft = await makeDraft({ cohort });
    const { svc } = makeSvc();
    await expect(svc.startBroadcastSend(draft.id)).rejects.toThrow(/one at a time/i);
    await inFlight.update({ status: 'cancelled' });
  });

  test('a fresh-heartbeat sending broadcast cannot be resumed (worker owns it)', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'Owned');
    const b = await makeInterrupted({ cohort, consumers: [c] });
    await b.update({ status: 'sending', workerHeartbeatAt: new Date() });
    const { svc } = makeSvc();
    await expect(svc.startBroadcastSend(b.id, { resume: true })).rejects.toThrow(/not resumable/i);
    await b.update({ status: 'cancelled' });
  });

  test('boot sweep flips stale in-flight broadcasts to interrupted and lands attempting rows', async () => {
    const c1 = await makeConsumer();
    const c2 = await makeConsumer();
    const cohort = await makeCohort(campA, 'Sweep');
    const b = await makeInterrupted({ cohort, consumers: [c1, c2] });
    await b.update({ status: 'sending', workerHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000) });
    await EmailBroadcastRecipient.update(
      { status: 'attempting' },
      { where: { broadcastId: b.id, consumerId: c1.id } }
    );

    const { svc } = makeSvc();
    const swept = await svc.sweepStaleBroadcasts();
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await EmailBroadcast.findByPk(b.id);
    expect(after.status).toBe('interrupted');
    const rows = await rowsOf(b);
    const byConsumer = Object.fromEntries(rows.map((r) => [r.consumerId, r]));
    expect(byConsumer[c1.id].status).toBe('failed');
    expect(byConsumer[c1.id].reason).toBe('ambiguous_crash');
    expect(byConsumer[c2.id].status).toBe('pending');
  });
});

describe('Codex round-2 races (edit/erase/cancel/zombie)', () => {
  test('erased between claim and send: gate skips, no PII written back', async () => {
    const erased = await makeConsumer();
    const cohort = await makeCohort(campA, 'Erased');
    const b = await makeInterrupted({ cohort, consumers: [erased] });
    // The erasure core, as 16b + step 17 leave it: suppression row + nulled row.
    await ConsumerSuppression.create({ consumerId: erased.id, channel: 'all', reason: 'erasure', source: 'erasure' });
    await erased.update({ email: null, phone: null, firstName: null, lastName: null, unsubTokenHash: null, erasedAt: new Date() });

    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const [row] = await rowsOf(b);
    expect(row.status).toBe('skipped');
    // Destination refresh sees the nulled email before the gate even runs.
    expect(row.reason).toBe('missing_email');
    expect(row.email).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('erasure committing DURING transport: the terminal write is repaired', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'MidErase');
    const b = await makeInterrupted({ cohort, consumers: [c] });
    const sendEmail = jest.fn(async () => {
      // Erasure lands while the mail is on the wire.
      await c.update({ email: null, erasedAt: new Date() });
      return { success: true };
    });
    const { svc } = makeSvc({ sendEmail });
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const [row] = await rowsOf(b);
    expect(row.status).toBe('sent'); // the delivery fact stands…
    expect(row.email).toBeNull(); // …but the repair removed the PII again
    expect(row.error).toBeNull();
  });

  test('mktr-host campaign freezes mktr brand context and CTA origin', async () => {
    const mktrCamp = await createTestCampaign(admin.user.id, {
      name: `Mktr Host ${RUN}`, design_config: { customerHost: 'mktr' },
    });
    await makeConsumer({ campaign: mktrCamp });
    const cohort = await makeCohort(mktrCamp, 'MktrHost');
    const draft = await makeDraft({ cohort, campaign: mktrCamp });
    const { svc, sendEmail } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(draft.id);
    await workerPromise;

    const done = await EmailBroadcast.findByPk(draft.id);
    expect(done.hostChoice).toBe('mktr');
    expect(done.emailContext).toBe('mktr');
    expect(done.ctaUrl).toMatch(/^https:\/\/mktr\.sg\/LeadCapture\?/);
    expect(sendEmail.mock.calls[0][0].context).toBe('mktr');
  });

  test('cancel racing the LAST iteration wins over completed', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'LastCancel');
    const b = await makeInterrupted({ cohort, consumers: [c] });
    const sendEmail = jest.fn(async () => {
      // Cancel lands while the final mail is in flight: the queue will be
      // empty next loop, and finalizeCompleted must LOSE to the cancel.
      await EmailBroadcast.update({ status: 'cancelling' }, { where: { id: b.id, status: 'sending' } });
      return { success: true };
    });
    const { svc } = makeSvc({ sendEmail });
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;

    const done = await EmailBroadcast.findByPk(b.id);
    expect(done.status).toBe('cancelled');
    expect(done.sentCount).toBe(1); // the send that was already in flight stands
  });

  test('a superseded (zombie) lease loses its heartbeat', async () => {
    const c = await makeConsumer();
    const cohort = await makeCohort(campA, 'Zombie');
    const b = await makeInterrupted({ cohort, consumers: [c] });
    // A resume mints a fresh lease…
    const { svc } = makeSvc();
    const { workerPromise } = await svc.startBroadcastSend(b.id, { resume: true });
    await workerPromise;
    // …after which the old worker's lease-keyed heartbeat matches nothing.
    const staleLease = '00000000-0000-4000-8000-00000000dead';
    const [hb] = await EmailBroadcast.sequelize.query(
      `UPDATE email_broadcasts SET "workerHeartbeatAt" = now()
        WHERE id = :id AND status = 'sending' AND "workerLeaseId" = :lease RETURNING id`,
      { replacements: { id: b.id, lease: staleLease } }
    );
    expect(hb).toHaveLength(0);
  });

  test('a stale cancelling broadcast is swept to cancelled, never back to resumable', async () => {
    const c1 = await makeConsumer();
    const cohort = await makeCohort(campA, 'SweepCancel');
    const b = await makeInterrupted({ cohort, consumers: [c1] });
    await b.update({ status: 'cancelling', workerHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000) });

    const { svc } = makeSvc();
    await svc.sweepStaleBroadcasts();

    const after = await EmailBroadcast.findByPk(b.id);
    expect(after.status).toBe('cancelled');
    const [row] = await rowsOf(b);
    expect(row.status).toBe('skipped');
    expect(row.reason).toBe('cancelled');
  });
});

describe('test sends', () => {
  test('goes to the requesting admin only, marked, with an inert unsubscribe', async () => {
    const cohort = await makeCohort(campA, 'Test');
    const draft = await makeDraft({ cohort, subject: 'Preview me' });
    const { svc, sendEmail } = makeSvc();
    const result = await svc.sendTestEmail(draft.id, admin.user);
    expect(result.to).toBe(admin.user.email);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [args] = sendEmail.mock.calls[0];
    expect(args.to).toBe(admin.user.email);
    expect(args.subject).toBe('[TEST] Preview me');
    expect(args.html).toContain('TEST SEND');
    expect(args.headers).toBeUndefined();
  });
});
