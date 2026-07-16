/**
 * PR B — anti-farming: one LIVE reward per phone per activation
 * (docs/plans/trial-reward-funnel-hardening-prompt.md, migration 075).
 *
 * The hole being closed: the OTP marker lives ~10 min, so one human could
 * re-submit the signup form N times → N prospect rows → N entitlements, each
 * burning allocation for the whole reservation window. `phoneKey` +
 * uq_re_activation_phone (partial: eligible/issued/redeemed) make the DB the
 * authoritative guard; expired/cancelled rows free the slot.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  Prospect, RewardOffer, Activation, RewardEntitlement, PartnerOrganisation,
} from '../src/models/index.js';
import { makeEntitlementService, phoneKeyOf } from '../src/services/redeemOps/entitlementService.js';
import { makeRedemptionService } from '../src/services/redeemOps/redemptionService.js';

// Bare service: null notify deps — no emails, pure dedupe mechanics.
const svc = makeEntitlementService();
const redemptions = makeRedemptionService();

let admin, agent;
let partner, offer, campaignA, campaignB, activationA, activationB;

let phoneSeq = 90000000;
const freshPhone = () => `+65${phoneSeq++}`;

async function makeVerifiedProspect(phone, overrides = {}) {
  return Prospect.create({
    firstName: 'Dedupe',
    lastName: 'Holder',
    phone,
    email: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website',
    campaignId: campaignA.id,
    assignedAgentId: agent.user.id,
    sourceMetadata: { phoneVerifiedAt: new Date().toISOString() },
    ...overrides,
  });
}

beforeAll(async () => {
  await getApp(); // boots the DB schema (models → sync in test mode)
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });

  partner = await PartnerOrganisation.create({
    tradingName: 'Dedupe Test Studio', normalizedName: 'dedupe test studio', createdBy: admin.user.id,
  });
  campaignA = await createTestCampaign(admin.user.id, { name: 'Dedupe Campaign A' });
  campaignB = await createTestCampaign(admin.user.id, { name: 'Dedupe Campaign B' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Dedupe Trial',
    committedQuantity: 200, allocatedQuantity: 150, status: 'active',
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
});

afterAll(async () => {
  await closeDb();
});

describe('phoneKeyOf', () => {
  test('normalizes to digits and rejects junk', () => {
    expect(phoneKeyOf('+6591234567')).toBe('6591234567');
    expect(phoneKeyOf('+65 9123 4567')).toBe('6591234567');
    expect(phoneKeyOf(null)).toBeNull();
    expect(phoneKeyOf('abc')).toBeNull();
    expect(phoneKeyOf('123')).toBeNull(); // too short to be a phone
  });
});

describe('one live reward per phone per activation', () => {
  test('second signup with the same phone collapses to the FIRST entitlement', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const p2 = await makeVerifiedProspect(phone); // same human, second form submit

    const first = await svc.issueForProspect(p1);
    expect(first.reason).toBeNull();
    expect(first.entitlement.phoneKey).toBe(phoneKeyOf(phone));

    const second = await svc.issueForProspect(p2);
    expect(second.reason).toBe('duplicate_phone');
    expect(second.entitlement.id).toBe(first.entitlement.id); // points at the winner

    const rows = await RewardEntitlement.findAll({
      where: { activationId: activationA.id, phoneKey: phoneKeyOf(phone) },
    });
    expect(rows).toHaveLength(1);
  });

  test('CONCURRENT same-phone signups → exactly one entitlement (DB index is the guard)', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const p2 = await makeVerifiedProspect(phone);

    const [a, b] = await Promise.all([
      svc.issueForProspect(p1),
      svc.issueForProspect(p2),
    ]);
    const fresh = [a, b].filter((r) => r.reason === null);
    const blocked = [a, b].filter((r) => r.reason === 'duplicate_phone');
    expect(fresh).toHaveLength(1);
    expect(blocked).toHaveLength(1);

    const rows = await RewardEntitlement.findAll({
      where: { activationId: activationA.id, phoneKey: phoneKeyOf(phone) },
    });
    expect(rows).toHaveLength(1);

    // Loser's rolled-back transaction must not have leaked counters:
    // issuedCount reflects exactly the winners.
    const act = await Activation.findByPk(activationA.id);
    const live = await RewardEntitlement.count({ where: { activationId: activationA.id } });
    expect(act.issuedCount).toBe(live);
  });

  test('an EXPIRED reservation frees the slot for the same phone', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const first = await svc.issueForProspect(p1);
    expect(first.reason).toBeNull();

    await RewardEntitlement.update(
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { id: first.entitlement.id } }
    );
    await svc.expireReservations();
    expect((await RewardEntitlement.findByPk(first.entitlement.id)).status).toBe('expired');

    const p2 = await makeVerifiedProspect(phone);
    const second = await svc.issueForProspect(p2);
    expect(second.reason).toBeNull(); // slot freed
    expect(second.entitlement.id).not.toBe(first.entitlement.id);
  });

  test('a CANCELLED entitlement frees the slot', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const first = await svc.issueForProspect(p1);
    await svc.cancelEntitlement(first.entitlement.id, admin.user, 'dedupe test');

    const p2 = await makeVerifiedProspect(phone);
    const second = await svc.issueForProspect(p2);
    expect(second.reason).toBeNull();
  });

  test('a REDEEMED reward still blocks the phone (no farm-after-redeem)', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const first = await svc.issueForProspect(p1);
    const unlock = await svc.unlockEntitlement({ presentationToken: first.presentationToken }, admin.user, 'manual');
    await redemptions.complete(unlock.voucherToken, {}, admin.user);
    expect((await RewardEntitlement.findByPk(first.entitlement.id)).status).toBe('redeemed');

    const p2 = await makeVerifiedProspect(phone);
    const second = await svc.issueForProspect(p2);
    expect(second.reason).toBe('duplicate_phone');
  });

  test('a different activation is unaffected by the same phone', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    const onA = await svc.issueForProspect(p1);
    expect(onA.reason).toBeNull();

    const p2 = await makeVerifiedProspect(phone, { campaignId: campaignB.id });
    const onB = await svc.issueForProspect(p2);
    expect(onB.reason).toBeNull();
    expect(onB.entitlement.activationId).toBe(activationB.id);
  });
});

describe('no-phone rules', () => {
  test('hook/sweep issuance without a phone is refused (dedupe bypass guard)', async () => {
    const p = await makeVerifiedProspect(null);
    const r = await svc.issueForProspect(p, { via: 'hook' });
    expect(r.entitlement).toBeNull();
    expect(r.reason).toBe('no_phone');
  });

  test('manual issue without a phone is allowed, and NULL keys never collide', async () => {
    const p1 = await makeVerifiedProspect(null);
    const p2 = await makeVerifiedProspect(null);
    const first = await svc.issueManual({ activationId: activationA.id, prospectId: p1.id }, admin.user);
    expect(first.entitlement.phoneKey).toBeNull();
    const second = await svc.issueManual({ activationId: activationA.id, prospectId: p2.id }, admin.user);
    expect(second.entitlement.phoneKey).toBeNull(); // no unique violation
  });

  test('manual issue for a phone that already holds a live reward → typed 409', async () => {
    const phone = freshPhone();
    const p1 = await makeVerifiedProspect(phone);
    await svc.issueForProspect(p1);

    const p2 = await makeVerifiedProspect(phone);
    await expect(
      svc.issueManual({ activationId: activationA.id, prospectId: p2.id }, admin.user)
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('duplicate_phone') });
  });
});
