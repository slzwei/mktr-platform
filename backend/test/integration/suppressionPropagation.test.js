/**
 * Suppression propagation (tracker "propagate") — the durable projection +
 * reconciler behind the lead.suppressed webhook. Real Postgres: the DB unique
 * is the idempotency and the CAS claims are the concurrency story — mocks
 * cannot prove either. Plan: docs/plans/suppression-propagation-plan.md §5.
 */
process.env.WEBHOOK_ENABLED = 'true';

import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import {
  getApp, closeDb, createTestUser, createTestCampaign,
} from '../helpers.js';
import { Consumer, Prospect, WebhookSubscriber, WebhookDelivery,
  SuppressionPropagation, ConsumerSuppression,
} from '../../src/models/index.js';
import { makeSuppressionPropagationService } from '../../src/services/suppressionPropagationService.js';
import { makeConsentService, ensureUnsubToken } from '../../src/services/consentService.js';
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

    // Self-heal removal on flag off (UPDATE path).
    process.env.LYFE_LEAD_SUPPRESSED_ENABLED = 'false';
    await ensureLyfeWebhookSubscriber();
    sub = await WebhookSubscriber.findOne({ where: { name: 'Lyfe App' } });
    expect(sub.events).not.toContain('lead.suppressed');

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
