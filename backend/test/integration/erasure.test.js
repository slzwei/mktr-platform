/**
 * PR C — PDPA erasure, full-matrix integration (real Postgres; the lock
 * ordering, partial-unique interactions and json scrubs cannot be proven with
 * mocks). Plan: docs/plans/consumer-spine-and-consent-ledger.md §4.
 */
process.env.WEBHOOK_ENABLED = 'true';

import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import { Transaction } from 'sequelize';
import {
  getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag, createTestAttribution,
} from '../helpers.js';
import {
  sequelize, Consumer, Prospect, ProspectActivity, Commission,
  RewardEntitlement, RedemptionEvent, Redemption, Draw, DrawEntry, DrawAttempt,
  ShortLink, WebhookSubscriber, WebhookDelivery, Verification, WaitlistSignup,
  ConsentEvent, ConsumerSuppression, PartnerOrganisation, RewardOffer, Activation,
  SessionVisit, IdempotencyKey,
} from '../../src/models/index.js';
import { markPhoneVerified, isPhoneRecentlyVerified } from '../../src/services/verifiedPhoneStore.js';
import { phoneHashOf } from '../../src/services/consumerService.js';
import { eraseConsumer, ERASED_PHONE_HASH } from '../../src/services/erasureService.js';
import { isSuppressed, canMarketTo, applyUnsubscribe } from '../../src/services/consentService.js';
import { makeEntitlementService, flushDeliveries as flushEntDeliveries } from '../../src/services/redeemOps/entitlementService.js';
import { makeWebhookService } from '../../src/services/webhookService.js';
import { makeLuckyDrawService } from '../../src/services/luckyDrawService.js';

const RUN = Date.now();
const p8 = (offset) => `9${String(RUN + offset).slice(-7)}`; // distinct SG mobiles
const hash = () => crypto.randomBytes(32).toString('hex');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let app;
let admin;
let agent;
let campaign1;
let campaign2;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  agent = await createTestUser({ role: 'agent', phone: `+656${String(RUN).slice(-7)}` });
  campaign1 = await createTestCampaign(admin.user.id, { name: `Erasure C1 ${RUN}` });
  campaign2 = await createTestCampaign(admin.user.id, { name: `Erasure C2 ${RUN}` });
});

afterAll(async () => {
  // Leave nothing enabled behind for suites sharing this jest worker: the
  // test subscribers would otherwise receive every later capture's events.
  await WebhookSubscriber.update({ enabled: false }, { where: { name: [`mktr-leads mirror ${RUN}`, `other app ${RUN}`] } });
  process.env.WEBHOOK_ENABLED = 'false';
  await closeDb();
});

/** Capture through the real funnel so sourceMetadata/ledger all populate. */
async function captureProspect(phone8, campaign, { verified = true, email, firstName = 'Erin', lastName = 'Tan' } = {}) {
  const e164 = `+65${phone8}`;
  if (verified) markPhoneVerified(e164);
  const res = await request(app).post('/api/prospects').send({
    firstName,
    lastName,
    email: email === undefined ? `erase-${phone8}@test.com` : email,
    phone: phone8,
    campaignId: campaign.id,
    leadSource: 'website',
    consent_contact: true,
    consent_terms: true,
    utm_source: 'fb',
    utm_medium: 'cpc',
    utm_campaign: 'tokyo',
    utm_content: 'creative-7',
    fbp: 'fb.1.123.456',
    eventId: `evt-${phone8}`,
    eventSourceUrl: 'https://redeem.sg/LeadCapture?x=1',
  });
  expect(res.status).toBe(201);
  const prospect = await Prospect.findByPk(res.body.data.prospect.id);
  return prospect;
}

describe('PDPA erasure — full matrix', () => {
  const phone8 = p8(1);
  const e164 = `+65${phone8}`;
  let consumer;
  let prospect1;
  let prospect2;
  let unlinked;
  let callBot;
  let callBotInbound;
  let referred;
  let sessionVisit;
  let attribution;
  let partner;
  let offer;
  let activation;
  let entitlement;
  let redemption;
  let draw;
  let entry;
  let attempt;
  let shortLink;
  let subscriberYes;
  let subscriberNo;
  let deliveryCreated;
  let deliveryPending;
  let deliveryReferral;

  beforeAll(async () => {
    prospect1 = await captureProspect(phone8, campaign1);
    prospect2 = await captureProspect(phone8, campaign2);
    consumer = await Consumer.findOne({ where: { phone: e164 } });
    expect(consumer).toBeTruthy();
    expect(prospect1.consumerId).toBe(consumer.id);

    // An UNLINKED row on the same phone stored in a NON-normalized format
    // (raw insert — the digits arm must still catch it), an inbound call_bot
    // row whose CALLER (sourceMetadata.fromNumber) is this person (must be
    // scrubbed — the transcript lives in notes), and an inbound call_bot row
    // for a DIFFERENT caller (must stay untouched).
    unlinked = await Prospect.create({
      firstName: 'Erin', lastName: 'Unlinked', email: `unlinked-${phone8}@test.com`,
      phone: e164, leadSource: 'website', campaignId: null, consumerId: null,
      sourceMetadata: { clientIp: '1.2.3.4' },
    });
    await sequelize.query(
      `UPDATE prospects SET phone = :spaced WHERE id = :id`,
      { replacements: { spaced: `+65 ${phone8.slice(0, 4)} ${phone8.slice(4)}`, id: unlinked.id } }
    );
    callBotInbound = await Prospect.create({
      firstName: 'Caller', lastName: 'Bot', email: `retell-in-${RUN}@calls.mktr.sg`,
      phone: '+6562773210', leadSource: 'call_bot', campaignId: campaign1.id,
      notes: `Transcript: Erin Tan asked about the Tokyo draw from ${e164}`,
      retellCallId: `call-in-${RUN}`,
      sourceMetadata: { retellCallId: `call-in-${RUN}`, fromNumber: e164, recordingUrl: 'https://retell.example/rec.mp3' },
    });
    callBot = await Prospect.create({
      firstName: 'Caller', lastName: 'Bot', email: `retell-${RUN}@calls.mktr.sg`,
      phone: '+6562773211', leadSource: 'call_bot', campaignId: campaign1.id,
      sourceMetadata: { retellCallId: `call-${RUN}`, fromNumber: '+6588881234' },
    });

    // Referral copy on ANOTHER person's row: capture denormalized the erased
    // referrer's name into the referred prospect's sourceMetadata (+ webhook copy).
    referred = await Prospect.create({
      firstName: 'Rafi', lastName: 'Referred', email: `referred-${RUN}@test.com`,
      phone: `+658${String(RUN + 7).slice(-7)}`, leadSource: 'website', campaignId: campaign1.id,
      sourceMetadata: { referral: { referrerProspectId: prospect1.id, referrerName: 'Erin Tan', code: 'ETAN' } },
    });

    // Browsing records: a session visit + attribution chain hung off prospect1.
    const qrTag = await createTestQrTag(campaign1.id, admin.user.id);
    sessionVisit = await SessionVisit.create({
      sessionId: `sess-${RUN}`, landingPath: '/lead-capture', utmSource: 'fb',
      eventsJson: [{ type: 'form_view', ts: new Date().toISOString() }],
    });
    attribution = await createTestAttribution(qrTag.id, `sess-${RUN}`);
    await sequelize.query(
      'UPDATE prospects SET "sessionId" = :sid, "attributionId" = :aid WHERE id = :id',
      { replacements: { sid: `sess-${RUN}`, aid: attribution.id, id: prospect1.id } }
    );

    // Provider idempotency row echoing the prospect link.
    await IdempotencyKey.create({
      key: `retell:call:call-in-${RUN}`, scope: 'retell:call',
      responseBody: { prospectId: prospect1.id, status: 'created' },
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });

    // Redeem-ops chain: offer → activation → issued entitlement + redemption.
    partner = await PartnerOrganisation.create({
      tradingName: `Erasure Partner ${RUN}`, normalizedName: `erasure partner ${RUN}`, createdBy: admin.user.id,
    });
    offer = await RewardOffer.create({
      partnerOrganisationId: partner.id, title: 'Erasure Trial Reward',
      committedQuantity: 50, allocatedQuantity: 30, issuedQuantity: 2, status: 'active',
      claimExpiryDays: 30, redemptionExpiryDays: 90, createdBy: admin.user.id,
    });
    activation = await Activation.create({
      partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign1.id,
      campaignNameSnapshot: campaign1.name, allocatedQuantity: 30, issuedCount: 1, status: 'active',
      unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
    });
    // The anti-farming partial unique allows one LIVE reward per phone per
    // activation — the redeemed history row lives on a second activation.
    const activation2 = await Activation.create({
      partnerOrganisationId: partner.id, rewardOfferId: offer.id, campaignId: campaign2.id,
      campaignNameSnapshot: campaign2.name, allocatedQuantity: 30, issuedCount: 1, status: 'active',
      unlockPolicy: 'agent_unlock', createdBy: admin.user.id,
    });
    entitlement = await RewardEntitlement.create({
      rewardOfferId: offer.id, activationId: activation.id, prospectId: prospect1.id,
      consumerId: consumer.id, status: 'issued', unlockedAt: new Date(),
      presentationTokenHash: hash(), tokenHash: hash(), tokenHint: 'AB12',
      issuedVia: 'hook', phoneKey: `65${phone8}`,
    });
    const redeemedEnt = await RewardEntitlement.create({
      rewardOfferId: offer.id, activationId: activation2.id, prospectId: prospect2.id,
      consumerId: consumer.id, status: 'redeemed',
      presentationTokenHash: hash(), tokenHash: hash(), tokenHint: 'CD34',
      issuedVia: 'hook', phoneKey: `65${phone8}`,
    });
    redemption = await Redemption.create({
      entitlementId: redeemedEnt.id, rewardOfferId: offer.id, activationId: activation2.id,
      partnerOrganisationId: partner.id, method: 'code', status: 'completed',
      actorType: 'staff', actorUserId: admin.user.id, notes: `Handled in person for Erin Tan ${e164}`,
    });
    await RedemptionEvent.create({
      entitlementId: entitlement.id, type: 'notified', actorType: 'system',
      metadata: { kind: 'voucher', channel: 'email', to: 'e***@test.com' },
    });
    await RedemptionEvent.create({
      entitlementId: redeemedEnt.id, type: 'reversed', actorType: 'staff',
      metadata: { reason: `customer Erin Tan asked at ${e164}`, redemptionId: redemption.id },
    });

    // Sealed draw with this person's frozen entry + a PENDING attempt that
    // picked them (the erased-pending-winner path).
    draw = await Draw.create({
      campaignId: campaign1.id, closesAt: new Date(Date.now() - 3600_000),
      multiplier: 10, status: 'drawn', poolHash: hash(), createdBy: admin.user.id,
    });
    entry = await DrawEntry.create({
      drawId: draw.id, prospectId: prospect1.id, phoneHash: phoneHashOf(e164),
      phoneLast4: phone8.slice(-4), displayName: 'Erin T.', chances: 10,
      verifiedAtFreeze: new Date(), boostVia: 'agent_scan',
    });
    attempt = await DrawAttempt.create({
      drawId: draw.id, attemptNo: 1, seed: hash(), totalChances: 10,
      eligibleHash: hash(), pickedEntryId: entry.id, reason: 'initial',
      drawnAt: new Date(), claimDeadline: new Date(Date.now() + 14 * 24 * 3600_000),
      outcome: 'pending',
    });

    // Capture may have auto-minted the canonical share link (one per prospect,
    // partial unique) — reuse it, else seed one.
    shortLink = await ShortLink.findOne({ where: { prospectId: prospect1.id } });
    if (!shortLink) {
      shortLink = await ShortLink.create({
        slug: `er${RUN}`, targetUrl: `https://redeem.sg/LeadCapture?campaign_id=${campaign1.id}&ref=${prospect1.id}`,
        purpose: 'share', campaignId: campaign1.id, prospectId: prospect1.id,
      });
    }

    // Webhook history: one subscriber that handles lead.deleted and received
    // the lead (gets the outbox row), one that never received it.
    subscriberYes = await WebhookSubscriber.create({
      name: `mktr-leads mirror ${RUN}`, url: 'https://mirror.invalid/webhook', secret: 's1',
      events: ['lead.created', 'lead.deleted'], enabled: true, metadata: { destination: 'mktr_leads' },
    });
    subscriberNo = await WebhookSubscriber.create({
      name: `other app ${RUN}`, url: 'https://other.invalid/webhook', secret: 's2',
      events: ['lead.created', 'lead.deleted'], enabled: true, metadata: { destination: 'mktr_leads' },
    });
    const piiPayload = (pid, deliveryId) => ({
      event: 'lead.created', deliveryId,
      data: {
        lead: {
          externalId: pid, firstName: 'Erin', lastName: 'Tan', phone: e164,
          email: `erase-${phone8}@test.com`, sourceMetadata: { clientIp: '9.9.9.9' },
        },
        routing: { agentPhone: '+6590000000' },
      },
    });
    const d1 = crypto.randomUUID();
    deliveryCreated = await WebhookDelivery.create({
      subscriberId: subscriberYes.id, deliveryId: d1, eventType: 'lead.created',
      payload: piiPayload(prospect1.id, d1), status: 'success', responseCode: 200,
      responseBody: JSON.stringify({ echoed: `Erin Tan ${e164}` }),
    });
    const d2 = crypto.randomUUID();
    deliveryPending = await WebhookDelivery.create({
      subscriberId: subscriberYes.id, deliveryId: d2, eventType: 'lead.created',
      payload: piiPayload(prospect2.id, d2), status: 'pending',
    });
    // The REFERRED person's delivery embeds the erased referrer's name.
    const d3 = crypto.randomUUID();
    deliveryReferral = await WebhookDelivery.create({
      subscriberId: subscriberYes.id, deliveryId: d3, eventType: 'lead.created',
      payload: {
        event: 'lead.created', deliveryId: d3,
        data: {
          lead: {
            externalId: referred.id, firstName: 'Rafi',
            sourceMetadata: { referral: { referrerProspectId: prospect1.id, referrerName: 'Erin Tan' } },
          },
        },
      },
      status: 'success', responseCode: 200,
    });

    // Commission with the lead's name; activity metadata with a full snapshot.
    await Commission.create({
      type: 'conversion', amount: 50, status: 'pending',
      description: 'Lead conversion: Erin Tan', agentId: agent.user.id,
      campaignId: campaign1.id, prospectId: prospect1.id, earnedDate: new Date(),
    });
    await ProspectActivity.create({
      prospectId: prospect1.id, type: 'updated', actorUserId: admin.user.id,
      description: 'Prospect updated by admin',
      metadata: { before: { firstName: 'Erin', phone: e164 }, after: { firstName: 'Erin2' } },
    });

    // OTP row + waitlist row for the same person.
    await Verification.upsert({ phone: e164, code: '123456', attempts: 0, expiresAt: new Date(Date.now() + 600_000) });
    await WaitlistSignup.create({
      email: `erase-${phone8}@test.com`, name: 'Erin Tan', phone: `65${phone8}`,
      source: 'homepage', ipAddress: '8.8.8.8', userAgent: 'jest',
    });
  });

  let report;

  test('erase endpoint requires admin + explicit confirm', async () => {
    const agentRes = await request(app)
      .post(`/api/consumers/${consumer.id}/erase`)
      .set(auth(agent.token))
      .send({ confirm: 'ERASE' });
    expect(agentRes.status).toBe(403);

    const noConfirm = await request(app)
      .post(`/api/consumers/${consumer.id}/erase`)
      .set(auth(admin.token))
      .send({});
    expect(noConfirm.status).toBe(422);

    const badId = await request(app)
      .post('/api/consumers/not-a-uuid/erase')
      .set(auth(admin.token))
      .send({ confirm: 'ERASE' });
    expect(badId.status).toBe(404);
  });

  test('POST /erase succeeds and returns the matrix report', async () => {
    const res = await request(app)
      .post(`/api/consumers/${consumer.id}/erase`)
      .set(auth(admin.token))
      .send({ confirm: 'ERASE', reason: 'PDPA request via email' });
    expect(res.status).toBe(200);
    report = res.body.data;
    expect(report.alreadyErased).toBe(false);
    expect(report.repair).toBe(false);
    // prospect1 + prospect2 + the spaced-format unlinked row + the inbound
    // call_bot row for THIS caller; NOT the other caller's DDI row.
    expect(report.prospects).toBe(4);
    expect(report.entitlementsCancelled).toBe(1); // the issued one
    expect(report.entitlementsScrubbed).toBe(1); // the redeemed one
    expect(report.inventoryReversalFailures).toBe(0);
    expect(report.drawEntries).toBe(1);
    expect(report.drawAttemptsClosed).toBe(1);
    expect(report.shortLinks).toBe(2); // capture auto-mints one share link per funnel prospect
    expect(report.verifications).toBe(1);
    expect(report.waitlistSignups).toBe(1);
    expect(report.referralCopiesScrubbed).toBe(1);
    expect(report.sessionVisits).toBe(1);
    expect(report.attributions).toBe(1);
    expect(report.idempotencyKeys).toBe(1);
    expect(report.retellCallIds).toContain(`call-in-${RUN}`);
    expect(report.leadDeletedQueued).toBeGreaterThanOrEqual(1);
    expect(report.webhooksDisabled).toBe(false);
  });

  test('prospects: allowlist rebuild (PII gone, skeleton + utm kept)', async () => {
    const p = await Prospect.findByPk(prospect1.id);
    expect(p.firstName).toBe('Erased');
    expect(p.lastName).toBeNull();
    expect(p.email).toBeNull();
    expect(p.phone).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.budget).toBeNull();
    expect(p.location).toBeNull();
    expect(p.demographics).toBeNull();
    expect(p.preferences).toBeNull();
    expect(p.interests).toEqual([]);
    expect(p.tags).toEqual([]);
    expect(p.sessionId).toBeNull();
    expect(p.attributionId).toBeNull();
    expect(p.dncStatus).toBeNull();
    expect(p.dncMetadata).toBeNull();
    expect(p.consentMetadata).toEqual({ erased: true });
    // skeleton survives
    expect(p.campaignId).toBe(campaign1.id);
    expect(p.consumerId).toBe(consumer.id);
    expect(p.leadSource).toBe('website');
    // sourceMetadata = utm(source/medium/campaign) + erased marker ONLY
    expect(p.sourceMetadata).toEqual({
      utm: { utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'tokyo' },
      erased: true,
    });

    const u = await Prospect.findByPk(unlinked.id);
    expect(u.firstName).toBe('Erased'); // spaced-format phone still caught (digits arm)
    expect(u.phone).toBeNull();
    expect(u.sourceMetadata).toEqual({ erased: true });
    expect(u.consumerId).toBe(consumer.id); // repair anchor

    // Inbound call for THIS person (fromNumber match): transcript + call
    // pointer + recording locator all gone.
    const cbi = await Prospect.findByPk(callBotInbound.id);
    expect(cbi.firstName).toBe('Erased');
    expect(cbi.notes).toBeNull();
    expect(cbi.retellCallId).toBeNull();
    expect(cbi.sourceMetadata).toEqual({ erased: true });

    // Inbound call for a DIFFERENT caller on the same DDI: untouched.
    const cb = await Prospect.findByPk(callBot.id);
    expect(cb.firstName).toBe('Caller');
    expect(cb.phone).toBe('+6562773211');
    expect(cb.sourceMetadata.fromNumber).toBe('+6588881234');
  });

  test('referral copies on OTHER rows: name gone from sourceMetadata + webhook payload', async () => {
    const r = await Prospect.findByPk(referred.id);
    expect(r.firstName).toBe('Rafi'); // the referred person is NOT erased
    expect(r.sourceMetadata.referral.referrerName).toBeUndefined();
    expect(r.sourceMetadata.referral.referrerProspectId).toBe(prospect1.id);
    expect(r.sourceMetadata.referral.code).toBe('ETAN');
    const wd = await WebhookDelivery.findByPk(deliveryReferral.id);
    expect(wd.payload.data.lead.sourceMetadata.referral.referrerName).toBe('[erased]');
    expect(wd.payload.data.lead.firstName).toBe('Rafi'); // rest of the payload intact
  });

  test('browsing records: session visit + attribution rows deleted, prospect unlinked', async () => {
    expect(await SessionVisit.findByPk(sessionVisit.id)).toBeNull();
    const [attrRows] = await sequelize.query(
      'SELECT 1 FROM attributions WHERE id = :id', { replacements: { id: attribution.id } }
    );
    expect(attrRows.length).toBe(0);
  });

  test('provider idempotency rows referencing the person are deleted', async () => {
    expect(await IdempotencyKey.findByPk(`retell:call:call-in-${RUN}`)).toBeNull();
  });

  test('in-memory phone caches evicted post-commit', () => {
    expect(isPhoneRecentlyVerified(e164)).toBe(false);
  });

  test('activities: metadata snapshots scrubbed, rows/types kept', async () => {
    const acts = await ProspectActivity.findAll({ where: { prospectId: prospect1.id } });
    expect(acts.length).toBeGreaterThanOrEqual(2);
    for (const a of acts) {
      expect(a.metadata).toEqual({ erased: true });
    }
  });

  test('commissions: description scrubbed, financials kept', async () => {
    const c = await Commission.findOne({ where: { prospectId: prospect1.id } });
    expect(c.description).toBeNull();
    expect(Number(c.amount)).toBe(50);
    expect(c.status).toBe('pending');
  });

  test('entitlements: live cancelled with bookkeeping, redeemed keeps status; phoneKey/tokenHint null everywhere', async () => {
    const e1 = await RewardEntitlement.findByPk(entitlement.id);
    expect(e1.status).toBe('cancelled');
    expect(e1.phoneKey).toBeNull();
    expect(e1.tokenHint).toBeNull();
    const all = await RewardEntitlement.findAll({ where: { consumerId: consumer.id } });
    expect(all.length).toBe(2);
    for (const e of all) {
      expect(e.phoneKey).toBeNull();
      expect(e.tokenHint).toBeNull();
    }
    expect(all.map((e) => e.status).sort()).toEqual(['cancelled', 'redeemed']);
    // activation1 issuedCount 1 → 0 (one live cancellation), offer issuedQuantity 2 → 1
    const act = await Activation.findByPk(activation.id);
    expect(act.issuedCount).toBe(0);
    const off = await RewardOffer.findByPk(offer.id);
    expect(off.issuedQuantity).toBe(1);
    // the erased override event exists
    const overrides = await RedemptionEvent.findAll({
      where: { entitlementId: entitlement.id, type: 'manual_override' },
    });
    expect(overrides.some((e) => e.metadata?.action === 'erased')).toBe(true);
  });

  test('redemptions + receipt events: free text and destinations stripped', async () => {
    const r = await Redemption.findByPk(redemption.id);
    expect(r.notes).toBeNull();
    const events = await RedemptionEvent.findAll({
      where: { entitlementId: [entitlement.id, redemption.entitlementId] },
    });
    for (const ev of events) {
      if (!ev.metadata) continue;
      expect(ev.metadata.to).toBeUndefined();
      expect(ev.metadata.reason).toBeUndefined();
      expect(ev.metadata.error).toBeUndefined();
    }
    // non-PII receipt keys survive
    const notified = events.find((ev) => ev.type === 'notified');
    expect(notified.metadata).toMatchObject({ kind: 'voucher', channel: 'email' });
  });

  test('draw: entry unpickable + snapshot scrubbed; pending attempt → ineligible; redraw chain stays legal', async () => {
    const en = await DrawEntry.findByPk(entry.id);
    expect(en.prospectId).toBeNull();
    expect(en.phoneLast4).toBeNull();
    expect(en.displayName).toBeNull();
    expect(en.verifiedAtFreeze).toBeNull();
    expect(en.phoneHash).toBe(ERASED_PHONE_HASH);
    const at = await DrawAttempt.findByPk(attempt.id);
    expect(at.outcome).toBe('ineligible');

    // Redraw with reason = prior outcome is accepted; the erased entry cannot
    // be picked again (prospectId null filter) — with no other entries the
    // pool is empty, which IS the erased-entry exclusion.
    const drawSvc = makeLuckyDrawService();
    await expect(
      drawSvc.runDrawAttempt(draw.id, { reason: 'ineligible' }, admin.user)
    ).rejects.toThrow(/No eligible entries left/);
  });

  test('short link deactivated, unlinked, and ref= stripped from the public target', async () => {
    const sl = await ShortLink.findByPk(shortLink.id);
    expect(sl.expiresAt).not.toBeNull();
    expect(new Date(sl.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(sl.prospectId).toBeNull();
    expect(sl.targetUrl).not.toContain('ref=');
    expect(sl.targetUrl).not.toContain(prospect1.id);
  });

  test('webhook deliveries: payload copies scrubbed to envelope, pending cancelled, lead.deleted outbox persisted for receivers only', async () => {
    const dc = await WebhookDelivery.findByPk(deliveryCreated.id);
    expect(dc.payload.erased).toBe(true);
    expect(dc.payload.data.lead).toEqual({ externalId: prospect1.id });
    expect(dc.payload.deliveryId).toBe(deliveryCreated.deliveryId);
    expect(JSON.stringify(dc.payload)).not.toContain('Erin');
    expect(JSON.stringify(dc.payload)).not.toContain(phone8);
    expect(dc.responseBody).toBeNull();

    const dp = await WebhookDelivery.findByPk(deliveryPending.id);
    expect(dp.status).toBe('failed');
    expect(dp.errorMessage).toContain('erased');
    expect(dp.payload.erased).toBe(true);

    const outbox = await WebhookDelivery.findAll({
      where: { eventType: 'lead.deleted', subscriberId: subscriberYes.id },
    });
    const pids = new Set(outbox.map((o) => o.payload?.data?.lead?.externalId));
    expect(pids.has(prospect1.id)).toBe(true);
    expect(pids.has(prospect2.id)).toBe(true);
    const noRows = await WebhookDelivery.findAll({
      where: { eventType: 'lead.deleted', subscriberId: subscriberNo.id },
    });
    expect(noRows.length).toBe(0);
  });

  test('consumer nulled; suppression reason=erasure; global denial ledger event; gates closed', async () => {
    const c = await Consumer.findByPk(consumer.id);
    expect(c.erasedAt).not.toBeNull();
    expect(c.phone).toBeNull();
    expect(c.phoneHash).toBeNull();
    expect(c.firstName).toBeNull();
    expect(c.lastName).toBeNull();
    expect(c.email).toBeNull();
    expect(c.unsubTokenHash).toBeNull();

    const sup = await ConsumerSuppression.findOne({ where: { consumerId: consumer.id, channel: 'all' } });
    expect(sup.reason).toBe('erasure');

    const ev = await ConsentEvent.findOne({ where: { consumerId: consumer.id, source: 'erasure' } });
    expect(ev).toBeTruthy();
    expect(ev.granted).toBe(false);
    expect(ev.campaignId).toBeNull();
    // The free-text reason lives ONLY in the access-controlled audit row,
    // never in the ledger (Codex R1 #11).
    expect(ev.metadata).toBeNull();
    expect(ev.sourceUrl).toBeNull();

    expect(await isSuppressed({ consumerId: consumer.id, purpose: 'transactional' })).toBe(true);
    expect(await canMarketTo({ consumerId: consumer.id, campaignId: campaign1.id })).toBe(false);
  });

  test('verification + waitlist rows deleted', async () => {
    expect(await Verification.findByPk(e164)).toBeNull();
    expect(await WaitlistSignup.findOne({ where: { email: `erase-${phone8}@test.com` } })).toBeNull();
  });

  test('re-erase = REPAIR pass: no double bookkeeping, and resurrected PII is scrubbed again', async () => {
    // Simulate PII leaking back onto an erased skeleton (e.g. a racing write).
    await sequelize.query(
      `UPDATE prospects SET "firstName" = 'Sneaky', notes = 'resurrected note' WHERE id = :id`,
      { replacements: { id: prospect1.id } }
    );
    const res = await request(app)
      .post(`/api/consumers/${consumer.id}/erase`)
      .set(auth(admin.token))
      .send({ confirm: 'ERASE' });
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyErased).toBe(true);
    expect(res.body.data.repair).toBe(true);
    const p = await Prospect.findByPk(prospect1.id);
    expect(p.firstName).toBe('Erased'); // repair re-scrubbed it
    expect(p.notes).toBeNull();
    const act = await Activation.findByPk(activation.id);
    expect(act.issuedCount).toBe(0); // NOT decremented again (nothing live)
    const sups = await ConsumerSuppression.findAll({ where: { consumerId: consumer.id } });
    expect(sups.length).toBe(1);
    const evs = await ConsentEvent.findAll({ where: { consumerId: consumer.id, source: 'erasure' } });
    expect(evs.length).toBe(1); // single ledger denial, not one per run
    const outbox = await WebhookDelivery.findAll({
      where: { eventType: 'lead.deleted', subscriberId: subscriberYes.id },
    });
    expect(outbox.length).toBe(2); // still one per prospect — repair deduped
  });

  test('erased skeleton rejects staff edits (PUT → 410)', async () => {
    const res = await request(app)
      .put(`/api/prospects/${prospect1.id}`)
      .set(auth(admin.token))
      .send({ firstName: 'Undo', notes: 'try to bring them back' });
    expect(res.status).toBe(410);
  });

  test('an already-enqueued in-memory delivery refuses to fire after erasure (reload fence)', async () => {
    // deliveryPending's in-memory instance still holds the ORIGINAL PII
    // payload; the erasure cancelled+scrubbed the row underneath it.
    expect(deliveryPending.payload.data.lead.firstName).toBe('Erin'); // stale copy
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const svc = makeWebhookService({ fetch: fetchSpy, logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } });
    await svc.attemptDelivery(deliveryPending, subscriberYes);
    expect(fetchSpy).not.toHaveBeenCalled(); // fence reloaded → status failed → no send
  });

  test('link-channel resend on an erased person is refused (410) even with a live entitlement', async () => {
    // Erasure cancels the person's entitlements, so a live one can only exist
    // through a race — construct that state directly. (The unlinked row keeps
    // the (activationId, prospectId) partial unique clear of the original.)
    const raceEnt = await RewardEntitlement.create({
      rewardOfferId: offer.id, activationId: activation.id, prospectId: unlinked.id,
      consumerId: consumer.id, status: 'issued', unlockedAt: new Date(),
      presentationTokenHash: hash(), tokenHash: hash(), tokenHint: 'ZZ99', issuedVia: 'manual',
    });
    const svc = makeEntitlementService({ logger: { error: () => {}, warn: () => {}, info: () => {} } });
    await expect(
      svc.resendDelivery(raceEnt.id, admin.user, { channel: 'link' })
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  test('re-signup after erasure mints a NEW consumer with fresh counts', async () => {
    const again = await captureProspect(phone8, campaign1, { firstName: 'Erin', lastName: 'Again' });
    expect(again.consumerId).toBeTruthy();
    expect(again.consumerId).not.toBe(consumer.id);
    const fresh = await Consumer.findByPk(again.consumerId);
    expect(fresh.phone).toBe(e164);
    expect(fresh.signupCount).toBe(1);
    const erased = await Consumer.findByPk(consumer.id);
    expect(erased.phone).toBeNull(); // untouched by the new signup
  });
});

describe('erasure — lock ordering vs concurrent capture', () => {
  test('capture of the same phone waits behind the erasure lock, then mints a NEW consumer', async () => {
    const phone = p8(500);
    const e164 = `+65${phone}`;
    const first = await captureProspect(phone, campaign1);
    const consumer = await Consumer.findOne({ where: { phone: e164 } });
    expect(first.consumerId).toBe(consumer.id);

    // Manually run an "erasure txn": lock the consumer FOR UPDATE, null the
    // identity, hold the lock while a capture races in, then commit.
    let captureResolved = false;
    let capturePromise;
    await sequelize.transaction(async (t) => {
      await Consumer.findByPk(consumer.id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      await Consumer.update(
        { erasedAt: new Date(), phone: null, phoneHash: null, firstName: null, lastName: null, email: null },
        { where: { id: consumer.id }, transaction: t }
      );
      // Race a real capture while the lock is held (campaign2 avoids the
      // same-campaign dupe 409).
      markPhoneVerified(e164);
      capturePromise = request(app).post('/api/prospects').send({
        firstName: 'Racer', lastName: 'Tan', email: `race-${phone}@test.com`,
        phone, campaignId: campaign2.id, leadSource: 'website',
        consent_contact: true, consent_terms: true,
      }).then((r) => { captureResolved = true; return r; });
      // Give the capture time to reach the resolver upsert and block.
      await new Promise((r) => setTimeout(r, 700));
      expect(captureResolved).toBe(false); // still waiting on our lock
    });

    const res = await capturePromise;
    expect(res.status).toBe(201);
    const p = await Prospect.findByPk(res.body.data.prospect.id);
    expect(p.consumerId).toBeTruthy();
    expect(p.consumerId).not.toBe(consumer.id); // NEW person, erased row untouched
    const fresh = await Consumer.findByPk(p.consumerId);
    expect(fresh.phone).toBe(e164);
    expect(fresh.erasedAt).toBeNull();
  });
});

describe('erasure — queued sender reload guard (queueDelivery)', () => {
  test('a stale queued send aborts when the person was erased in between; a live one sends with the FRESH row', async () => {
    const phone = p8(900);
    const prospect = await captureProspect(phone, campaign2, { firstName: 'Queue', lastName: 'Guard' });
    const stale = prospect.toJSON(); // point-in-time copy, as the senders hold

    const sent = [];
    const events = [];
    const svc = makeEntitlementService({
      RedemptionEvent: { create: async (row) => { events.push(row); return row; } },
      notifyUnlock: async ({ prospect: p }) => { sent.push(p); return { sent: true, to: 'x' }; },
      logger: { error: () => {}, warn: () => {}, info: () => {} },
    });

    // Live control: fires, and with the FRESH reloaded row.
    svc.queueDelivery({ entitlement: { id: crypto.randomUUID() }, prospect: stale, kind: 'voucher', voucherToken: 'v', channels: ['email'] });
    await flushEntDeliveries();
    expect(sent.length).toBe(1);
    expect(sent[0].id).toBe(prospect.id);

    // Erase, then fire the SAME stale object again — must abort, no receipt.
    const c = await Consumer.findByPk(prospect.consumerId);
    const report = await eraseConsumer(c.id, { actorUser: admin.user, reason: 'guard test' });
    expect(report.prospects).toBeGreaterThanOrEqual(1);
    const before = events.length;
    svc.queueDelivery({ entitlement: { id: crypto.randomUUID() }, prospect: stale, kind: 'voucher', voucherToken: 'v2', channels: ['email'] });
    await flushEntDeliveries();
    expect(sent.length).toBe(1); // no second send
    expect(events.length).toBe(before); // skip writes no receipt
  });
});

describe('erasure — suppression upgrade over a prior unsubscribe', () => {
  test('an unsubscribed consumer erased later ends with reason=erasure (transactional now blocked)', async () => {
    const phone = p8(1300);
    const prospect = await captureProspect(phone, campaign1, { firstName: 'Unsub', lastName: 'First' });
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await applyUnsubscribe(consumer, { source: 'unsubscribe_link' });
    expect(await isSuppressed({ consumerId: consumer.id, purpose: 'transactional' })).toBe(false);

    const report = await eraseConsumer(consumer.id, { actorUser: admin.user });
    expect(report.alreadyErased).toBe(false);
    const sup = await ConsumerSuppression.findOne({ where: { consumerId: consumer.id, channel: 'all' } });
    expect(sup.reason).toBe('erasure');
    expect(await isSuppressed({ consumerId: consumer.id, purpose: 'transactional' })).toBe(true);
  });
});

describe('erasure — service-level 404', () => {
  test('unknown consumer id rejects with 404 AppError', async () => {
    await expect(eraseConsumer(crypto.randomUUID(), {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
