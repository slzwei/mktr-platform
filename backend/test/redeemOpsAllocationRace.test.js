/**
 * P1-2 regression: concurrent allocation edits must compose, not overwrite.
 *
 * changeAllocation() loaded the activation with no row lock and then wrote
 * `allocatedQuantity: activation.allocatedQuantity + delta` from that stale
 * in-memory value inside the transaction. Two concurrent ± calls read the same
 * base and the last writer won — the other delta vanished while its ledger row
 * stood. Because issuance gates on `issuedCount < allocatedQuantity`, an upward
 * drift lets the activation issue past its true allocation, and a downward one
 * silently strands supply.
 *
 * The race is deterministic here: the first caller's transaction is held open by
 * a slow injected audit writer, so the second caller's pre-transaction read is
 * guaranteed to observe the pre-change value.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import { RewardOffer, Activation, PartnerOrganisation } from '../src/models/index.js';
import { makeActivationService } from '../src/services/redeemOps/activationService.js';
import { makeRedeemOpsAuditService } from '../src/services/redeemOps/auditService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const activations = makeActivationService();

// Same service, but its transaction lingers — forcing the overlap instead of
// hoping for it.
const realAudit = makeRedeemOpsAuditService();
const slowActivations = makeActivationService({
  audit: {
    ...realAudit,
    recordAuditEvent: async (args) => {
      await sleep(300);
      return realAudit.recordAuditEvent(args);
    },
  },
});

let admin, partner, campaign;

async function makeOffer() {
  return RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Allocation Race Reward',
    committedQuantity: 500, allocatedQuantity: 100, issuedQuantity: 0,
    status: 'active', claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
}

async function makeActivation(offer, { allocatedQuantity, issuedCount = 0 }) {
  return Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: null,
    campaignNameSnapshot: campaign.name, allocatedQuantity, issuedCount,
    status: 'draft', unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
}

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Allocation Race Spa', normalizedName: 'allocation race spa', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Allocation Race Campaign' });
});

afterAll(async () => { await closeDb(); });

describe('concurrent changeAllocation', () => {
  test('two overlapping deltas both land (no last-writer-wins)', async () => {
    const offer = await makeOffer();
    const activation = await makeActivation(offer, { allocatedQuantity: 50 });

    await Promise.all([
      slowActivations.changeAllocation(activation.id, +5, admin.user, 'top up'),
      activations.changeAllocation(activation.id, -3, admin.user, 'trim'),
    ]);

    const row = await Activation.findByPk(activation.id);
    expect(row.allocatedQuantity).toBe(52); // 50 + 5 - 3, not 55 and not 47
  });

  test('the reduce that would cross issuedCount is refused on the fresh value', async () => {
    const offer = await makeOffer();
    // 10 allocated, 8 already issued — each reduce passes a STALE check on its
    // own, but only the first can pass against the row the other one leaves.
    const activation = await makeActivation(offer, { allocatedQuantity: 10, issuedCount: 8 });

    const [minusTwo, minusOne] = await Promise.allSettled([
      slowActivations.changeAllocation(activation.id, -2, admin.user, 'trim a'),
      activations.changeAllocation(activation.id, -1, admin.user, 'trim b'),
    ]);

    // Which reduce reaches the row first is up to the scheduler, so assert the
    // INVARIANT rather than a winner: exactly one lands, the other is refused
    // against the value the winner left, and the row never dips under its own
    // issued count. Pre-fix BOTH landed, which is what this catches.
    const results = [minusTwo, minusOne];
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.statusCode).toBe(409);
    expect(rejected[0].reason.message).toMatch(/below what has been issued/i);

    const acceptedReduce = minusTwo.status === 'fulfilled' ? 2 : 1;
    const row = await Activation.findByPk(activation.id);
    expect(row.allocatedQuantity).toBe(10 - acceptedReduce);
    expect(row.allocatedQuantity).toBeGreaterThanOrEqual(row.issuedCount);
  });

  test('a single reduce below issuedCount is still refused outright', async () => {
    const offer = await makeOffer();
    const activation = await makeActivation(offer, { allocatedQuantity: 10, issuedCount: 8 });

    await expect(activations.changeAllocation(activation.id, -5, admin.user, 'too far'))
      .rejects.toMatchObject({ statusCode: 409 });

    expect((await Activation.findByPk(activation.id)).allocatedQuantity).toBe(10);
  });

  test('a plain ± still moves the counter and reports the new value', async () => {
    const offer = await makeOffer();
    const activation = await makeActivation(offer, { allocatedQuantity: 20 });

    const up = await activations.changeAllocation(activation.id, +7, admin.user, 'more');
    expect(up.allocatedQuantity).toBe(27);

    const down = await activations.changeAllocation(activation.id, -4, admin.user, 'fewer');
    expect(down.allocatedQuantity).toBe(23);

    expect((await Activation.findByPk(activation.id)).allocatedQuantity).toBe(23);
  });
});
