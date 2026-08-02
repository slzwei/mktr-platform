/**
 * P1-1 regression: two concurrent voids of ONE redemption must move inventory
 * exactly once.
 *
 * reverse() reads the redemption and checks `status === 'reversed'` OUTSIDE its
 * transaction, so both callers pass that check. Before the fix the flip itself
 * was an unconditional `redemption.update({status:'reversed'})` — no WHERE
 * guard, no rowcount check — so both bodies ran and both called
 * reverseRedeemed/reverseIssued, which guard on the offer's AGGREGATE counters
 * and cannot see that this particular redemption was already given back. Result:
 * a handover reversed once, counters credited twice.
 *
 * The race is made deterministic by holding the winning transaction open (a slow
 * injected audit writer) so the loser's pre-transaction read is guaranteed to
 * observe 'completed'.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import { randomBytes } from 'crypto';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  RewardOffer, Activation, RewardEntitlement, Redemption, RedemptionEvent,
  RewardInventoryEvent, PartnerOrganisation,
} from '../src/models/index.js';
import { makeRedemptionService } from '../src/services/redeemOps/redemptionService.js';
import { makeRedeemOpsAuditService } from '../src/services/redeemOps/auditService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const redemptions = makeRedemptionService();

// A service whose transaction stays open long enough for the second caller to
// read the still-'completed' row — the exact interleaving the fix must survive.
const realAudit = makeRedeemOpsAuditService();
const slowRedemptions = makeRedemptionService({
  audit: {
    ...realAudit,
    recordAuditEvent: async (args) => {
      await sleep(300);
      return realAudit.recordAuditEvent(args);
    },
  },
});

let admin, agent, partner, campaign, offer, activation;
let phoneSeq = 100000;

/** A handover redemption sitting on an offer with counter headroom, so a double
 *  reverse is arithmetically POSSIBLE — otherwise the guards mask the bug. */
async function makeHandoverRedemption() {
  const entitlement = await RewardEntitlement.create({
    rewardOfferId: offer.id, activationId: activation.id,
    partnerOrganisationId: partner.id, status: 'redeemed',
    phoneKey: `6590${String(phoneSeq++).padStart(6, '0')}`,
    presentationTokenHash: randomBytes(32).toString('hex'),
  });
  const redemption = await Redemption.create({
    entitlementId: entitlement.id, rewardOfferId: offer.id, activationId: activation.id,
    partnerOrganisationId: partner.id, method: 'agent_handover',
    actorType: 'staff', actorUserId: agent.user.id, status: 'completed',
  });
  return { entitlement, redemption };
}

const offerRow = async () => RewardOffer.findByPk(offer.id);

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Reverse Race Studio', normalizedName: 'reverse race studio', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Reverse Race Campaign' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Race Handover Voucher',
    committedQuantity: 200, allocatedQuantity: 150, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
    // Headroom on BOTH counters: reverseRedeemed needs redeemedQuantity >= 1 and
    // reverseIssued needs issuedQuantity - 1 >= redeemedQuantity, so with these
    // totals a second (wrong) reversal succeeds instead of being masked.
    issuedQuantity: 20, redeemedQuantity: 10,
  });
  activation = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign.id,
    campaignNameSnapshot: campaign.name, allocatedQuantity: 60, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
    issuedCount: 20, redeemedCount: 10,
  });
});

afterAll(async () => { await closeDb(); });

describe('concurrent reverse of one redemption', () => {
  test('moves inventory exactly once and answers the loser idempotently', async () => {
    const { entitlement, redemption } = await makeHandoverRedemption();
    const before = await offerRow();

    const [winner, loser] = await Promise.all([
      slowRedemptions.reverse(redemption.id, admin.user, 'first void — the real one'),
      redemptions.reverse(redemption.id, admin.user, 'second void — same click, twice'),
    ]);

    // Both callers get the reversed row; neither throws.
    expect(winner.status).toBe('reversed');
    expect(loser.status).toBe('reversed');
    expect(winner.id).toBe(redemption.id);
    expect(loser.id).toBe(redemption.id);

    // Counters moved ONCE — this is what double-reversing corrupted.
    const after = await offerRow();
    expect(after.redeemedQuantity).toBe(before.redeemedQuantity - 1);
    expect(after.issuedQuantity).toBe(before.issuedQuantity - 1);

    // ...and the ledger says so too: one give-back of each kind, not two.
    const ledger = await RewardInventoryEvent.findAll({ where: { entitlementId: entitlement.id } });
    expect(ledger.filter((e) => e.type === 'redeem_reversed')).toHaveLength(1);
    expect(ledger.filter((e) => e.type === 'cancelled')).toHaveLength(1);

    const events = await RedemptionEvent.findAll({ where: { redemptionId: redemption.id, type: 'reversed' } });
    expect(events).toHaveLength(1);

    expect((await RewardEntitlement.findByPk(entitlement.id)).status).toBe('cancelled');
    expect((await Redemption.findByPk(redemption.id)).status).toBe('reversed');

    const activationRow = await Activation.findByPk(activation.id);
    expect(activationRow.redeemedCount).toBe(10 - 1);
    expect(activationRow.issuedCount).toBe(20 - 1);
  });

  test('a sequential second void stays a no-op (unchanged behaviour)', async () => {
    const { redemption } = await makeHandoverRedemption();

    await redemptions.reverse(redemption.id, admin.user, 'void it');
    const mid = await offerRow();
    const again = await redemptions.reverse(redemption.id, admin.user, 'void it again');
    const after = await offerRow();

    expect(again.status).toBe('reversed');
    expect(after.redeemedQuantity).toBe(mid.redeemedQuantity);
    expect(after.issuedQuantity).toBe(mid.issuedQuantity);
  });

  test('a genuine single void still gives both counters back', async () => {
    const { entitlement, redemption } = await makeHandoverRedemption();
    const before = await offerRow();

    const result = await redemptions.reverse(redemption.id, admin.user, 'mis-tap');

    const after = await offerRow();
    expect(result.status).toBe('reversed');
    expect(result.notes).toContain('REVERSED: mis-tap');
    expect(after.redeemedQuantity).toBe(before.redeemedQuantity - 1);
    expect(after.issuedQuantity).toBe(before.issuedQuantity - 1);
    expect((await RewardEntitlement.findByPk(entitlement.id)).status).toBe('cancelled');
  });
});
