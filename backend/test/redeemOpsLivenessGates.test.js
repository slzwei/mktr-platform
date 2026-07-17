/**
 * PR C — liveness gates + linkage guards + skip observability
 * (docs/plans/trial-reward-funnel-hardening-prompt.md, defects 4 + 5).
 *
 * Battery: unlock refuses paused/completed/cancelled activations (typed 409s)
 * while replay stays idempotent; the unlock TRANSACTION predicate holds even
 * when the pre-check is blinded (TOCTOU); issuance refuses paused offers and
 * ended activations; a live activation's campaign link is immutable; every
 * skip writes a persisted row surfaced by the detail endpoint; purge works.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  Prospect, RewardOffer, Activation, RewardEntitlement, ActivationIssuanceSkip,
  PartnerOrganisation, sequelize,
} from '../src/models/index.js';
import { makeEntitlementService } from '../src/services/redeemOps/entitlementService.js';
import { makeActivationService } from '../src/services/redeemOps/activationService.js';

const svc = makeEntitlementService(); // bare: no emails — gate mechanics only
const activations = makeActivationService();

let app;
let admin, agent;
let partner, offer, pausedOffer;
let campW, actW; // main happy-path pair
let phoneSeq = 70000000;
const freshPhone = () => `+65${phoneSeq++}`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makeVerifiedProspect(campaignId, overrides = {}) {
  return Prospect.create({
    firstName: 'Gate',
    lastName: 'Holder',
    phone: freshPhone(),
    email: `gates-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website',
    campaignId,
    assignedAgentId: agent.user.id,
    sourceMetadata: { phoneVerifiedAt: new Date().toISOString() },
    ...overrides,
  });
}

async function makeActivation(campaignId, overrides = {}) {
  return Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId,
    campaignNameSnapshot: campaignId ? 'snap' : null, allocatedQuantity: 30, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id, ...overrides,
  });
}

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Gates Test Studio', normalizedName: 'gates test studio', createdBy: admin.user.id,
  });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Gate Trial',
    committedQuantity: 300, allocatedQuantity: 200, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  pausedOffer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Paused Offer Trial',
    committedQuantity: 50, allocatedQuantity: 30, status: 'paused',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  campW = await createTestCampaign(admin.user.id, { name: 'Gates Campaign W' });
  actW = await makeActivation(campW.id);
});

afterAll(async () => {
  await closeDb();
});

describe('unlock liveness gate', () => {
  test('paused / completed / cancelled activations refuse unlock with typed 409s; active unlocks', async () => {
    const prospect = await makeVerifiedProspect(campW.id);
    const issue = await svc.issueForProspect(prospect);
    expect(issue.reason).toBeNull();

    await actW.update({ status: 'paused' });
    await expect(
      svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual')
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('paused') });

    await actW.update({ status: 'completed' });
    await expect(
      svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual')
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('completed') });

    await actW.update({ status: 'cancelled' });
    await expect(
      svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual')
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('cancelled') });

    await actW.update({ status: 'active' });
    const unlocked = await svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual');
    expect(unlocked.already).toBe(false);
    expect(unlocked.entitlement.status).toBe('issued');

    // Replay carve-out: the unlock already happened — pausing afterwards must
    // NOT break idempotent replays.
    await actW.update({ status: 'paused' });
    const replay = await svc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual');
    expect(replay.already).toBe(true);
    await actW.update({ status: 'active' });
  });

  test('TOCTOU: a pause that lands after the pre-check still loses inside the transaction', async () => {
    const prospect = await makeVerifiedProspect(campW.id);
    const issue = await svc.issueForProspect(prospect);
    expect(issue.reason).toBeNull();

    // Blind the pre-check: this instance always sees the activation as active,
    // simulating a pause committed between pre-check and UPDATE.
    const blindSvc = makeEntitlementService({
      Activation: {
        findByPk: async () => ({ id: actW.id, status: 'active' }),
        findOne: (...a) => Activation.findOne(...a),
        findAll: (...a) => Activation.findAll(...a),
      },
    });
    await actW.update({ status: 'paused' });
    await expect(
      blindSvc.unlockEntitlement({ presentationToken: issue.presentationToken }, admin.user, 'manual')
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('no longer active') });

    // The entitlement is untouched — still eligible, still unlockable later.
    await actW.update({ status: 'active' });
    const row = await RewardEntitlement.findByPk(issue.entitlement.id);
    expect(row.status).toBe('eligible');
  });
});

describe('issuance liveness gates + persisted skips', () => {
  test('paused OFFER refuses issuance with a typed reason + skip row', async () => {
    const campX = await createTestCampaign(admin.user.id, { name: 'Gates Campaign X' });
    const actX = await makeActivation(campX.id, { rewardOfferId: pausedOffer.id });
    const prospect = await makeVerifiedProspect(campX.id);

    const r = await svc.issueForProspect(prospect);
    expect(r.entitlement).toBeNull();
    expect(r.reason).toBe('offer_not_active');

    const skips = await ActivationIssuanceSkip.findAll({ where: { activationId: actX.id } });
    expect(skips.map((s) => s.reason)).toContain('offer_not_active');
  });

  test('ended activation refuses issuance; future endDate issues fine', async () => {
    const campY = await createTestCampaign(admin.user.id, { name: 'Gates Campaign Y' });
    const actY = await makeActivation(campY.id, { endDate: new Date(Date.now() - 3600 * 1000) });
    const p1 = await makeVerifiedProspect(campY.id);
    const ended = await svc.issueForProspect(p1);
    expect(ended.reason).toBe('activation_ended');

    await actY.update({ endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000) });
    const p2 = await makeVerifiedProspect(campY.id);
    const ok = await svc.issueForProspect(p2);
    expect(ok.reason).toBeNull();

    const skips = await ActivationIssuanceSkip.findAll({ where: { activationId: actY.id } });
    expect(skips.map((s) => s.reason)).toContain('activation_ended');
  });

  test('allocation exhaustion writes a skip row', async () => {
    const campM = await createTestCampaign(admin.user.id, { name: 'Gates Campaign M' });
    const actM = await makeActivation(campM.id, { allocatedQuantity: 1 });
    const p1 = await makeVerifiedProspect(campM.id);
    expect((await svc.issueForProspect(p1)).reason).toBeNull();
    const p2 = await makeVerifiedProspect(campM.id);
    const r = await svc.issueForProspect(p2);
    expect(r.reason).toBe('allocation_exhausted');

    const skips = await ActivationIssuanceSkip.findAll({ where: { activationId: actM.id } });
    expect(skips.map((s) => s.reason)).toContain('allocation_exhausted');
  });

  test('no active activation on the campaign: skip is recorded by CAMPAIGN and surfaces on the detail', async () => {
    const campZ = await createTestCampaign(admin.user.id, { name: 'Gates Campaign Z' });
    const prospect = await makeVerifiedProspect(campZ.id);
    const r = await svc.issueForProspect(prospect, { via: 'hook' });
    expect(r.reason).toBe('no_active_activation');

    const row = await ActivationIssuanceSkip.findOne({ where: { campaignId: campZ.id, reason: 'no_active_activation' } });
    expect(row).toBeTruthy();
    expect(row.activationId).toBeNull(); // nothing to attribute — the detached signature

    // A (draft) activation later created on that campaign sees the campaign-level rows.
    const actZ = await makeActivation(campZ.id, { status: 'draft' });
    const breakdown = await activations.getIssuanceSkips24h(actZ.id);
    expect(breakdown.find((b) => b.reason === 'no_active_activation')?.count).toBeGreaterThanOrEqual(1);
  });

  test('detail endpoint returns the 24h breakdown; purge honors retention', async () => {
    const campP = await createTestCampaign(admin.user.id, { name: 'Gates Campaign P' });
    const actP = await makeActivation(campP.id, { rewardOfferId: pausedOffer.id });
    const prospect = await makeVerifiedProspect(campP.id);
    await svc.issueForProspect(prospect);

    const res = await request(app)
      .get(`/api/redeem-ops/activations/${actP.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    const entry = (res.body.data.issuanceSkips24h || []).find((b) => b.reason === 'offer_not_active');
    expect(entry?.count).toBeGreaterThanOrEqual(1);

    // Retention: a >30d-old row is purged, recent rows survive.
    const old = await ActivationIssuanceSkip.create({
      campaignId: campP.id, activationId: actP.id, reason: 'offer_not_active', via: 'hook',
    });
    await sequelize.query(
      `UPDATE activation_issuance_skips SET "createdAt" = NOW() - INTERVAL '31 days' WHERE id = :id`,
      { replacements: { id: old.id } }
    );
    const removed = await svc.purgeIssuanceSkips();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await ActivationIssuanceSkip.findByPk(old.id)).toBeNull();
    expect(await ActivationIssuanceSkip.count({ where: { activationId: actP.id } })).toBeGreaterThanOrEqual(1);
  });
});

describe('linkage guard — live activations keep their campaign', () => {
  test('draft may link/unlink; every LIVE status is refused with the typed 409; HTTP surface agrees', async () => {
    const campL = await createTestCampaign(admin.user.id, { name: 'Gates Campaign L' });
    const act = await makeActivation(null, { status: 'draft', campaignNameSnapshot: null });

    // draft: link + unlink both fine
    await activations.linkCampaign(act.id, campL.id, admin.user);
    expect((await Activation.findByPk(act.id)).campaignId).toBe(campL.id);
    await activations.linkCampaign(act.id, null, admin.user);
    expect((await Activation.findByPk(act.id)).campaignId).toBeNull();
    await activations.linkCampaign(act.id, campL.id, admin.user); // re-link for the live tests

    for (const status of ['preparing', 'active', 'paused']) {
      await act.update({ status });
      await expect(activations.linkCampaign(act.id, null, admin.user))
        .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('complete or cancel') });
      await expect(activations.linkCampaign(act.id, campL.id, admin.user))
        .rejects.toMatchObject({ statusCode: 409 });
    }

    // HTTP surface: PATCH campaign on a live activation → 409
    const res = await request(app)
      .patch(`/api/redeem-ops/activations/${act.id}/campaign`)
      .set(auth(admin.token))
      .send({ campaignId: null });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/complete or cancel/i);

    // terminal states may unlink (cleanup is legitimate)
    await act.update({ status: 'completed' });
    await activations.linkCampaign(act.id, null, admin.user);
    expect((await Activation.findByPk(act.id)).campaignId).toBeNull();
  });
});
