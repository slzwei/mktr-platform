/**
 * Phase 6 — entitlements + redemptions (brief §37 Entitlements and redemption).
 * The battery: anti-farming precondition, reservation→unlock→redeem lifecycle,
 * wrong-consultant 403, reservation-pass-at-counter rejection, DOUBLE REDEMPTION
 * impossible + idempotent replay, expiry returns inventory, hook is inert for
 * capture (registration is composition-root-only).
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true'; // mounts /api/reward-claim + unlock surfaces

import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  Prospect, RewardOffer, Activation, RewardEntitlement, Redemption,
  PartnerOrganisation,
} from '../src/models/index.js';
import { makeEntitlementService } from '../src/services/redeemOps/entitlementService.js';
import { makeRedemptionService } from '../src/services/redeemOps/redemptionService.js';
import { registerLeadCapturedHook } from '../src/services/prospectService.js';

let app;
let admin, agentA, agentB, redemptionOps;
let partner, offer, activation, campaign;

const entitlements = makeEntitlementService();
const redemptions = makeRedemptionService();

async function makeVerifiedProspect(overrides = {}) {
  return Prospect.create({
    firstName: 'Voucher',
    lastName: 'Holder',
    phone: `+65${Math.floor(80000000 + Math.random() * 9999999)}`,
    email: `holder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    leadSource: 'website',
    campaignId: campaign.id,
    assignedAgentId: agentA.user.id,
    sourceMetadata: { phoneVerifiedAt: new Date().toISOString() },
    ...overrides,
  });
}

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  agentA = await createTestUser({ role: 'agent' });
  agentB = await createTestUser({ role: 'agent' });
  redemptionOps = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'redemption_ops' });

  partner = await PartnerOrganisation.create({
    tradingName: 'Fulfilment Test Salon', normalizedName: 'fulfilment test salon', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Fulfilment Campaign' });

  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Express Manicure',
    committedQuantity: 10, allocatedQuantity: 5, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
    externalBookingUrl: 'https://booking.example.com/trial',
  });
  activation = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign.id,
    campaignNameSnapshot: campaign.name, allocatedQuantity: 5, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });
});

afterAll(async () => {
  registerLeadCapturedHook(null);
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('issuance preconditions (anti-farming)', () => {
  test('an UNVERIFIED lead never earns an entitlement', async () => {
    const prospect = await makeVerifiedProspect({ sourceMetadata: {} });
    const r = await entitlements.issueForProspect(prospect);
    expect(r.entitlement).toBeNull();
    expect(r.reason).toBe('phone_not_verified');
  });

  test('quarantined leads never earn one', async () => {
    const prospect = await makeVerifiedProspect({ quarantinedAt: new Date(), quarantineReason: 'no_funded_agent' });
    const r = await entitlements.issueForProspect(prospect);
    expect(r.reason).toBe('quarantined');
  });

  test('verified lead on the active activation → locked reservation; duplicate issuance collapses to one', async () => {
    const prospect = await makeVerifiedProspect();
    const [a, b] = await Promise.all([
      entitlements.issueForProspect(prospect, { via: 'hook' }),
      entitlements.issueForProspect(prospect, { via: 'sweep' }),
    ]);
    const issued = [a, b].filter((r) => r.entitlement && r.reason === null);
    const dupes = [a, b].filter((r) => r.reason === 'duplicate' || r.reason === 'allocation_exhausted');
    expect(issued.length + dupes.length).toBe(2);
    expect(issued.length).toBeGreaterThanOrEqual(1);

    const rows = await RewardEntitlement.findAll({ where: { prospectId: prospect.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('eligible'); // agent_unlock → locked, no voucher yet
    expect(rows[0].tokenHash).toBeNull();
  });
});

describe('unlock at the meeting', () => {
  let prospect, issueResult;

  beforeAll(async () => {
    prospect = await makeVerifiedProspect();
    issueResult = await entitlements.issueForProspect(prospect);
    expect(issueResult.reason).toBeNull();
  });

  test('reservation pass at the counter (pre-unlock) → typed rejection', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/redemptions/verify')
      .set(auth(redemptionOps.token))
      .send({ token: issueResult.presentationToken });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('reservation pass');
  });

  test('the WRONG consultant cannot unlock', async () => {
    await expect(
      entitlements.unlockEntitlement({ presentationToken: issueResult.presentationToken }, agentB.user)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('assigned consultant unlocks (scan); replay is idempotent', async () => {
    const first = await entitlements.unlockEntitlement(
      { presentationToken: issueResult.presentationToken }, agentA.user, 'agent_scan'
    );
    expect(first.already).toBe(false);
    expect(first.voucherToken).toBeTruthy();
    expect(first.entitlement.status).toBe('issued');
    expect(first.entitlement.unlockedByUserId).toBe(agentA.user.id);

    const replay = await entitlements.unlockEntitlement(
      { presentationToken: issueResult.presentationToken }, agentA.user, 'agent_scan'
    );
    expect(replay.already).toBe(true);

    // stash for redemption tests
    prospect._voucherToken = first.voucherToken;
    globalThis.__voucher = first.voucherToken;
    globalThis.__presentation = issueResult.presentationToken;
  });

  test('verify now unmasks holder + shows VALID; post-unlock the presentation token also verifies', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/redemptions/verify')
      .set(auth(redemptionOps.token))
      .send({ token: globalThis.__voucher });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.holder.firstName).toBe('Voucher');

    const viaPass = await request(app)
      .post('/api/redeem-ops/redemptions/verify')
      .set(auth(redemptionOps.token))
      .send({ token: globalThis.__presentation });
    expect(viaPass.status).toBe(200);
    expect(viaPass.body.data.valid).toBe(true);
  });
});

describe('redemption — exactly once', () => {
  test('CONCURRENT completes → one redemption row; replays return already:true', async () => {
    const results = await Promise.all([
      redemptions.complete(globalThis.__voucher, {}, redemptionOps.user),
      redemptions.complete(globalThis.__voucher, {}, redemptionOps.user),
      redemptions.complete(globalThis.__presentation, {}, redemptionOps.user),
    ]);
    const fresh = results.filter((r) => !r.already);
    expect(fresh).toHaveLength(1);

    const rows = await Redemption.findAll({ where: { entitlementId: results[0].redemption.entitlementId } });
    expect(rows).toHaveLength(1);

    const viaHttp = await request(app)
      .post('/api/redeem-ops/redemptions/complete')
      .set(auth(redemptionOps.token))
      .send({ token: globalThis.__voucher });
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body.data.already).toBe(true);

    await offer.reload();
    expect(offer.redeemedQuantity).toBe(1);
  });

  test('garbage tokens are rejected server-side', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/redemptions/verify')
      .set(auth(redemptionOps.token))
      .send({ token: 'not-a-real-token-000000' });
    expect(res.status).toBe(404);
  });
});

describe('expiry returns inventory', () => {
  test('expired reservation → status expired, issued counters roll back', async () => {
    const prospect = await makeVerifiedProspect();
    const r = await entitlements.issueForProspect(prospect);
    expect(r.reason).toBeNull();
    await RewardEntitlement.update(
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { id: r.entitlement.id } }
    );
    const before = (await Activation.findByPk(activation.id)).issuedCount;
    const expired = await entitlements.expireReservations();
    expect(expired).toBeGreaterThanOrEqual(1);

    const row = await RewardEntitlement.findByPk(r.entitlement.id);
    expect(row.status).toBe('expired');
    const after = (await Activation.findByPk(activation.id)).issuedCount;
    expect(after).toBe(before - 1);
  });
});

describe('public consumer claim endpoint', () => {
  test('renders reservation state, then voucher state on the SAME link', async () => {
    const prospect = await makeVerifiedProspect();
    const r = await entitlements.issueForProspect(prospect);
    expect(r.reason).toBeNull();

    const locked = await request(app).get(`/api/reward-claim/${r.presentationToken}`);
    expect(locked.status).toBe(200);
    expect(locked.body.data.state).toBe('reserved');
    expect(locked.body.data.pass.qrDataUrl).toContain('data:image/png');
    // Pre-review the pass must NOT push booking (guardrail: step 1 of 2).
    expect(locked.body.data.bookingUrl).toBeUndefined();

    await entitlements.unlockEntitlement({ presentationToken: r.presentationToken }, agentA.user);
    const unlocked = await request(app).get(`/api/reward-claim/${r.presentationToken}`);
    expect(unlocked.body.data.state).toBe('unlocked');
    expect(unlocked.body.data.voucher.qrDataUrl).toContain('data:image/png');
    // Guardrail #3 (PR D): the voucher tells the prospect how to book.
    expect(unlocked.body.data.bookingUrl).toBe('https://booking.example.com/trial');
  });
});

describe('capture-hook seam', () => {
  test('prospectService exposes the registry; unregistered = no-op (capture unaffected)', async () => {
    const mod = await import('../src/services/prospectService.js');
    expect(typeof mod.registerLeadCapturedHook).toBe('function');
    expect(typeof mod.makeProspectService).toBe('function');
    // Registering and clearing must never throw — the default dep is null-safe.
    mod.registerLeadCapturedHook(() => {});
    mod.registerLeadCapturedHook(null);
  });
});
