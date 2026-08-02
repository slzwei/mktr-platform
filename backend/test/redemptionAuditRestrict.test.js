/**
 * P2-17 regression: the redemption audit trail outlives its subject.
 *
 * RedemptionEvent's own header calls it "Append-only fulfilment history", but
 * both its foreign keys were ON DELETE CASCADE — so deleting an entitlement
 * silently took its audit trail with it. An append-only record that disappears
 * when its subject does is not a record.
 *
 * RESTRICT is the same choice migration 102 made for reward_inventory_events:
 * the history has to survive, or it cannot answer the question it exists for.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true';

import { randomBytes } from 'crypto';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  RewardOffer, Activation, RewardEntitlement, RedemptionEvent, PartnerOrganisation, sequelize,
} from '../src/models/index.js';

let admin, partner, campaign, offer, activation;
let phoneSeq = 77000000;

async function entitlementWithHistory() {
  const entitlement = await RewardEntitlement.create({
    rewardOfferId: offer.id, activationId: activation.id,
    partnerOrganisationId: partner.id, status: 'issued',
    phoneKey: `6590${String(phoneSeq++).padStart(6, '0')}`,
    presentationTokenHash: randomBytes(32).toString('hex'),
  });
  const event = await RedemptionEvent.create({
    entitlementId: entitlement.id, type: 'unlocked', actorType: 'staff',
  });
  return { entitlement, event };
}

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Audit Restrict Spa', normalizedName: 'audit restrict spa', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Audit Restrict Campaign' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Audit Restrict Reward', status: 'active',
    committedQuantity: 100, allocatedQuantity: 50, claimExpiryDays: 30,
    redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activation = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign.id,
    campaignNameSnapshot: campaign.name, allocatedQuantity: 20, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
});

afterAll(async () => { await closeDb(); });

describe('deleting an entitlement cannot erase its history', () => {
  it('is REFUSED while redemption events reference it', async () => {
    const { entitlement } = await entitlementWithHistory();

    await expect(entitlement.destroy()).rejects.toThrow(/foreign key constraint/i);
  });

  it('leaves both the entitlement and its events intact after the refusal', async () => {
    const { entitlement, event } = await entitlementWithHistory();

    await entitlement.destroy().catch(() => {});

    expect(await RewardEntitlement.findByPk(entitlement.id)).not.toBeNull();
    expect(await RedemptionEvent.findByPk(event.id)).not.toBeNull();
  });

  it('allows the delete once the history is deliberately cleared first', async () => {
    // What partnerService's admin-gated force-purge does: clear the audit rows
    // explicitly, then delete. RESTRICT stops the INCIDENTAL delete, not this.
    const { entitlement, event } = await entitlementWithHistory();

    await RedemptionEvent.destroy({ where: { entitlementId: entitlement.id } });
    await expect(entitlement.destroy()).resolves.toBeDefined();

    expect(await RedemptionEvent.findByPk(event.id)).toBeNull();
    expect(await RewardEntitlement.findByPk(entitlement.id)).toBeNull();
  });

  it('an entitlement with no history still deletes freely', async () => {
    const entitlement = await RewardEntitlement.create({
      rewardOfferId: offer.id, activationId: activation.id,
      partnerOrganisationId: partner.id, status: 'issued',
      phoneKey: `6590${String(phoneSeq++).padStart(6, '0')}`,
      presentationTokenHash: randomBytes(32).toString('hex'),
    });

    await expect(entitlement.destroy()).resolves.toBeDefined();
  });
});

describe('schema', () => {
  it('both redemption_events foreign keys are ON DELETE RESTRICT', async () => {
    const [rows] = await sequelize.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'redemption_events'::regclass AND contype = 'f'
    `);
    const refs = rows.map((r) => r.def);

    const entitlementFk = refs.find((d) => d.includes('entitlementId'));
    const redemptionFk = refs.find((d) => d.includes('redemptionId'));

    expect(entitlementFk).toMatch(/ON DELETE RESTRICT/);
    expect(redemptionFk).toMatch(/ON DELETE RESTRICT/);
    // ...and specifically NOT the cascade this task removed.
    for (const def of refs) expect(def).not.toMatch(/ON DELETE CASCADE/);
  });
});
