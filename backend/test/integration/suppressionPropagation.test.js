/**
 * Suppression propagation (tracker "propagate") — the durable projection +
 * reconciler behind the lead.suppressed webhook. Real Postgres: the DB unique
 * is the idempotency and the CAS claims are the concurrency story — mocks
 * cannot prove either. Plan: docs/plans/suppression-propagation-plan.md §5.
 */
process.env.WEBHOOK_ENABLED = 'true';

import { jest } from '@jest/globals';
import crypto from 'crypto';
import { Op } from 'sequelize';
import request from 'supertest';
import {
  getApp, closeDb, createTestUser, createTestCampaign,
} from '../helpers.js';
import { sequelize, Consumer, Prospect, WebhookSubscriber, WebhookDelivery,
  SuppressionPropagation, ConsumerSuppression, ConsentEvent,
} from '../../src/models/index.js';
import { makeSuppressionPropagationService } from '../../src/services/suppressionPropagationService.js';
import { makeConsentService, ensureUnsubToken, canMarketTo } from '../../src/services/consentService.js';
import { markPhoneVerified } from '../../src/services/verifiedPhoneStore.js';
import { buildLeadUnsuppressedPayload } from '../../src/services/prospectHelpers.js';
import { makeErasureService } from '../../src/services/erasureService.js';
import { buildLeadSuppressedPayload } from '../../src/services/prospectHelpers.js';
import {
  ensureLyfeWebhookSubscriber, ensureMktrLeadsWebhookSubscriber,
} from '../../src/database/bootstrap.js';

const RUN = Date.now();
const p8 = (offset) => `8${String(RUN + offset).slice(-7)}`;

let app;
let admin;
let campaign;
let campaign2;

/** Capture through the real public route so the spine resolver links a consumer. */
async function capture(phone8, campaignArg = campaign) {
  const res = await request(app).post('/api/prospects').send({
    firstName: 'Prop',
    lastName: 'Agate',
    email: `prop-${phone8}@test.com`,
    phone: phone8,
    campaignId: campaignArg.id,
    leadSource: 'website',
    consent_contact: true,
    consent_terms: true,
  });
  expect(res.status).toBe(201);
  return Prospect.findByPk(res.body.data.prospect.id);
}

let subSeq = 0;
async function mkSubscriber(events, { destination = 'lyfe' } = {}) {
  subSeq += 1;
  return WebhookSubscriber.create({
    name: `Propagate Test ${RUN}-${subSeq}`,
    url: `https://propagate-test-${subSeq}.invalid/hook`,
    secret: 'test-secret',
    events,
    enabled: true,
    metadata: { destination },
  });
}

async function seedHistory(subscriber, prospectId, eventType = 'lead.created') {
  const deliveryId = crypto.randomUUID();
  return WebhookDelivery.create({
    subscriberId: subscriber.id,
    deliveryId,
    eventType,
    payload: { event: eventType, deliveryId, data: { lead: { externalId: prospectId } } },
    status: 'success',
  });
}

/** Service under test with the network flush captured, not fired. */
function svcWithSpy() {
  const flushed = [];
  const svc = makeSuppressionPropagationService({ flushDeliveries: (pairs) => flushed.push(...pairs) });
  return { svc, flushed };
}

const pairsOf = (subscriberId) => SuppressionPropagation.findAll({
  where: { subscriberId }, order: [['createdAt', 'ASC']],
});

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  campaign = await createTestCampaign(admin.user.id, { name: `propagate-c1-${RUN}` });
  campaign2 = await createTestCampaign(admin.user.id, { name: `propagate-c2-${RUN}` });
});

afterAll(async () => {
  await closeDb();
});

describe('reconcile — projection from state', () => {
  test('projects pairs for suppressed consumer: linked + phone-matched leads, subscribed subscribers only; payload is spec-shaped and PII-free', async () => {
    const phone = p8(1);
    const prospect = await capture(phone);
    expect(prospect.consumerId).toBeTruthy();
    const consumer = await Consumer.findByPk(prospect.consumerId);

    // An UNLINKED row with the same digits (spine miss) — the phone arm must catch it.
    const orphan = await Prospect.create({
      firstName: 'Orphan', phone: `+65${phone}`, campaignId: campaign2.id,
      leadSource: 'website', consumerId: null,
    });

    // Suppression written DIRECTLY (not via applyUnsubscribe): the real
    // writer's post-commit trigger is fire-and-forget and would race the
    // explicit pass below for insert counts. Trigger wiring is covered by the
    // spy + end-to-end tests.
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const suppression = await ConsumerSuppression.findOne({ where: { consumerId: consumer.id } });

    const s1 = await mkSubscriber(['lead.created', 'lead.suppressed']);
    const s2 = await mkSubscriber(['lead.created']); // not subscribed to the event
    await seedHistory(s1, prospect.id);
    await seedHistory(s1, orphan.id, 'lead.assigned');
    await seedHistory(s2, prospect.id);

    const { svc, flushed } = svcWithSpy();
    const counts = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(counts.pairsInserted).toBe(2);
    expect(counts.queued).toBe(2);

    const pairs = await pairsOf(s1.id);
    expect(pairs.map((p) => p.prospectId).sort()).toEqual([prospect.id, orphan.id].sort());
    for (const pair of pairs) {
      expect(pair.scope).toBe('marketing');
      expect(pair.reason).toBe('unsubscribe');
      expect(pair.queuedAt).toBeTruthy();
      expect(new Date(pair.occurredAt).getTime()).toBe(new Date(suppression.createdAt).getTime());
    }
    expect(await pairsOf(s2.id)).toHaveLength(0);

    const delivery = await WebhookDelivery.findOne({
      where: { subscriberId: s1.id, eventType: 'lead.suppressed', deliveryId: pairs[0].deliveryId },
    });
    expect(delivery).toBeTruthy();
    const raw = JSON.stringify(delivery.payload);
    expect(delivery.payload.data.suppression).toMatchObject({
      schemaVersion: 1, scope: 'marketing', reason: 'unsubscribe', channel: 'all',
    });
    expect(delivery.payload.data.lead.externalId).toBe(pairs[0].prospectId);
    expect(raw).not.toContain(consumer.id);        // no consumerId — payload contract
    expect(raw).not.toContain(phone);              // no phone
    expect(raw).not.toContain('Prop');             // no name
    expect(flushed.filter((f) => f.subscriber.id === s1.id)).toHaveLength(2);
  });

  test('deterministic and concurrency-safe: repeat + parallel passes add nothing', async () => {
    const phone = p8(2);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);

    // TRUE contention (Codex diff-round #11): project pairs UNQUEUED first
    // (webhooks disabled), then race two live passes for both the INSERT
    // conflict and the CAS queue claim.
    const { svc } = svcWithSpy();
    process.env.WEBHOOK_ENABLED = 'false';
    try {
      await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    } finally {
      process.env.WEBHOOK_ENABLED = 'true';
    }
    expect((await pairsOf(s1.id))[0].queuedAt).toBeNull();

    const { svc: svcB } = svcWithSpy();
    const [a, b] = await Promise.all([
      svc.reconcileSuppressionPropagation({ consumerId: consumer.id }),
      svcB.reconcileSuppressionPropagation({ consumerId: consumer.id }),
    ]);
    expect((await pairsOf(s1.id)).length).toBe(1);
    expect(a.pairsInserted + b.pairsInserted).toBe(0); // both hit ON CONFLICT
    expect(a.queued + b.queued).toBe(1); // exactly one CAS claim won
    expect(
      await WebhookDelivery.count({ where: { subscriberId: s1.id, eventType: 'lead.suppressed' } })
    ).toBe(1);

    // Third pass: fully settled, nothing to do.
    const c = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(c.pairsInserted + c.queued + c.requeued).toBe(0);
  });

  test('call_bot arms: DDI-phone rows never match; inbound callers match via fromNumber', async () => {
    const phone = p8(21);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });

    // A STRANGER's call_bot lead whose stored phone (the DDI) happens to
    // equal this consumer's number — must NOT be suppressed.
    const strangerCall = await Prospect.create({
      firstName: 'Stranger', phone: `+65${phone}`, campaignId: campaign2.id,
      leadSource: 'call_bot', consumerId: null,
      sourceMetadata: { fromNumber: '+6560000001' },
    });
    // THIS person calling in: DDI stored as phone, THEIR number in fromNumber.
    const inboundCall = await Prospect.create({
      firstName: 'Caller', phone: '+6562773210', campaignId: campaign2.id,
      leadSource: 'call_bot', consumerId: null,
      sourceMetadata: { fromNumber: `+65${phone}` },
    });
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);
    await seedHistory(s1, strangerCall.id);
    await seedHistory(s1, inboundCall.id);

    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pairedProspects = (await pairsOf(s1.id)).map((p) => p.prospectId).sort();
    expect(pairedProspects).toEqual([prospect.id, inboundCall.id].sort());
    expect(pairedProspects).not.toContain(strangerCall.id);
  });

  test('dark → flip backfill: nothing while unsubscribed, whole backlog on the first pass after', async () => {
    const phone = p8(3);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const s1 = await mkSubscriber(['lead.created']); // dark: event not carried
    await seedHistory(s1, prospect.id);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });

    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(await pairsOf(s1.id)).toHaveLength(0);

    await s1.update({ events: ['lead.created', 'lead.suppressed'] }); // the "flag flip"
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pairs = await pairsOf(s1.id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].queuedAt).toBeTruthy();
  });

  test('future lead: a new signup by an already-suppressed person projects on the next pass', async () => {
    const phone = p8(4);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);

    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(await pairsOf(s1.id)).toHaveLength(1);

    const later = await capture(phone, campaign2); // same person, new campaign
    expect(later.consumerId).toBe(consumer.id);
    await seedHistory(s1, later.id); // its lead.created delivery
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pairs = await pairsOf(s1.id);
    expect(pairs.map((p) => p.prospectId).sort()).toEqual([prospect.id, later.id].sort());
  });
});

describe('erasure escalation + interplay', () => {
  test('escalation matrix: marketing pair joined by all-pair; lead.deleted handlers get the outbox, not a pair; pending lead.suppressed survives erasure', async () => {
    const phone = p8(5);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const sSuppOnly = await mkSubscriber(['lead.suppressed']);
    const sBoth = await mkSubscriber(['lead.suppressed', 'lead.deleted']);
    await seedHistory(sSuppOnly, prospect.id);
    await seedHistory(sBoth, prospect.id);

    const { svc, flushed } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(sSuppOnly.id)).map((p) => p.scope)).toEqual(['marketing']);
    expect((await pairsOf(sBoth.id)).map((p) => p.scope)).toEqual(['marketing']);
    const pendingBefore = await WebhookDelivery.findOne({
      where: { subscriberId: sSuppOnly.id, eventType: 'lead.suppressed' },
    });
    await pendingBefore.update({ status: 'pending' }); // simulate not-yet-attempted

    // Erase — build with flush spy + the same reconciler wiring as prod.
    const erasure = makeErasureService({
      flushDeliveries: (pairs) => flushed.push(...pairs),
      reconcileSuppressionPropagation: svc.reconcileSuppressionPropagation,
    });
    const report = await erasure.eraseConsumer(consumer.id, { actorUser: admin.user });
    expect(report.alreadyErased).toBe(false);
    // The erasure's own trigger is fire-and-forget; run a deterministic pass.
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    const suppOnlyScopes = (await pairsOf(sSuppOnly.id)).map((p) => p.scope).sort();
    expect(suppOnlyScopes).toEqual(['all', 'marketing']);
    const allPair = (await pairsOf(sSuppOnly.id)).find((p) => p.scope === 'all');
    expect(allPair.reason).toBe('erasure');
    expect(new Date(allPair.occurredAt).getTime()).toBe(
      new Date((await Consumer.findByPk(consumer.id)).erasedAt).getTime()
    );

    // lead.deleted-handling subscriber: NO all-pair, but the erasure outbox row exists.
    expect((await pairsOf(sBoth.id)).map((p) => p.scope)).toEqual(['marketing']);
    expect(await WebhookDelivery.count({
      where: { subscriberId: sBoth.id, eventType: 'lead.deleted' },
    })).toBe(1);

    // The pending lead.suppressed delivery was neither cancelled nor scrubbed.
    await pendingBefore.reload();
    expect(pendingBefore.status).toBe('pending');
    expect(pendingBefore.payload.data.suppression.scope).toBe('marketing');
  });
});

describe('queue durability', () => {
  test('terminally-failed delivery re-queues once per pass while subscribed; not after unsubscribing', async () => {
    const phone = p8(6);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);

    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pair = (await pairsOf(s1.id))[0];
    const firstDeliveryId = pair.deliveryId;
    await WebhookDelivery.update(
      { status: 'failed' }, { where: { deliveryId: firstDeliveryId } }
    );

    const counts = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(counts.requeued).toBe(1);
    await pair.reload();
    expect(pair.deliveryId).not.toBe(firstDeliveryId);
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.suppressed' },
    })).toBe(2);

    // New delivery pending → nothing further this pass.
    const again = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(again.requeued + again.queued).toBe(0);

    // Kill switch: no longer subscribed → a failed row stays dead.
    await WebhookDelivery.update({ status: 'failed' }, { where: { deliveryId: pair.deliveryId } });
    await s1.update({ events: ['lead.created'] });
    const dark = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(dark.requeued).toBe(0);

    // Purged dead-letter (Codex diff-round #5): delete the failed row outright
    // — the dangling pair must still requeue once re-subscribed (re-flip).
    await WebhookDelivery.destroy({ where: { deliveryId: pair.deliveryId } });
    await s1.update({ events: ['lead.suppressed'] });
    const revived = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(revived.requeued).toBe(1);
    await pair.reload();
    expect(await WebhookDelivery.count({ where: { deliveryId: pair.deliveryId } })).toBe(1);
  });

  test('dark erasure: deleted-capable subscriber still gets the scope-all fallback when no lead.deleted row exists (outcome-based rule)', async () => {
    const phone = p8(22);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const sBoth = await mkSubscriber(['lead.suppressed', 'lead.deleted']);
    await seedHistory(sBoth, prospect.id);

    // Erase while webhooks are DISABLED — PR C queues no lead.deleted outbox.
    const erasure = makeErasureService({
      flushDeliveries: () => {},
      reconcileSuppressionPropagation: async () => ({}),
    });
    process.env.WEBHOOK_ENABLED = 'false';
    try {
      await erasure.eraseConsumer(consumer.id, { actorUser: admin.user });
    } finally {
      process.env.WEBHOOK_ENABLED = 'true';
    }
    expect(await WebhookDelivery.count({
      where: { subscriberId: sBoth.id, eventType: 'lead.deleted' },
    })).toBe(0);

    // The reconciler must NOT skip on capability alone — no deleted row exists,
    // so the stop-contact ships as the suppression fallback.
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pairs = await pairsOf(sBoth.id);
    expect(pairs.map((p) => p.scope)).toEqual(['all']);
    expect(pairs[0].reason).toBe('erasure');
  });

  test('flush-time catchup: payload-event flushes nudge the reconciler for spine-linked leads (assignment/release choke point)', async () => {
    const phone = p8(23);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.created', 'lead.suppressed']);

    // Wiring proof: makeWebhookService with a spy catchup — flushDeliveries
    // forwards the pairs.
    const catchupSpy = jest.fn();
    const { makeWebhookService } = await import('../../src/services/webhookService.js');
    const wh = makeWebhookService({ propagationCatchup: catchupSpy });
    const fakePair = {
      delivery: { eventType: 'lead.assigned', payload: { data: { lead: { externalId: prospect.id } } } },
      subscriber: s1,
    };
    // enqueueDelivery will attempt this fake pair; give it harmless model-less
    // stubs so background failure handling has something to call.
    fakePair.delivery.update = async () => fakePair.delivery;
    wh.flushDeliveries([fakePair]);
    expect(catchupSpy).toHaveBeenCalledWith([fakePair]);

    // End-to-end proof through the DEFAULT chain: a real lead.assigned
    // delivery row flushed → catchup reconciles → the pair appears.
    const history = await seedHistory(s1, prospect.id, 'lead.assigned');
    await history.update({ status: 'pending' });
    const { flushDeliveries: realFlush } = await import('../../src/services/webhookService.js');
    realFlush([{ delivery: history, subscriber: s1 }]);
    const deadline = Date.now() + 4000;
    let pairs = [];
    while (Date.now() < deadline) {
      pairs = await pairsOf(s1.id);
      if (pairs.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prospectId).toBe(prospect.id);
  });

  test('WEBHOOK_ENABLED=false: pairs projected (durability), queueing deferred until re-enabled', async () => {
    const phone = p8(7);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);

    const { svc } = svcWithSpy();
    process.env.WEBHOOK_ENABLED = 'false';
    try {
      const counts = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
      expect(counts.pairsInserted).toBe(1);
      expect(counts.queued).toBe(0);
      expect((await pairsOf(s1.id))[0].queuedAt).toBeNull();
    } finally {
      process.env.WEBHOOK_ENABLED = 'true';
    }
    const counts2 = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(counts2.queued).toBe(1);
    expect((await pairsOf(s1.id))[0].queuedAt).toBeTruthy();
  });
});

describe('writer triggers + end-to-end', () => {
  test('applyUnsubscribe fires the reconciler on both first and repeat calls', async () => {
    const phone = p8(8);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const spy = jest.fn().mockResolvedValue({});
    const consent = makeConsentService({ reconcileSuppressionPropagation: spy });

    const r1 = await consent.applyUnsubscribe(consumer, { source: 'test' });
    expect(r1.alreadySuppressed).toBe(false);
    const r2 = await consent.applyUnsubscribe(consumer, { source: 'test' });
    expect(r2.alreadySuppressed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ consumerId: consumer.id });
  });

  test('POST /api/unsubscribe projects pairs through the real default chain', async () => {
    const phone = p8(9);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const s1 = await mkSubscriber(['lead.suppressed']);
    await seedHistory(s1, prospect.id);
    const token = await ensureUnsubToken(consumer.id);

    const res = await request(app).post(`/api/unsubscribe?t=${token}`).send({});
    expect(res.status).toBe(200);

    // The trigger is post-commit fire-and-forget — poll briefly.
    const deadline = Date.now() + 4000;
    let pairs = [];
    while (Date.now() < deadline) {
      pairs = await pairsOf(s1.id);
      if (pairs.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prospectId).toBe(prospect.id);
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.suppressed' },
    })).toBe(1);
  });
});

describe('bootstrap env-gated subscription', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    for (const k of ['LYFE_WEBHOOK_URL', 'LYFE_WEBHOOK_SECRET', 'LYFE_LEAD_SUPPRESSED_ENABLED',
      'MKTR_LEADS_WEBHOOK_URL', 'MKTR_LEADS_WEBHOOK_SECRET', 'MKTR_LEADS_LEAD_SUPPRESSED_ENABLED']) {
      if (ORIG[k] === undefined) delete process.env[k]; else process.env[k] = ORIG[k];
    }
  });

  test('flag on → events gain lead.suppressed (update AND create paths); flag off → removed', async () => {
    process.env.LYFE_WEBHOOK_URL = 'https://lyfe-test.invalid/hook';
    process.env.LYFE_WEBHOOK_SECRET = 'shh';

    // CREATE path with the flag on (Codex #15 — the literal-array hole).
    await WebhookSubscriber.destroy({ where: { name: 'Lyfe App' } });
    process.env.LYFE_LEAD_SUPPRESSED_ENABLED = 'true';
    await ensureLyfeWebhookSubscriber();
    let sub = await WebhookSubscriber.findOne({ where: { name: 'Lyfe App' } });
    expect(sub.events).toContain('lead.suppressed');
    expect(sub.events).toContain('lead.unsuppressed');

    // Self-heal removal on flag off (UPDATE path).
    process.env.LYFE_LEAD_SUPPRESSED_ENABLED = 'false';
    await ensureLyfeWebhookSubscriber();
    sub = await WebhookSubscriber.findOne({ where: { name: 'Lyfe App' } });
    expect(sub.events).not.toContain('lead.suppressed');
    expect(sub.events).not.toContain('lead.unsuppressed');

    // UPDATE path addition on flag on.
    process.env.LYFE_LEAD_SUPPRESSED_ENABLED = 'true';
    await ensureLyfeWebhookSubscriber();
    sub = await WebhookSubscriber.findOne({ where: { name: 'Lyfe App' } });
    expect(sub.events).toContain('lead.suppressed');
    await WebhookSubscriber.destroy({ where: { name: 'Lyfe App' } });
  });

  test('mktr-leads flag mirrors the same behavior', async () => {
    process.env.MKTR_LEADS_WEBHOOK_URL = 'https://ml-test.invalid/hook';
    process.env.MKTR_LEADS_WEBHOOK_SECRET = 'shh';
    await WebhookSubscriber.destroy({ where: { name: 'MKTR Leads App' } });
    process.env.MKTR_LEADS_LEAD_SUPPRESSED_ENABLED = 'true';
    await ensureMktrLeadsWebhookSubscriber();
    let sub = await WebhookSubscriber.findOne({ where: { name: 'MKTR Leads App' } });
    expect(sub.events).toEqual(expect.arrayContaining(['lead.deleted', 'lead.suppressed']));
    process.env.MKTR_LEADS_LEAD_SUPPRESSED_ENABLED = 'false';
    await ensureMktrLeadsWebhookSubscriber();
    sub = await WebhookSubscriber.findOne({ where: { name: 'MKTR Leads App' } });
    expect(sub.events).not.toContain('lead.suppressed');
    await WebhookSubscriber.destroy({ where: { name: 'MKTR Leads App' } });
  });
});

describe('resubscribe lift (plan v3)', () => {
  /** Verified agree-all capture — the lift trigger. */
  async function captureAgreeAll(phone8, campaignArg = campaign, { verify = true } = {}) {
    if (verify) markPhoneVerified(`+65${phone8}`);
    const res = await request(app).post('/api/prospects').send({
      firstName: 'Re',
      lastName: 'Subscriber',
      email: `resub-${phone8}-${Date.now()}@test.com`,
      phone: phone8,
      campaignId: campaignArg.id,
      leadSource: 'website',
      consent_contact: true,
      consent_terms: true,
      consent_copy_version: '2026-07-21-agree-all-v1',
    });
    expect(res.status).toBe(201);
    return Prospect.findByPk(res.body.data.prospect.id);
  }

  test('verified agree-all capture lifts an unsubscribe: row gone, ledger evidence, canMarketTo true, pairs flip to lead.unsuppressed', async () => {
    const phone = p8(31);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'unsubscribe_link' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    let pairs = await pairsOf(s1.id);
    expect(pairs[0].state).toBe('suppressed');
    expect(pairs[0].deliveredState).toBe('suppressed');

    await captureAgreeAll(phone, campaign2);

    // MKTR side: suppression gone + evidence + gate opens.
    expect(await ConsumerSuppression.count({ where: { consumerId: consumer.id } })).toBe(0);
    const evidence = await ConsentEvent.findOne({
      where: { consumerId: consumer.id, source: 'resubscribe' },
    });
    expect(evidence).toBeTruthy();
    expect(evidence.granted).toBe(true);
    expect(evidence.verified).toBe(true);
    expect(evidence.campaignId).toBeNull();
    expect(evidence.metadata.lift.reason).toBe('unsubscribe');
    expect(await canMarketTo({ consumerId: consumer.id, campaignId: campaign2.id })).toBe(true);

    // Downstream: pair flips + lead.unsuppressed queued with the evidence watermark.
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    pairs = await pairsOf(s1.id);
    expect(pairs[0].state).toBe('lifted');
    expect(pairs[0].deliveredState).toBe('lifted');
    expect(new Date(pairs[0].occurredAt).getTime()).toBe(new Date(evidence.occurredAt).getTime());
    const lifts = await WebhookDelivery.findAll({
      where: { subscriberId: s1.id, eventType: 'lead.unsuppressed' },
    });
    expect(lifts).toHaveLength(1);
    expect(lifts[0].payload.data.unsuppression).toMatchObject({ schemaVersion: 1, scope: 'marketing', reason: 'resubscribe' });
    expect(JSON.stringify(lifts[0].payload)).not.toContain(consumer.id);
  });

  test('no lift without OTP verification, on the legacy era, or for admin-reason suppressions', async () => {
    // Unverified agree-all: no lift.
    const phoneA = p8(32);
    const pA = await capture(phoneA);
    const cA = await Consumer.findByPk(pA.consumerId);
    await ConsumerSuppression.create({ consumerId: cA.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    await captureAgreeAll(phoneA, campaign2, { verify: false });
    expect(await ConsumerSuppression.count({ where: { consumerId: cA.id } })).toBe(1);

    // Verified but LEGACY era (no consent_copy_version): no lift.
    const phoneB = p8(33);
    const pB = await capture(phoneB);
    const cB = await Consumer.findByPk(pB.consumerId);
    await ConsumerSuppression.create({ consumerId: cB.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    markPhoneVerified(`+65${phoneB}`);
    const legacy = await request(app).post('/api/prospects').send({
      firstName: 'Legacy', lastName: 'Era', email: `legacy-${phoneB}@test.com`,
      phone: phoneB, campaignId: campaign2.id, leadSource: 'website',
      consent_contact: true, consent_terms: true,
    });
    expect(legacy.status).toBe(201);
    expect(await ConsumerSuppression.count({ where: { consumerId: cB.id } })).toBe(1);

    // Admin-reason suppression: never auto-lifts.
    const phoneC = p8(34);
    const pC = await capture(phoneC);
    const cC = await Consumer.findByPk(pC.consumerId);
    await ConsumerSuppression.create({ consumerId: cC.id, channel: 'all', reason: 'admin', source: 'test' });
    await captureAgreeAll(phoneC, campaign2);
    const surviving = await ConsumerSuppression.findOne({ where: { consumerId: cC.id } });
    expect(surviving.reason).toBe('admin');
    expect(await ConsentEvent.count({ where: { consumerId: cC.id, source: 'resubscribe' } })).toBe(0);
  });

  test('cycle: lift then re-unsubscribe flips pairs back and redelivers with a newer watermark', async () => {
    const phone = p8(35);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    await captureAgreeAll(phone, campaign2);
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    let pair = (await pairsOf(s1.id))[0];
    expect(pair.state).toBe('lifted');
    const liftAt = new Date(pair.occurredAt).getTime();

    // Person changes their mind again.
    const consent = makeConsentService({ reconcileSuppressionPropagation: async () => ({}) });
    await consent.applyUnsubscribe(consumer, { source: 'test' });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    pair = (await pairsOf(s1.id))[0];
    expect(pair.state).toBe('suppressed');
    expect(pair.deliveredState).toBe('suppressed');
    expect(new Date(pair.occurredAt).getTime()).toBeGreaterThan(liftAt);
    // Delivery sequence: suppressed, unsuppressed, suppressed.
    const seq = await WebhookDelivery.findAll({
      where: { subscriberId: s1.id, eventType: { [Op.in]: ['lead.suppressed', 'lead.unsuppressed'] } },
      order: [['createdAt', 'ASC']],
    });
    expect(seq.map((r) => r.eventType)).toEqual(['lead.suppressed', 'lead.unsuppressed', 'lead.suppressed']);
  });

  test('evidence-driven only: a manual suppression-row delete without a resubscribe event never flips pairs', async () => {
    const phone = p8(36);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    await ConsumerSuppression.destroy({ where: { consumerId: consumer.id } }); // manual, no evidence
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pair = (await pairsOf(s1.id))[0];
    expect(pair.state).toBe('suppressed'); // no flip without the ledger event
  });

  test("the 'all' lane is a latch: erasure pairs never lift even with resubscribe evidence", async () => {
    const phone = p8(37);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const s1 = await mkSubscriber(['lead.suppressed']); // suppressed-only → gets the erasure fallback pair
    await seedHistory(s1, prospect.id);
    const erasure = makeErasureService({
      flushDeliveries: () => {},
      reconcileSuppressionPropagation: async () => ({}),
    });
    await erasure.eraseConsumer(consumer.id, { actorUser: admin.user });
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    let pairs = await pairsOf(s1.id);
    expect(pairs.map((p) => p.scope)).toEqual(['all']);

    // Even with (synthetic) resubscribe evidence, 'all' never flips.
    await ConsentEvent.create({
      consumerId: consumer.id, prospectId: null, campaignId: null,
      kind: 'contact', granted: true, channels: null,
      version: '2026-07-21-agree-all-v1', source: 'resubscribe',
      verified: true, occurredAt: new Date(),
    });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    pairs = await pairsOf(s1.id);
    expect(pairs[0].state).toBe('suppressed');
  });

  test('a subscriber without lead.unsuppressed keeps lifted pairs unqueued until its allowlist catches up', async () => {
    const phone = p8(38);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed']); // no lead.unsuppressed
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    await captureAgreeAll(phone, campaign2);
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    let pair = (await pairsOf(s1.id))[0];
    expect(pair.state).toBe('lifted');
    expect(pair.deliveredState).toBe('suppressed'); // flip NOT queued
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.unsuppressed' },
    })).toBe(0);

    await s1.update({ events: ['lead.suppressed', 'lead.unsuppressed'] });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    pair = (await pairsOf(s1.id))[0];
    expect(pair.deliveredState).toBe('lifted');
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.unsuppressed' },
    })).toBe(1);
  });

  test('prod-constraint parity: lift writes pass with 080/083 CHECKs + 086 surgery applied', async () => {
    // Test schemas are sync-built (no migration CHECKs) — recreate prod's
    // gauntlet, run 086's surgery over it, then prove the full lift E2E.
    await sequelize.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ce_source') THEN
        ALTER TABLE consent_events ADD CONSTRAINT chk_ce_source
          CHECK (source IN ('signup','backfill','unsubscribe','admin','erasure')) NOT VALID;
      END IF; END $$`);
    await sequelize.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sp_reason') THEN
        ALTER TABLE suppression_propagations ADD CONSTRAINT chk_sp_reason
          CHECK (reason IN ('unsubscribe','complaint','admin','erasure')) NOT VALID;
      END IF; END $$`);
    const { up: up086 } = await import('../../src/database/migrations/086-suppression-lift.js');
    await up086({ sequelize });

    const phone = p8(41);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    await captureAgreeAll(phone, campaign2); // resubscribe event INSERT passes chk_ce_source
    expect(await ConsentEvent.count({ where: { consumerId: consumer.id, source: 'resubscribe' } })).toBe(1);
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id }); // reason='resubscribe' passes chk_sp_reason
    expect((await pairsOf(s1.id))[0].state).toBe('lifted');
  });

  test('stale-evidence replay: an old resubscribe cannot lift after a NEWER unsubscribe is manually removed', async () => {
    const phone = p8(42);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id }); // S1 pair

    await captureAgreeAll(phone, campaign2); // R1 lift
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(s1.id))[0].state).toBe('lifted');

    // S2: re-unsubscribe (newer than R1) → suppressed again.
    const consent = makeConsentService({ reconcileSuppressionPropagation: async () => ({}) });
    await consent.applyUnsubscribe(consumer, { source: 'test' });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(s1.id))[0].state).toBe('suppressed');

    // S2's row vanishes WITHOUT evidence (manual/admin mistake). Old R1 must
    // NOT resurrect the lift: pair.occurredAt (S2) is newer than R1.
    await ConsumerSuppression.destroy({ where: { consumerId: consumer.id } });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(s1.id))[0].state).toBe('suppressed');
  });

  test('equal-watermark tie never lifts (fail-safe toward suppressed)', async () => {
    const phone = p8(43);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    const suppression = await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pair = (await pairsOf(s1.id))[0];

    // Synthetic resubscribe evidence with occurredAt EXACTLY equal to the
    // pair's suppressed transition; suppression row removed so only the
    // watermark predicate decides.
    await ConsentEvent.create({
      consumerId: consumer.id, prospectId: null, campaignId: null,
      kind: 'contact', granted: true, channels: null,
      version: '2026-07-21-agree-all-v1', source: 'resubscribe',
      verified: true, occurredAt: pair.occurredAt,
    });
    await suppression.destroy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(s1.id))[0].state).toBe('suppressed'); // tie → no lift
  });

  test('a subscriber with ONLY lead.unsuppressed still receives its lifts', async () => {
    const phone = p8(44);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });

    // Subscriber drops lead.suppressed (keeps unsuppressed) BEFORE the lift.
    await s1.update({ events: ['lead.created', 'lead.unsuppressed'] });
    await captureAgreeAll(phone, campaign2);
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pair = (await pairsOf(s1.id))[0];
    expect(pair.state).toBe('lifted');
    expect(pair.deliveredState).toBe('lifted');
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.unsuppressed' },
    })).toBe(1);
  });

  test('a failed lead.unsuppressed delivery re-queues', async () => {
    const phone = p8(45);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    await captureAgreeAll(phone, campaign2);
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const pair = (await pairsOf(s1.id))[0];
    expect(pair.deliveredState).toBe('lifted');

    await WebhookDelivery.update({ status: 'failed' }, { where: { deliveryId: pair.deliveryId } });
    const counts = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect(counts.requeued).toBe(1);
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.unsuppressed' },
    })).toBe(2);
  });

  test('the lift fires the reconciler post-commit by itself (no delivery-flush dependency)', async () => {
    const phone = p8(46);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });

    const spy = jest.fn().mockResolvedValue({});
    const consent = makeConsentService({ reconcileSuppressionPropagation: spy });
    let committed = false;
    await sequelize.transaction(async (t) => {
      await consent.recordCaptureConsentEventsTx(t, {
        consumerId: consumer.id, prospectId: prospect.id, campaignId: campaign2.id,
        verified: true, contact: true, copyVersion: '2026-07-21-agree-all-v1', terms: true,
      });
      expect(spy).not.toHaveBeenCalled(); // must wait for the COMMIT
      committed = true;
    });
    expect(committed).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // afterCommit is async
    expect(spy).toHaveBeenCalledWith({ consumerId: consumer.id });
    expect(await ConsumerSuppression.count({ where: { consumerId: consumer.id } })).toBe(0);
  });

  test('coalesced transitions: S1→lift→S2 with NO reconcile between, then S2 manually removed → ledger withdrawal still blocks the stale lift', async () => {
    const phone = p8(51);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    // S1 with a ledger withdrawal event (as applyUnsubscribe writes).
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    await ConsentEvent.create({
      consumerId: consumer.id, prospectId: null, campaignId: null,
      kind: 'contact', granted: false, channels: null,
      version: '2026-07-21-agree-all-v1', source: 'unsubscribe',
      verified: false, occurredAt: new Date(Date.now() - 3000),
    });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id }); // pair @ S1

    // R1 lift + S2 re-unsubscribe happen back-to-back with NO reconcile pass
    // in between (evidence constructed manually so no capture/writer trigger
    // can slip a pass in): the pair watermark stays at S1, older than R1.
    await ConsumerSuppression.destroy({ where: { consumerId: consumer.id } }); // R1's lift removes S1's row…
    await ConsentEvent.create({ // …and writes the resubscribe evidence
      consumerId: consumer.id, prospectId: null, campaignId: null,
      kind: 'contact', granted: true, channels: null,
      version: '2026-07-21-agree-all-v1', source: 'resubscribe',
      verified: true, occurredAt: new Date(Date.now() - 2000),
    });
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test-s2' }); // S2 row
    await ConsentEvent.create({ // S2's withdrawal evidence (append-only, survives everything)
      consumerId: consumer.id, prospectId: null, campaignId: null,
      kind: 'contact', granted: false, channels: null,
      version: '2026-07-21-agree-all-v1', source: 'unsubscribe',
      verified: false, occurredAt: new Date(Date.now() - 1000),
    });

    // S2's ROW is then manually removed (out-of-band mistake). Its ledger
    // withdrawal event is append-only and survives — R1 predates it, so the
    // lift must NOT fire.
    await ConsumerSuppression.destroy({ where: { consumerId: consumer.id } });
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    expect((await pairsOf(s1.id))[0].state).toBe('suppressed');
  });

  test('stale-watermark maintenance: a suppressed pair lagging a NEWER suppression refreshes its watermark and redelivers', async () => {
    const phone = p8(52);
    const prospect = await capture(phone);
    const consumer = await Consumer.findByPk(prospect.consumerId);
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test' });
    const s1 = await mkSubscriber(['lead.suppressed', 'lead.unsuppressed']);
    await seedHistory(s1, prospect.id);
    const { svc } = svcWithSpy();
    await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const before = (await pairsOf(s1.id))[0];
    const beforeAt = new Date(before.occurredAt).getTime();

    // Simulate the coalesced lift+re-unsubscribe: replace the suppression row
    // with a NEWER one while the pair still carries the old watermark.
    await ConsumerSuppression.destroy({ where: { consumerId: consumer.id } });
    await new Promise((r) => setTimeout(r, 25));
    await ConsumerSuppression.create({ consumerId: consumer.id, channel: 'all', reason: 'unsubscribe', source: 'test-2' });

    const counts = await svc.reconcileSuppressionPropagation({ consumerId: consumer.id });
    const after = (await pairsOf(s1.id))[0];
    expect(after.state).toBe('suppressed');
    expect(new Date(after.occurredAt).getTime()).toBeGreaterThan(beforeAt); // watermark advanced
    expect(counts.queued).toBe(1); // redelivered with the fresh watermark
    expect(await WebhookDelivery.count({
      where: { subscriberId: s1.id, eventType: 'lead.suppressed' },
    })).toBe(2);
  });

  test('buildLeadUnsuppressedPayload: exact v1 shape', () => {
    const at = new Date('2026-07-22T10:00:00.000Z');
    const p = buildLeadUnsuppressedPayload('xyz-1', { reason: 'resubscribe', occurredAt: at });
    expect(p.event).toBe('lead.unsuppressed');
    expect(p.data.lead).toEqual({ externalId: 'xyz-1' });
    expect(p.data.unsuppression).toEqual({
      schemaVersion: 1, scope: 'marketing', reason: 'resubscribe',
      occurredAt: '2026-07-22T10:00:00.000Z',
    });
  });
});

describe('payload builder contract', () => {
  test('buildLeadSuppressedPayload: exact v1 shape, Date and string occurredAt both normalize', () => {
    const at = new Date('2026-07-21T06:00:00.000Z');
    const p = buildLeadSuppressedPayload('abc-123', { scope: 'all', reason: 'erasure', occurredAt: at });
    expect(p.event).toBe('lead.suppressed');
    expect(p.data.lead).toEqual({ externalId: 'abc-123' });
    expect(p.data.suppression).toEqual({
      schemaVersion: 1, scope: 'all', reason: 'erasure', channel: 'all',
      occurredAt: '2026-07-21T06:00:00.000Z',
    });
    expect(Object.keys(p.data)).toEqual(['lead', 'suppression']); // nothing else rides along
  });
});
