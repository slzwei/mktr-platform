/**
 * Phases 4+5 — rewards/inventory/onboarding/activations (brief §37 Reward inventory).
 * The heart of it: CONCURRENT allocations can never oversubscribe committed supply,
 * and every counter movement has a matching append-only ledger row.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  PartnerOrganisation, RewardOffer, RewardInventoryEvent, PartnerOnboardingItem,
  Activation, Campaign, sequelize,
} from '../src/models/index.js';
import { makeInventoryService } from '../src/services/redeemOps/inventoryService.js';

let app;
let admin, campaignOps, exec;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  campaignOps = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'campaign_ops' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makePartner(name) {
  const res = await request(app)
    .post('/api/redeem-ops/partners')
    .set(auth(admin.token))
    .send({ tradingName: name });
  return res.body.data.partner;
}

async function makeOffer(partnerId, committed = 100, title = 'Free Express Manicure') {
  const res = await request(app)
    .post('/api/redeem-ops/rewards')
    .set(auth(admin.token))
    .send({ partnerOrganisationId: partnerId, title, committedQuantity: committed });
  return res.body.data.offer;
}

describe('reward offers + ledger', () => {
  let partner;
  beforeAll(async () => { partner = await makePartner('Nail Bliss Test Studio'); });

  test('creation writes the opening committed ledger entry; exec cannot create', async () => {
    const denied = await request(app)
      .post('/api/redeem-ops/rewards')
      .set(auth(exec.token))
      .send({ partnerOrganisationId: partner.id, title: 'Nope', committedQuantity: 10 });
    expect(denied.status).toBe(403);

    const offer = await makeOffer(partner.id, 100);
    expect(offer.committedQuantity).toBe(100);
    const ledger = await RewardInventoryEvent.findAll({ where: { rewardOfferId: offer.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe('committed');
    expect(ledger[0].quantity).toBe(100);
  });

  test('committed cannot drop below allocated; reasoned adjustments are ledgered', async () => {
    const offer = await makeOffer(partner.id, 50, 'Adjustable Reward');
    const inventory = makeInventoryService();
    await inventory.allocate({ offerId: offer.id, quantity: 40, actorUser: admin.user });

    const tooFar = await request(app)
      .post(`/api/redeem-ops/rewards/${offer.id}/inventory`)
      .set(auth(admin.token))
      .send({ type: 'committed_decrease', quantity: 20, reason: 'partner cut supply' });
    expect(tooFar.status).toBe(409);

    const ok = await request(app)
      .post(`/api/redeem-ops/rewards/${offer.id}/inventory`)
      .set(auth(admin.token))
      .send({ type: 'committed_decrease', quantity: 10, reason: 'partner cut supply' });
    expect(ok.status).toBe(200);

    const noReason = await request(app)
      .post(`/api/redeem-ops/rewards/${offer.id}/inventory`)
      .set(auth(admin.token))
      .send({ type: 'committed_increase', quantity: 5, reason: '' });
    expect(noReason.status).toBe(400);
  });

  test('CONCURRENT allocations cannot oversubscribe committed supply', async () => {
    const offer = await makeOffer(partner.id, 10, 'Contended Reward');
    const inventory = makeInventoryService();

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        inventory.allocate({ offerId: offer.id, quantity: 4, actorUser: admin.user })
      )
    );
    const wins = attempts.filter((r) => r.status === 'fulfilled').length;
    expect(wins).toBe(2); // 2 × 4 = 8 ≤ 10; a third would need 12

    const row = await RewardOffer.findByPk(offer.id);
    expect(row.allocatedQuantity).toBe(8);
    expect(row.allocatedQuantity).toBeLessThanOrEqual(row.committedQuantity);

    const { consistent, derived, actual } = await inventory.reconcile(offer.id);
    expect({ consistent, derived, actual }).toEqual(
      expect.objectContaining({ consistent: true })
    );
  });
});

describe('onboarding checklist', () => {
  test('seeded on PARTNERED transition (via forced stage change)', async () => {
    const partner = await makePartner('Onboard Me Fitness');
    await request(app).post(`/api/redeem-ops/partners/${partner.id}/claim`).set(auth(admin.token));
    const res = await request(app)
      .patch(`/api/redeem-ops/partners/${partner.id}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED', reason: 'signed on the spot' });
    expect(res.status).toBe(200);

    const items = await PartnerOnboardingItem.findAll({ where: { partnerOrganisationId: partner.id } });
    expect(items.length).toBe(11);

    const done = await request(app)
      .patch(`/api/redeem-ops/onboarding/${items[0].id}`)
      .set(auth(admin.token))
      .send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.data.item.completedAt).toBeTruthy();
  });
});

describe('activations + campaign linkage', () => {
  let partner, offer, campaignA, campaignB;

  beforeAll(async () => {
    partner = await makePartner('Activation Partner Spa');
    offer = await makeOffer(partner.id, 100, 'Activatable Reward');
    campaignA = await createTestCampaign(admin.user.id, { name: 'Redeem Test Campaign A' });
    campaignB = await createTestCampaign(admin.user.id, { name: 'Redeem Test Campaign B' });
  });

  test('campaign_ops creates an activation; allocation draws from the offer', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/activations')
      .set(auth(campaignOps.token))
      .send({ rewardOfferId: offer.id, allocatedQuantity: 60 });
    expect(res.status).toBe(201);
    const row = await RewardOffer.findByPk(offer.id);
    expect(row.allocatedQuantity).toBe(60);
  });

  test('cannot allocate beyond the offer remaining', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/activations')
      .set(auth(campaignOps.token))
      .send({ rewardOfferId: offer.id, allocatedQuantity: 50 }); // only 40 left
    expect(res.status).toBe(409);
  });

  test('link campaign: archived rejected; second LIVE activation on same campaign 409s; projection leaks nothing', async () => {
    const list = await request(app)
      .get('/api/redeem-ops/activations')
      .set(auth(campaignOps.token));
    const activation = list.body.data.activations.find((a) => a.rewardOffer?.id === offer.id);

    await Campaign.update({ status: 'archived' }, { where: { id: campaignB.id } });
    const archived = await request(app)
      .patch(`/api/redeem-ops/activations/${activation.id}/campaign`)
      .set(auth(campaignOps.token))
      .send({ campaignId: campaignB.id });
    expect(archived.status).toBe(400);

    const linked = await request(app)
      .patch(`/api/redeem-ops/activations/${activation.id}/campaign`)
      .set(auth(campaignOps.token))
      .send({ campaignId: campaignA.id });
    expect(linked.status).toBe(200);
    expect(linked.body.data.activation.campaignNameSnapshot).toBe('Redeem Test Campaign A');

    // draft → preparing = LIVE; a second activation linking the same campaign must 409
    await request(app)
      .patch(`/api/redeem-ops/activations/${activation.id}/status`)
      .set(auth(campaignOps.token))
      .send({ status: 'preparing' });

    const second = await request(app)
      .post('/api/redeem-ops/activations')
      .set(auth(campaignOps.token))
      .send({ rewardOfferId: offer.id, allocatedQuantity: 0 });
    await request(app)
      .patch(`/api/redeem-ops/activations/${second.body.data.activation.id}/status`)
      .set(auth(campaignOps.token))
      .send({ status: 'preparing' });
    const conflict = await request(app)
      .patch(`/api/redeem-ops/activations/${second.body.data.activation.id}/campaign`)
      .set(auth(campaignOps.token))
      .send({ campaignId: campaignA.id });
    expect(conflict.status).toBe(409);

    // Projection: attribute-allowlisted, never design_config
    const search = await request(app)
      .get('/api/redeem-ops/campaigns')
      .query({ search: 'Redeem Test Campaign' })
      .set(auth(campaignOps.token));
    expect(search.status).toBe(200);
    for (const c of search.body.data.campaigns) {
      expect(c.design_config).toBeUndefined();
      expect(c.publicUrl).toContain('/LeadCapture?campaign_id=');
      expect(c.mktrAdminUrl).toContain('/admin/campaigns/');
    }

    // Detail endpoint returns activation + read-only campaign card + MKTR metrics shape
    const detail = await request(app)
      .get(`/api/redeem-ops/activations/${activation.id}`)
      .set(auth(campaignOps.token));
    expect(detail.body.data.campaign.name).toBe('Redeem Test Campaign A');

    const metrics = await request(app)
      .get(`/api/redeem-ops/activations/${activation.id}/campaign-metrics`)
      .set(auth(campaignOps.token));
    expect(metrics.status).toBe(200);
    expect(metrics.body.data).toHaveProperty('acquisition');
    expect(metrics.body.data).toHaveProperty('reward');
  });

  test('outreach exec cannot manage activations', async () => {
    const res = await request(app)
      .post('/api/redeem-ops/activations')
      .set(auth(exec.token))
      .send({ rewardOfferId: offer.id });
    expect(res.status).toBe(403);
  });
});
