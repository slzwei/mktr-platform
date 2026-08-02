/**
 * P2-7 regression: manual issue may not forge the phone-verification stamp.
 *
 * The stamp is SERVER-written and is the core anti-farming gate — one live
 * reward per verified phone. issueManual used to set
 * `phoneVerifiedAt: … || new Date()` onto the prospect JSON before issuing,
 * so a redemption_ops user minted live rewards for unverified phones as a side
 * effect of the ordinary call. Capability-gated and audited, yes — but nothing
 * in the request said "bypass verification" and nothing in the audit trail
 * recorded that it had happened. A silent bypass is not an authorized one.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  Prospect, RewardOffer, Activation, PartnerOrganisation, RedeemOpsAuditEvent,
} from '../src/models/index.js';
import { makeEntitlementService } from '../src/services/redeemOps/entitlementService.js';

const svc = makeEntitlementService();

let admin, agent, partner, campaign, activation;
let phoneSeq = 88000000;
const freshPhone = () => `+65${phoneSeq++}`;

/** `verified: false` = no server stamp — the state the gate exists to refuse. */
async function makeProspect({ verified }) {
  return Prospect.create({
    firstName: 'Manual', lastName: 'Issue', phone: freshPhone(),
    email: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website', campaignId: campaign.id, assignedAgentId: agent.user.id,
    sourceMetadata: verified ? { phoneVerifiedAt: new Date().toISOString() } : {},
  });
}

const auditFor = async (entitlementId) => RedeemOpsAuditEvent.findOne({
  where: { entityId: entitlementId, action: 'entitlement.issued_manual' },
});

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Manual Issue Studio', normalizedName: 'manual issue studio', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Manual Issue Campaign' });
  const offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Manual Issue Reward', status: 'active',
    committedQuantity: 200, allocatedQuantity: 150, claimExpiryDays: 30,
    redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activation = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign.id,
    campaignNameSnapshot: campaign.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
});

afterAll(async () => { await closeDb(); });

describe('manual issue respects the verification stamp by default', () => {
  it('REFUSES an unverified phone when no override is asked for', async () => {
    const prospect = await makeProspect({ verified: false });

    await expect(
      svc.issueManual({ activationId: activation.id, prospectId: prospect.id }, admin.user)
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('phone_not_verified') });
  });

  it('still issues normally for a genuinely verified phone', async () => {
    const prospect = await makeProspect({ verified: true });

    const result = await svc.issueManual(
      { activationId: activation.id, prospectId: prospect.id }, admin.user
    );

    expect(result.entitlement).toBeTruthy();
    const audit = await auditFor(result.entitlement.id);
    expect(audit.after.overrideVerification).toBe(false);
  });

  it('does not write a stamp onto a prospect that never had one', async () => {
    const prospect = await makeProspect({ verified: false });

    await svc.issueManual({ activationId: activation.id, prospectId: prospect.id }, admin.user)
      .catch(() => {});

    // The old code fabricated the stamp in the JSON it passed on; the row must
    // stay untouched either way, so a later hook/sweep still sees the truth.
    const row = await Prospect.findByPk(prospect.id);
    expect(row.sourceMetadata?.phoneVerifiedAt).toBeUndefined();
  });
});

describe('the override is explicit, reasoned and audited', () => {
  it('issues to an unverified phone WITH an override and records why', async () => {
    const prospect = await makeProspect({ verified: false });

    const result = await svc.issueManual({
      activationId: activation.id,
      prospectId: prospect.id,
      overrideVerification: true,
      overrideReason: 'verified by phone at the counter — OTP SMS never arrived',
    }, admin.user);

    expect(result.entitlement).toBeTruthy();

    const audit = await auditFor(result.entitlement.id);
    expect(audit.after.overrideVerification).toBe(true);
    expect(audit.after.overrideReason).toContain('OTP SMS never arrived');
    expect(audit.after.phoneWasVerified).toBe(false);
    expect(audit.reason).toContain('OTP SMS never arrived');
  });

  it('refuses an override with no reason — a bypass must be explainable', async () => {
    const prospect = await makeProspect({ verified: false });

    await expect(
      svc.issueManual({
        activationId: activation.id, prospectId: prospect.id, overrideVerification: true,
      }, admin.user)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/reason is required/i) });
  });

  it('marks the override false in the audit when the phone was verified anyway', async () => {
    const prospect = await makeProspect({ verified: true });

    const result = await svc.issueManual(
      { activationId: activation.id, prospectId: prospect.id }, admin.user
    );

    const audit = await auditFor(result.entitlement.id);
    expect(audit.after).toMatchObject({ overrideVerification: false });
    expect(audit.after.overrideReason).toBeUndefined();
  });
});
