/**
 * Void a REDEEMED reward (ops.redeem.sg RedemptionsPage "Void"): reversing the
 * redemption cancels the entitlement, which leaves the uq_re_activation_phone
 * partial-unique set (eligible/issued/redeemed) and FREES the one-live-reward-
 * per-phone slot so the number can earn a new reward on that activation.
 *
 * This pins the exact need behind Shawn's request: a redeemed entitlement on a
 * phone was un-removable (cancel is eligible/issued-only), stranding the slot.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  Prospect, RewardOffer, Activation, RewardEntitlement, Redemption, PartnerOrganisation,
} from '../src/models/index.js';
import { makeEntitlementService, phoneKeyOf } from '../src/services/redeemOps/entitlementService.js';
import { makeRedemptionService } from '../src/services/redeemOps/redemptionService.js';

const svc = makeEntitlementService();
const redemptions = makeRedemptionService();

let admin, agent;
let partner, offer, campaignA, activationA;
let phoneSeq = 95000000;
const freshPhone = () => `+65${phoneSeq++}`;

async function makeVerifiedProspect(phone, overrides = {}) {
  return Prospect.create({
    firstName: 'Void', lastName: 'Holder', phone,
    email: `void-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website', campaignId: campaignA.id, assignedAgentId: agent.user.id,
    sourceMetadata: { phoneVerifiedAt: new Date().toISOString() },
    ...overrides,
  });
}

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Void Test Studio', normalizedName: 'void test studio', createdBy: admin.user.id,
  });
  campaignA = await createTestCampaign(admin.user.id, { name: 'Void Campaign A' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Void Trial',
    committedQuantity: 200, allocatedQuantity: 150, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activationA = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignA.id,
    campaignNameSnapshot: campaignA.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
});

afterAll(async () => { await closeDb(); });

async function issueUnlockRedeem(phone) {
  const p = await makeVerifiedProspect(phone);
  // The raw presentation token is returned ONCE at issue (hashed at rest), so
  // read it off the issue RESULT, not the entitlement instance.
  const issued = await svc.issueForProspect(p);
  const unlock = await svc.unlockEntitlement({ presentationToken: issued.presentationToken }, admin.user, 'manual');
  await redemptions.complete(unlock.voucherToken, {}, admin.user);
  return issued.entitlement;
}

describe('void a redeemed reward frees the phone slot', () => {
  test('redeemed blocks a re-issue; voiding the redemption frees the slot', async () => {
    const phone = freshPhone();
    const first = await issueUnlockRedeem(phone);
    expect((await RewardEntitlement.findByPk(first.id)).status).toBe('redeemed');

    // Slot is pinned: a second signup on the same phone/activation is blocked.
    const p2 = await makeVerifiedProspect(phone, { campaignId: null });
    const blocked = await svc.issueForProspect(p2, { activationId: activationA.id });
    expect(blocked.reason).toBe('duplicate_phone');

    // Void = reverse the redemption (what the ops Void button calls).
    const redemption = await Redemption.findOne({ where: { entitlementId: first.id } });
    expect(redemption).toBeTruthy();
    await redemptions.reverse(redemption.id, admin.user, 'testing — free the slot');

    // Entitlement is now cancelled → outside the partial-unique set.
    expect((await RewardEntitlement.findByPk(first.id)).status).toBe('cancelled');
    expect((await Redemption.findByPk(redemption.id)).status).toBe('reversed');

    // The phone can earn a NEW reward on the same activation.
    const p3 = await makeVerifiedProspect(phone, { campaignId: null });
    const reissued = await svc.issueForProspect(p3, { activationId: activationA.id });
    expect(reissued.reason).toBeNull();
    expect(reissued.entitlement.activationId).toBe(activationA.id);
    expect(reissued.entitlement.phoneKey).toBe(phoneKeyOf(phone));
  });

  test('listEntitlements surfaces redemptionId on the redeemed row (drives the Void button)', async () => {
    const phone = freshPhone();
    const ent = await issueUnlockRedeem(phone);
    const { entitlements } = await svc.listEntitlements({ search: phone });
    const row = entitlements.find((r) => r.id === (ent.id));
    expect(row).toBeTruthy();
    expect(row.status).toBe('redeemed');
    expect(row.redemptionId).toBeTruthy();
    expect(row.redemptionReversed).toBe(false);
    // PII posture unchanged: phone masked, email stripped.
    expect(row.prospect.phone).toMatch(/^••••\d{4}$/);
    expect(row.prospect.email).toBeUndefined();
  });
});
