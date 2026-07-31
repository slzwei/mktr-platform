/**
 * P1-5 — unique-violation RECOVERY reads must match the index that fired,
 * EXACTLY. Both issuance uniques are per-activation; the old recovery lookups
 * dropped activationId, so a person legitimately holding live rewards on two
 * activations got back whichever row sorted first (createdAt DESC) — possibly
 * a DIFFERENT activation's entitlement.
 *
 * Real Postgres + the real partial indexes (the sync()-built test DB lacks
 * migration indexes, so beforeAll applies the exact DDL from migrations
 * 050/075). Only the race window is simulated: a one-shot proxy makes the UX
 * pre-check miss so the INSERT genuinely fires the constraint and the catch
 * path runs for real.
 */
import crypto from 'crypto';

let closeDb, createTestUser, createTestCampaign;
let Prospect, RewardOffer, Activation, RewardEntitlement, PartnerOrganisation, sequelize;
let makeEntitlementService;

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const PHONE_A = '+6591230001'; // shared across both activations (test 1)
const PHONE_X = '+6591230002'; // anchor-collision prospect (test 2)

let admin, partner, offer, campaignA, campaignB, activationA, activationB;
let suppressPhonePrecheck = 0;
let suppressAnchorPrecheck = 0;
let svc;

const hex = () => crypto.randomBytes(24).toString('hex');
const stamp = () => ({ phoneVerifiedAt: new Date().toISOString() });

async function seedEntitlement(activation, prospect, overrides = {}) {
  return RewardEntitlement.create({
    rewardOfferId: offer.id,
    activationId: activation.id,
    prospectId: prospect.id,
    status: 'eligible',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    presentationTokenHash: hex(),
    issuedVia: 'hook',
    phoneKey: String(prospect.phone).replace(/\D/g, ''),
    ...overrides,
  });
}

/** Backdate via raw SQL — Sequelize silently drops createdAt in updates. */
async function backdate(entitlementId, minutes) {
  await sequelize.query(
    `UPDATE reward_entitlements SET "createdAt" = NOW() - INTERVAL '${minutes} minutes' WHERE id = :id`,
    { replacements: { id: entitlementId } }
  );
}

beforeAll(async () => {
  const helpers = await import('./helpers.js');
  ({ closeDb, createTestUser, createTestCampaign } = helpers);
  await helpers.getApp();
  ({ Prospect, RewardOffer, Activation, RewardEntitlement, PartnerOrganisation, sequelize } =
    await import('../src/models/index.js'));
  ({ makeEntitlementService } = await import('../src/services/redeemOps/entitlementService.js'));

  // The authoritative guards under test — exact DDL from migrations 050 + 075.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_re_activation_prospect
       ON reward_entitlements ("activationId", "prospectId") WHERE "prospectId" IS NOT NULL`
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_re_activation_phone
       ON reward_entitlements ("activationId", "phoneKey")
       WHERE "phoneKey" IS NOT NULL AND status IN ('eligible','issued','redeemed')`
  );

  admin = await createTestUser({ role: 'admin' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Recovery Test Studio', normalizedName: 'recovery test studio', createdBy: admin.user.id,
  });
  campaignA = await createTestCampaign(admin.user.id, { name: 'Recovery A' });
  campaignB = await createTestCampaign(admin.user.id, { name: 'Recovery B' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Trial Session',
    committedQuantity: 100, allocatedQuantity: 80, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activationA = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignA.id,
    campaignNameSnapshot: campaignA.name, allocatedQuantity: 20, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
  activationB = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaignB.id,
    campaignNameSnapshot: campaignB.name, allocatedQuantity: 20, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });

  // One-shot race window: the UX pre-checks miss ONCE so the insert genuinely
  // collides with the index; every other read (incl. the recovery lookup under
  // test) passes straight through to the real model.
  const RewardEntitlementProxy = {
    findOne: async (opts) => {
      const w = opts?.where || {};
      if (suppressPhonePrecheck > 0 && w.phoneKey && w.activationId && !w.prospectId) {
        suppressPhonePrecheck -= 1;
        return null;
      }
      if (suppressAnchorPrecheck > 0 && w.prospectId && w.activationId && !w.phoneKey) {
        suppressAnchorPrecheck -= 1;
        return null;
      }
      return RewardEntitlement.findOne(opts);
    },
    create: (...a) => RewardEntitlement.create(...a),
  };

  svc = makeEntitlementService({
    RewardEntitlement: RewardEntitlementProxy,
    inventory: { recordIssued: async () => {} },
    drawLink: { drawContextForActivation: async () => null },
    notifyUnlock: null, notifyReservation: null, notifyUnlockWa: null, notifyReservationWa: null,
    logger: silentLogger,
  });
}, 30000);

afterAll(async () => {
  await closeDb();
});

describe('uq_re_activation_phone recovery — same phone live on TWO activations', () => {
  it('returns activation B\'s row when B\'s constraint fires, not A\'s newer one', async () => {
    // Activation B's winner (OLDER) — the row the constraint defends. Its
    // prospect holds a different number today (prospects are unique per
    // (campaignId, phone), and entitlement phoneKeys are stamped at issuance —
    // a later staff phone edit leaves the key behind), but the ENTITLEMENT
    // carries the contested phoneKey, which is what uq_re_activation_phone
    // guards.
    const holderB = await Prospect.create({
      firstName: 'B', lastName: 'Holder', phone: '+6591230009', email: `b-${Date.now()}@t.co`,
      leadSource: 'website', campaignId: campaignB.id, sourceMetadata: stamp(),
    });
    const entB = await seedEntitlement(activationB, holderB, { phoneKey: PHONE_A.replace(/\D/g, '') });
    await backdate(entB.id, 60);

    // Activation A's legitimate live reward for the SAME phone (NEWER) — the
    // decoy the unscoped createdAt-DESC lookup used to return.
    const holderA = await Prospect.create({
      firstName: 'A', lastName: 'Holder', phone: PHONE_A, email: `a-${Date.now()}@t.co`,
      leadSource: 'website', campaignId: campaignA.id, sourceMetadata: stamp(),
    });
    const entA = await seedEntitlement(activationA, holderA);

    // Read-back: the decoy really is newer (raw-SQL backdate is load-bearing).
    await entB.reload();
    await entA.reload();
    expect(new Date(entA.createdAt).getTime()).toBeGreaterThan(new Date(entB.createdAt).getTime());

    // A concurrent same-phone signup on B: pre-check misses (race window),
    // the INSERT fires uq_re_activation_phone, recovery must return B's row.
    const racer = await Prospect.create({
      firstName: 'Racer', lastName: 'B', phone: PHONE_A, email: `r-${Date.now()}@t.co`,
      leadSource: 'website', campaignId: campaignB.id, sourceMetadata: stamp(),
    });
    suppressPhonePrecheck = 1;
    const res = await svc.issueForProspect(racer, { via: 'hook' });

    expect(suppressPhonePrecheck).toBe(0); // the race window was actually consumed
    expect(res.reason).toBe('duplicate_phone');
    expect(res.entitlement).toBeTruthy();
    expect(res.entitlement.activationId).toBe(activationB.id); // NOT activation A's newer row
    expect(res.entitlement.id).toBe(entB.id);

    // The failed insert's counter increment rolled back with the transaction.
    await activationB.reload();
    expect(activationB.issuedCount).toBe(0);
  }, 30000);
});

describe('(activationId, prospectId) anchor recovery — same prospect on TWO activations', () => {
  it('returns THIS activation\'s row when the anchor fires, not the other activation\'s newer one', async () => {
    const prospectX = await Prospect.create({
      firstName: 'X', lastName: 'Anchor', phone: PHONE_X, email: `x-${Date.now()}@t.co`,
      leadSource: 'website', campaignId: campaignB.id, sourceMetadata: stamp(),
    });

    // X's row on B (OLDER, non-live so the phone pre-check misses naturally —
    // the anchor index has no status predicate and still fires).
    const entXB = await seedEntitlement(activationB, prospectX, { status: 'claim_expired' });
    await backdate(entXB.id, 60);

    // X's decoy on A (NEWER) — what the unscoped { prospectId } lookup returned.
    const entXA = await seedEntitlement(activationA, prospectX, { status: 'claim_expired' });
    await entXB.reload();
    await entXA.reload();
    expect(new Date(entXA.createdAt).getTime()).toBeGreaterThan(new Date(entXB.createdAt).getTime());

    // Anchor pre-check misses once → INSERT fires uq_re_activation_prospect on B.
    suppressAnchorPrecheck = 1;
    const res = await svc.issueForProspect(prospectX, { via: 'hook' });

    expect(suppressAnchorPrecheck).toBe(0);
    expect(res.reason).toBe('duplicate');
    expect(res.entitlement).toBeTruthy();
    expect(res.entitlement.activationId).toBe(activationB.id);
    expect(res.entitlement.id).toBe(entXB.id);
  }, 30000);
});
