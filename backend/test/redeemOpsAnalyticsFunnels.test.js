/**
 * PR D — activation funnels expose per-activation entitlement STATUS counts
 * (the funnel doc's §4 claim: watch where prospects fall out,
 * eligible → issued → redeemed/expired — counters alone can't show that).
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import crypto from 'crypto';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  PartnerOrganisation, RewardOffer, Activation, RewardEntitlement,
} from '../src/models/index.js';

let app, admin;
let partner, offer, campaign, activation;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const hash = () => crypto.randomBytes(32).toString('hex');

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  partner = await PartnerOrganisation.create({
    tradingName: 'Funnel Counts Studio', normalizedName: 'funnel counts studio', createdBy: admin.user.id,
  });
  campaign = await createTestCampaign(admin.user.id, { name: 'Funnel Counts Campaign' });
  offer = await RewardOffer.create({
    partnerOrganisationId: partner.id, title: 'Free Funnel Trial',
    committedQuantity: 50, allocatedQuantity: 30, status: 'active',
    claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
  });
  activation = await Activation.create({
    partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign.id,
    campaignNameSnapshot: campaign.name, allocatedQuantity: 30, status: 'active',
    unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
  });

  const mk = (status) => RewardEntitlement.create({
    rewardOfferId: offer.id, activationId: activation.id, prospectId: null,
    status, presentationTokenHash: hash(), issuedVia: 'manual',
  });
  await Promise.all([mk('eligible'), mk('eligible'), mk('issued'), mk('redeemed'), mk('expired'), mk('cancelled')]);
});

afterAll(async () => {
  await closeDb();
});

test('GET /analytics/activations returns real status counts per activation', async () => {
  const res = await request(app)
    .get('/api/redeem-ops/analytics/activations')
    .set(auth(admin.token));
  expect(res.status).toBe(200);
  const mine = res.body.data.funnels.find((f) => f.id === activation.id);
  expect(mine).toBeTruthy();
  expect(mine.entitlements).toEqual({
    eligible: 2, issued: 1, redeemed: 1, expired: 1, cancelled: 1,
  });
});
