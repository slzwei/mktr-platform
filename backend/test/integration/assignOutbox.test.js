/**
 * P4-5 — the admin assign paths are a transactional outbox.
 *
 * assignProspect's held-release and bulkAssignProspects used to flip state in
 * an autocommit UPDATE and fire the webhook AFTER — a crash in between left a
 * lead released-from-hold but never queued for delivery, invisibly. These
 * tests pin the converged contract against real Postgres:
 *
 *   1. ATOMICITY — any failure between the state flip and the delivery-row
 *      write (the crash window) rolls the release back: the lead stays held.
 *   2. FAIL-CLOSED — a held lead is never released toward a destinationed app
 *      that has no deliverable subscriber (409, hold intact) — the same
 *      'undeliverable' contract releaseHeldProspect already had.
 *   3. DURABILITY + RECOVERY — the delivery rows commit WITH the release, so
 *      a crash after commit but before the flush leaves pending rows that
 *      recoverPendingRetries() (the startup/60s poller) actually delivers.
 */
import { jest } from '@jest/globals';
import {
  getApp, closeDb,
  createTestUser, createTestCampaign, createTestProspect,
} from '../helpers.js';
import { sequelize, ProspectActivity, WebhookSubscriber, WebhookDelivery } from '../../src/models/index.js';
import { makeProspectService } from '../../src/services/prospectService.js';
import { makeWebhookService } from '../../src/services/webhookService.js';

const RUN = Date.now();

let adminUser;
let lyfeAgent;   // destinationed (lyfeId) — deliveries expected
let campaign;
let origWebhookEnabled;

const admin = () => ({ id: adminUser.id, role: 'admin' });

const heldProspect = () =>
  createTestProspect(campaign.id, {
    quarantinedAt: new Date(),
    quarantineReason: 'returned_by_admin',
    assignedAgentId: null,
  });

const deliveriesForLead = async (prospectId) =>
  (await WebhookDelivery.findAll({ where: { eventType: 'lead.assigned' } }))
    .filter((row) => row.payload?.data?.lead?.externalId === prospectId);

beforeAll(async () => {
  origWebhookEnabled = process.env.WEBHOOK_ENABLED;
  await getApp();
  adminUser = (await createTestUser({ role: 'admin' })).user;
  lyfeAgent = (await createTestUser({
    role: 'agent',
    firstName: 'Outbox',
    lastName: 'Agent',
    lyfeId: `lyfe-outbox-${RUN}`,
    phone: `+6591${String(RUN).slice(-6)}`,
  })).user;
  campaign = await createTestCampaign(adminUser.id, { name: `Outbox Test ${RUN}` });
});

afterAll(async () => {
  process.env.WEBHOOK_ENABLED = origWebhookEnabled;
  await closeDb();
});

afterEach(() => {
  process.env.WEBHOOK_ENABLED = 'false';
});

describe('assignProspect held release — transactional outbox', () => {
  it('rolls the release back when the process dies in the flip→dispatch window (lead stays held)', async () => {
    const prospect = await heldProspect();
    const svc = makeProspectService({
      persistEventDeliveries: async () => {
        throw new Error('simulated crash before the delivery rows were written');
      },
    });

    await expect(svc.assignProspect(prospect.id, lyfeAgent.id, admin())).rejects.toThrow('simulated crash');

    // The old code would have left the hold cleared with nothing queued —
    // the exact stranding this outbox exists to prevent.
    await prospect.reload();
    expect(prospect.quarantinedAt).not.toBeNull();
    expect(prospect.quarantineReason).toBe('returned_by_admin');
    expect(prospect.assignedAgentId).toBeNull();

    // The in-transaction activity row rolled back with it.
    const acts = await ProspectActivity.findAll({ where: { prospectId: prospect.id, type: 'assigned' } });
    expect(acts).toHaveLength(0);
  });

  it('fails closed (409) and keeps the hold when the destination has no deliverable subscriber', async () => {
    process.env.WEBHOOK_ENABLED = 'true'; // enabled, but no lyfe-tagged subscriber exists
    const prospect = await heldProspect();
    const svc = makeProspectService();

    await expect(svc.assignProspect(prospect.id, lyfeAgent.id, admin())).rejects.toMatchObject({
      statusCode: 409,
    });

    await prospect.reload();
    expect(prospect.quarantinedAt).not.toBeNull();
    expect(prospect.assignedAgentId).toBeNull();
  });

  it('commits the delivery rows with the release; a crash before the flush is recovered by the poller', async () => {
    process.env.WEBHOOK_ENABLED = 'true';
    const subscriber = await WebhookSubscriber.create({
      name: `Lyfe Outbox ${RUN}`,
      url: `http://127.0.0.1:9/outbox-${RUN}`, // never actually hit — fetch is mocked below
      secret: 'outbox-test-secret',
      events: ['lead.assigned'],
      enabled: true,
      metadata: { destination: 'lyfe' },
    });
    try {
      const prospect = await heldProspect();
      // "Crash" after commit, before the fire-and-forget send: suppress the flush.
      const svc = makeProspectService({ flushDeliveries: () => {} });

      const res = await svc.assignProspect(prospect.id, lyfeAgent.id, admin());
      expect(res.agent?.id).toBe(lyfeAgent.id);

      await prospect.reload();
      expect(prospect.quarantinedAt).toBeNull();
      expect(prospect.assignedAgentId).toBe(lyfeAgent.id);

      // The delivery intent survived the "crash": a pending row committed with the release.
      const rows = await deliveriesForLead(prospect.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].attempts).toBe(0);

      // Make the row look stale (the poller's stranded-first-attempt clause:
      // status pending, nextRetryAt null, createdAt > 60s old) — raw SQL, since
      // Sequelize silently drops createdAt writes.
      await sequelize.query(
        `UPDATE webhook_deliveries SET "createdAt" = NOW() - INTERVAL '2 minutes' WHERE id = :id`,
        { replacements: { id: rows[0].id } }
      );

      // The recovery poller (runs at startup + every 60s in prod) picks it up and delivers.
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const wh = makeWebhookService({ fetch: fetchMock });
      await wh.recoverPendingRetries();
      // enqueueDelivery is fire-and-forget — wait for the attempt to land.
      const delivery = rows[0];
      for (let i = 0; i < 40 && (await delivery.reload()).status === 'pending'; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(fetchMock).toHaveBeenCalledWith(subscriber.url, expect.objectContaining({ method: 'POST' }));
      expect(delivery.status).toBe('success');
      expect(delivery.attempts).toBe(1);
    } finally {
      await WebhookDelivery.destroy({ where: { subscriberId: subscriber.id } });
      await subscriber.destroy();
    }
  });
});

describe('bulkAssignProspects — transactional outbox', () => {
  it('rolls the WHOLE batch back when the process dies in the flip→dispatch window', async () => {
    const held = await heldProspect();
    const fresh = await createTestProspect(campaign.id);
    const svc = makeProspectService({
      hasDeliverableSubscriber: async () => true, // pre-flight passes; the crash happens after the flip
      persistEventDeliveries: async () => {
        throw new Error('simulated crash before the delivery rows were written');
      },
    });

    await expect(svc.bulkAssignProspects([held.id, fresh.id], lyfeAgent.id, admin())).rejects.toThrow(
      'simulated crash'
    );

    await held.reload();
    await fresh.reload();
    expect(held.quarantinedAt).not.toBeNull();
    expect(held.assignedAgentId).toBeNull();
    expect(fresh.assignedAgentId).toBeNull();
    expect(await deliveriesForLead(held.id)).toHaveLength(0);
    expect(await deliveriesForLead(fresh.id)).toHaveLength(0);
  });

  it('persists one pending delivery per assigned lead inside the assignment transaction', async () => {
    process.env.WEBHOOK_ENABLED = 'true';
    const subscriber = await WebhookSubscriber.create({
      name: `Lyfe Outbox Bulk ${RUN}`,
      url: `http://127.0.0.1:9/outbox-bulk-${RUN}`,
      secret: 'outbox-test-secret',
      events: ['lead.assigned'],
      enabled: true,
      metadata: { destination: 'lyfe' },
    });
    try {
      const a = await heldProspect();
      const b = await createTestProspect(campaign.id);
      const svc = makeProspectService({ flushDeliveries: () => {} }); // crash after commit

      const res = await svc.bulkAssignProspects([a.id, b.id], lyfeAgent.id, admin());
      expect(res.affectedCount).toBe(2);
      expect(res.releasedCount).toBe(1);

      for (const p of [a, b]) {
        const rows = await deliveriesForLead(p.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('pending');
        // Batch context rode into the committed payload (receiver-side coalescing).
        expect(rows[0].payload?.data?.batch).toEqual({ id: expect.any(String), size: 2 });
      }
    } finally {
      await WebhookDelivery.destroy({ where: { subscriberId: subscriber.id } });
      await subscriber.destroy();
    }
  });
});
