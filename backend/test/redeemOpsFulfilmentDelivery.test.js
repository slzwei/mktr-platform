/**
 * PR A — voucher/pass delivery actually delivers
 * (docs/plans/trial-reward-funnel-hardening-prompt.md).
 *
 * The 2026-07-16 audit found ZERO email assertions across the fulfilment
 * suites — which is exactly how "notifyUnlock only wired in bootstrap" shipped
 * broken. This battery asserts delivery END-TO-END through the real app with
 * only the mailer mocked: unlock emails on all three surfaces (external HMAC /
 * Lyfe HMAC / admin console), truthful emailQueued incl. replay + no-email
 * leads, sweep-issue delivery, delivery recovery, atomic resend/share, manual
 * issue pinned to the requested activation, and the receipts the console reads.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';
process.env.EXTERNAL_APP_SECRET = process.env.EXTERNAL_APP_SECRET || 'test-external-secret';
process.env.LYFE_LEAD_OUTCOME_SECRET = process.env.LYFE_LEAD_OUTCOME_SECRET || 'test-lyfe-outcome-secret';

import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';

const sendEmailMock = jest.fn().mockResolvedValue({ success: true });

// Mirror EVERY named export — a missing name is an ESM link error in any
// module that imports it.
jest.unstable_mockModule('../src/services/mailer.js', () => ({
  resolveEmailFrom: () => 'noreply@test.local',
  brandFromContext: () => 'Redeem',
  getTransporter: () => null,
  sendEmail: (...args) => sendEmailMock(...args),
  sendLeadAssignmentEmail: jest.fn().mockResolvedValue({ success: true }),
  sendLeadConfirmationEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPackageAssignmentEmail: jest.fn().mockResolvedValue({ success: true }),
}));

let app, closeDb, createTestUser, createTestCampaign;
let Prospect, RewardOffer, Activation, RewardEntitlement, RedemptionEvent, PartnerOrganisation, sequelize;
let svc; // WIRED service — the thing production actually runs

let admin, agentExt, agentLyfe, redemptionOps, bdm;
let partner, offer, campaignA, campaignB, campaignC, activationA, activationB, activationC;

// Deterministic barrier over the service's fire-and-forget deliveries —
// sleeps would race the real async email + receipt chain.
let flushDeliveries;
const settle = () => flushDeliveries();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

function lastEmail() {
  return sendEmailMock.mock.calls.at(-1)?.[0] || null;
}
function tokenFromEmail(mail) {
  const m = String(mail?.text || '').match(/\/r\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extUnlock(body) {
  const bodyString = JSON.stringify({ ...body, timestamp: new Date().toISOString() });
  const sig = crypto.createHmac('sha256', process.env.EXTERNAL_APP_SECRET).update(Buffer.from(bodyString)).digest('hex');
  return request(app)
    .post('/api/external/entitlements/unlock')
    .set('content-type', 'application/json')
    .set('x-webhook-signature', `sha256=${sig}`)
    .send(bodyString);
}

function lyfeUnlock(body) {
  const bodyString = JSON.stringify(body);
  const ts = new Date().toISOString();
  const sig = crypto.createHmac('sha256', process.env.LYFE_LEAD_OUTCOME_SECRET).update(`${ts}.${bodyString}`).digest('hex');
  return request(app)
    .post('/api/integrations/lyfe/entitlement-unlock')
    .set('content-type', 'application/json')
    .set('x-webhook-timestamp', ts)
    .set('x-webhook-signature', `sha256=${sig}`)
    .send(bodyString);
}

let prospectSeq = 0;
async function makeProspect(overrides = {}) {
  prospectSeq += 1;
  return Prospect.create({
    firstName: 'Delivery',
    lastName: `Holder${prospectSeq}`,
    phone: `+65${Math.floor(80000000 + Math.random() * 9999999)}`,
    email: `delivery-${Date.now()}-${prospectSeq}@test.com`,
    leadSource: 'website',
    campaignId: campaignA.id,
    assignedAgentId: agentExt.user.id,
    sourceMetadata: { phoneVerifiedAt: new Date().toISOString() },
    ...overrides,
  });
}

/** Clear the 60s resend cooldown / recovery in-flight window for an entitlement. */
async function backdateHistory(entitlementId, minutes = 15) {
  await sequelize.query(
    `UPDATE redemption_events SET "createdAt" = NOW() - INTERVAL '${minutes} minutes' WHERE "entitlementId" = :id`,
    { replacements: { id: entitlementId } }
  );
  await sequelize.query(
    `UPDATE reward_entitlements SET "createdAt" = NOW() - INTERVAL '${minutes} minutes' WHERE id = :id`,
    { replacements: { id: entitlementId } }
  );
}

beforeAll(async () => {
  const helpers = await import('./helpers.js');
  ({ closeDb, createTestUser, createTestCampaign } = helpers);
  app = await helpers.getApp();
  ({ Prospect, RewardOffer, Activation, RewardEntitlement, RedemptionEvent, PartnerOrganisation, sequelize } =
    await import('../src/models/index.js'));
  ({ flushDeliveries } = await import('../src/services/redeemOps/entitlementService.js'));
  const wiring = await import('../src/services/redeemOps/entitlementWiring.js');
  svc = wiring.makeWiredEntitlementService();

  admin = await createTestUser({ role: 'admin' });
  agentExt = await createTestUser({ role: 'agent', mktrLeadsId: `ml-${Date.now()}` });
  agentLyfe = await createTestUser({ role: 'agent', lyfeId: `ly-${Date.now()}` });
  redemptionOps = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'redemption_ops' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });

  partner = await PartnerOrganisation.create({
    tradingName: 'Delivery Test Studio', normalizedName: 'delivery test studio', createdBy: admin.user.id,
  });
  campaignA = await createTestCampaign(admin.user.id, { name: 'Delivery Campaign A' });
  campaignB = await createTestCampaign(admin.user.id, { name: 'Delivery Campaign B' });
  campaignC = await createTestCampaign(admin.user.id, { name: 'Delivery Campaign C' });

  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Trial Session',
    committedQuantity: 300, allocatedQuantity: 200, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activationA = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignA.id,
    campaignNameSnapshot: campaignA.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
  activationB = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignB.id,
    campaignNameSnapshot: campaignB.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
  activationC = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignC.id,
    campaignNameSnapshot: campaignC.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'on_capture', createdBy: admin.user.id,
  });
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await flushDeliveries(); // drain any straggler from the previous test
  sendEmailMock.mockClear();
  sendEmailMock.mockResolvedValue({ success: true });
});

describe('issuance delivers (single choke point)', () => {
  test('fresh issue sends the reservation pass + writes a notified receipt', async () => {
    const prospect = await makeProspect();
    const r = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(r.reason).toBeNull();
    expect(r.emailQueued).toBe(true);
    await settle();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const mail = lastEmail();
    expect(mail.subject).toContain('Reserved for you');
    expect(mail.to).toBe(prospect.email);
    expect(tokenFromEmail(mail)).toBe(r.presentationToken);

    const receipts = await RedemptionEvent.findAll({
      where: { entitlementId: r.entitlement.id, type: 'notified' },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].metadata.kind).toBe('pass');
    expect(receipts[0].metadata.channel).toBe('email');
    expect(receipts[0].metadata.to).toContain('•'); // masked, never the raw address
  });

  test('concurrent hook/sweep race → exactly ONE email', async () => {
    const prospect = await makeProspect();
    const [a, b] = await Promise.all([
      svc.issueForProspect(prospect, { via: 'hook' }),
      svc.issueForProspect(prospect, { via: 'sweep' }),
    ]);
    await settle();
    const fresh = [a, b].filter((r) => r.reason === null);
    expect(fresh).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  test('on_capture policy sends the VOUCHER email at issue', async () => {
    const prospect = await makeProspect({ campaignId: campaignC.id });
    const r = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(r.reason).toBeNull();
    expect(r.voucherToken).toBeTruthy();
    expect(r.entitlement.activationId).toBe(activationC.id);
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lastEmail().subject).toContain('Your voucher');

    const claim = await request(app).get(`/api/reward-claim/${r.presentationToken}`);
    expect(claim.status).toBe(200);
    expect(claim.body.data.state).toBe('unlocked');
  });

  test('no-email (Retell placeholder) lead: no send, no receipt, emailQueued false', async () => {
    const prospect = await makeProspect({ email: `retell-${Date.now()}@calls.mktr.sg` });
    const r = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(r.reason).toBeNull();
    expect(r.emailQueued).toBe(false);
    await settle();
    expect(sendEmailMock).not.toHaveBeenCalled();
    const deliveryReceipts = (await RedemptionEvent.findAll({ where: { entitlementId: r.entitlement.id } }))
      .filter((e) => ['notified', 'notify_failed'].includes(e.type));
    expect(deliveryReceipts).toHaveLength(0); // nothing attempted → no receipt
  });
});

describe('unlock delivers the voucher on all three surfaces', () => {
  test('external (mktr-leads) scan unlock → voucher email + emailQueued', async () => {
    const prospect = await makeProspect();
    const issue = await svc.issueForProspect(prospect);
    await settle();
    sendEmailMock.mockClear();

    const res = await extUnlock({
      agentMktrUserId: agentExt.user.mktrLeadsId,
      presentationToken: issue.presentationToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.emailQueued).toBe(true);
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lastEmail().subject).toContain('Your voucher');

    const receipts = (await RedemptionEvent.findAll({ where: { entitlementId: issue.entitlement.id, type: 'notified' } }))
      .filter((e) => e.metadata?.kind === 'voucher');
    expect(receipts).toHaveLength(1);
  });

  test('lyfe button unlock → voucher email + truthful message; replay sends nothing', async () => {
    const prospect = await makeProspect({ assignedAgentId: agentLyfe.user.id });
    await svc.issueForProspect(prospect);
    await settle();
    sendEmailMock.mockClear();

    const res = await lyfeUnlock({ agentLyfeId: agentLyfe.user.lyfeId, prospectId: prospect.id });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('emailed their voucher');
    expect(res.body.data.emailQueued).toBe(true);
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    sendEmailMock.mockClear();
    const replay = await lyfeUnlock({ agentLyfeId: agentLyfe.user.lyfeId, prospectId: prospect.id });
    expect(replay.status).toBe(200);
    expect(replay.body.data.already).toBe(true);
    expect(replay.body.data.emailQueued).toBe(false);
    expect(replay.body.message).toBe('Already unlocked');
    await settle();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test('admin console unlock → voucher email + emailQueued in the payload', async () => {
    const prospect = await makeProspect();
    await svc.issueForProspect(prospect);
    await settle();
    sendEmailMock.mockClear();

    const res = await request(app)
      .post('/api/redeem-ops/entitlements/unlock')
      .set(auth(admin.token))
      .send({ prospectId: prospect.id });
    expect(res.status).toBe(200);
    expect(res.body.data.emailQueued).toBe(true);
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(lastEmail().subject).toContain('Your voucher');
  });

  test('no-email lead unlock: succeeds, NO email, message says share the link', async () => {
    const prospect = await makeProspect({
      email: `retell-${Date.now()}@calls.mktr.sg`,
      assignedAgentId: agentLyfe.user.id,
    });
    await svc.issueForProspect(prospect);
    await settle();
    sendEmailMock.mockClear();

    const res = await lyfeUnlock({ agentLyfeId: agentLyfe.user.lyfeId, prospectId: prospect.id });
    expect(res.status).toBe(200);
    expect(res.body.data.emailQueued).toBe(false);
    expect(res.body.message).toContain('no email on file');
    await settle();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('sweeps deliver', () => {
  test('reconcileMissedLeads issues AND emails; the emailed token resolves', async () => {
    const prospect = await makeProspect(); // no entitlement yet — hook "missed" it
    sendEmailMock.mockClear();
    const issued = await svc.reconcileMissedLeads();
    expect(issued).toBeGreaterThanOrEqual(1);
    await settle();

    const mine = sendEmailMock.mock.calls.map((c) => c[0]).find((m) => m.to === prospect.email);
    expect(mine).toBeTruthy();
    expect(mine.subject).toContain('Reserved for you');
    const token = tokenFromEmail(mine);
    const claim = await request(app).get(`/api/reward-claim/${token}`);
    expect(claim.status).toBe(200);
    expect(claim.body.data.state).toBe('reserved');
  });

  test('reconcileMissedDeliveries re-mints + resends when the first send failed', async () => {
    const prospect = await makeProspect();
    sendEmailMock.mockResolvedValueOnce({ success: false, message: 'mailer down' });
    const issue = await svc.issueForProspect(prospect);
    await settle();

    const failed = (await RedemptionEvent.findAll({ where: { entitlementId: issue.entitlement.id, type: 'notify_failed' } }));
    expect(failed).toHaveLength(1);

    await backdateHistory(issue.entitlement.id, 15);
    sendEmailMock.mockClear();

    const recovered = await svc.reconcileMissedDeliveries();
    expect(recovered).toBeGreaterThanOrEqual(1);
    await settle();

    const mine = sendEmailMock.mock.calls.map((c) => c[0]).find((m) => m.to === prospect.email);
    expect(mine).toBeTruthy();
    const newToken = tokenFromEmail(mine);
    expect(newToken).not.toBe(issue.presentationToken);
    expect((await request(app).get(`/api/reward-claim/${issue.presentationToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/reward-claim/${newToken}`)).status).toBe(200);
  });

  test('recovery gives up after maxAttempts failures (console shows it instead)', async () => {
    const prospect = await makeProspect();
    sendEmailMock.mockResolvedValueOnce({ success: false, message: 'down' });
    const issue = await svc.issueForProspect(prospect);
    await settle();
    // two more failed attempts on record → 3 total
    for (let i = 0; i < 2; i += 1) {
      await RedemptionEvent.create({
        entitlementId: issue.entitlement.id, type: 'notify_failed', actorType: 'system',
        metadata: { kind: 'pass', channel: 'email' },
      });
    }
    await backdateHistory(issue.entitlement.id, 15);
    sendEmailMock.mockClear();

    await svc.reconcileMissedDeliveries();
    await settle();
    const mine = sendEmailMock.mock.calls.map((c) => c[0]).find((m) => m.to === prospect.email);
    expect(mine).toBeFalsy();
  });

  test('recovery skips rows already delivered and rows too young', async () => {
    const delivered = await makeProspect();
    const issue = await svc.issueForProspect(delivered); // success receipt
    await settle(); // let the delivered send land BEFORE arming the failure
    const young = await makeProspect();
    sendEmailMock.mockResolvedValueOnce({ success: false, message: 'down' });
    const youngIssue = await svc.issueForProspect(young); // failed, but < minAge
    await settle();
    await backdateHistory(issue.entitlement.id, 15); // delivered one is old but has notified
    sendEmailMock.mockClear();

    await svc.reconcileMissedDeliveries();
    await settle();
    const calls = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(calls).not.toContain(delivered.email);
    expect(calls).not.toContain(young.email);
    expect(youngIssue.reason).toBeNull();
  });
});

describe('resend / share', () => {
  async function issueBackdated(overrides = {}) {
    const prospect = await makeProspect(overrides);
    const issue = await svc.issueForProspect(prospect);
    expect(issue.reason).toBeNull();
    await settle();
    await backdateHistory(issue.entitlement.id, 15);
    sendEmailMock.mockClear();
    return { prospect, issue };
  }

  test('eligible resend (email): old token 404s, new token 200s', async () => {
    const { issue } = await issueBackdated();
    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('no longer works');
    expect(res.body.data.kind).toBe('pass');
    expect(res.body.data.emailQueued).toBe(true);
    await settle();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const newToken = tokenFromEmail(lastEmail());
    expect(newToken).not.toBe(issue.presentationToken);
    expect((await request(app).get(`/api/reward-claim/${issue.presentationToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/reward-claim/${newToken}`)).status).toBe(200);
  });

  test('issued resend rotates ONLY the voucher — the presentation link survives', async () => {
    const { prospect, issue } = await issueBackdated();
    const unlock = await svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual');
    expect(unlock.already).toBe(false);
    await settle();
    await backdateHistory(issue.entitlement.id, 15);
    sendEmailMock.mockClear();

    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('voucher');
    await settle();

    const newVoucher = tokenFromEmail(lastEmail());
    expect(newVoucher).not.toBe(unlock.voucherToken);
    // old voucher credential is dead…
    expect((await request(app).get(`/api/reward-claim/${unlock.voucherToken}`)).status).toBe(404);
    // …but the post-unlock presentation link still renders the voucher (step-9 design)
    const viaPass = await request(app).get(`/api/reward-claim/${issue.presentationToken}`);
    expect(viaPass.status).toBe(200);
    expect(viaPass.body.data.state).toBe('unlocked');
    expect((await request(app).get(`/api/reward-claim/${newVoucher}`)).status).toBe(200);
    expect(prospect.id).toBeTruthy();
  });

  test('link channel: bundle returned once, nothing emailed, no-store set', async () => {
    const { prospect, issue } = await issueBackdated();
    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'link' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.link).toMatch(/\/r\/[A-Za-z0-9_-]+/);
    expect(res.body.data.waMessage).toContain('Free Trial Session');
    const digits = prospect.phone.replace(/\D/g, '');
    expect(res.body.data.waUrl).toContain(`wa.me/${digits}`);
    expect(res.body.data.waUrl).toContain(encodeURIComponent('reserved'));
    await settle();
    expect(sendEmailMock).not.toHaveBeenCalled();

    const newToken = res.body.data.link.split('/r/')[1];
    expect((await request(app).get(`/api/reward-claim/${issue.presentationToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/reward-claim/${newToken}`)).status).toBe(200);
  });

  test('link channel without a phone: waUrl null + typed reason', async () => {
    const { issue } = await issueBackdated({ phone: null });
    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'link' });
    expect(res.status).toBe(200);
    expect(res.body.data.waUrl).toBeNull();
    expect(res.body.data.waUnavailableReason).toBe('no_phone');
    expect(res.body.data.link).toMatch(/\/r\//);
  });

  test('no usable email + email channel → typed 409 (link still possible)', async () => {
    const { issue } = await issueBackdated({ email: `retell-${Date.now()}@calls.mktr.sg` });
    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('copy-link');
  });

  test('cooldown: immediate second resend → 429', async () => {
    const { issue } = await issueBackdated();
    const first = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(second.status).toBe(429);
  });

  test('expired / cancelled → typed 409; bdm capability → 403', async () => {
    const { issue } = await issueBackdated();
    await RewardEntitlement.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: issue.entitlement.id } });
    const expired = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(expired.status).toBe(409);
    expect(expired.body.message).toContain('expired');

    const { issue: issue2 } = await issueBackdated();
    const forbidden = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue2.entitlement.id}/resend-pass`)
      .set(auth(bdm.token))
      .send({ channel: 'email' });
    expect(forbidden.status).toBe(403);
  });

  test('resend racing a state change loses cleanly (conditional update)', async () => {
    const { issue } = await issueBackdated();
    // Simulate the race: state flips to cancelled after the service read it —
    // the conditional UPDATE (status must still match) must reject.
    await RewardEntitlement.update({ status: 'cancelled' }, { where: { id: issue.entitlement.id } });
    const res = await request(app)
      .post(`/api/redeem-ops/entitlements/${issue.entitlement.id}/resend-pass`)
      .set(auth(redemptionOps.token))
      .send({ channel: 'email' });
    expect(res.status).toBe(409);
  });
});

describe('manual issue', () => {
  test('pins the REQUESTED activation (not the prospect-campaign one) and emails', async () => {
    const prospectOnB = await makeProspect({ campaignId: campaignB.id, assignedAgentId: agentExt.user.id });
    sendEmailMock.mockClear();
    const res = await request(app)
      .post('/api/redeem-ops/entitlements')
      .set(auth(admin.token))
      .send({ activationId: activationA.id, prospectId: prospectOnB.id });
    expect(res.status).toBe(201);
    expect(res.body.data.entitlement.activationId).toBe(activationA.id);
    expect(res.body.data.entitlement.activationId).not.toBe(activationB.id);
    expect(res.body.data.emailQueued).toBe(true);
    expect(res.body.data.presentationToken).toBeTruthy(); // staff hand-delivery unchanged
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  test('a non-active requested activation is refused with the typed reason', async () => {
    const prospect = await makeProspect();
    const draft = await Activation.create({
      partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: null,
      campaignNameSnapshot: null, allocatedQuantity: 5, status: 'draft',
      unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
    });
    const res = await request(app)
      .post('/api/redeem-ops/entitlements')
      .set(auth(admin.token))
      .send({ activationId: draft.id, prospectId: prospect.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('activation_not_active');
  });
});

describe('console list surfaces delivery truth', () => {
  test('emailDeliverable + per-channel delivery receipt, raw email stripped', async () => {
    const good = await makeProspect();
    const goodIssue = await svc.issueForProspect(good);
    const bad = await makeProspect({ email: `retell-${Date.now()}@calls.mktr.sg` });
    const badIssue = await svc.issueForProspect(bad);
    await settle();

    const res = await request(app)
      .get('/api/redeem-ops/entitlements?limit=100')
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    const rows = res.body.data.entitlements;

    const goodRow = rows.find((r) => r.id === goodIssue.entitlement.id);
    expect(goodRow.emailDeliverable).toBe(true);
    expect(goodRow.delivery.email).toBeTruthy();
    expect(goodRow.delivery.email.ok).toBe(true);
    expect(goodRow.delivery.email.kind).toBe('pass');

    const badRow = rows.find((r) => r.id === badIssue.entitlement.id);
    expect(badRow.emailDeliverable).toBe(false);
    expect(badRow.delivery.email).toBeNull();

    for (const r of rows) {
      expect(r.prospect === null || !('email' in r.prospect)).toBe(true);
      if (r.prospect?.phone) expect(r.prospect.phone).toContain('••••');
    }
  });
});
