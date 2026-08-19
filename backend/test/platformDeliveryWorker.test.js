/**
 * DB-backed worker coverage (ads-centralisation §3.3.7/§3.5/§3.6): due-scan
 * ordering + bounded concurrency, the expiry rules (runs with provider flags
 * off; transitions only unsent states + STALE sending — never an active
 * lease; a paused ledger still expires), the accept-then-disconnect provider
 * fake (at-least-once), the hourly outcome invariant sweep, and the daily
 * retention purge.
 */
import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { sequelize, PlatformDelivery } from '../src/models/index.js';
import {
  runDeliveryWorker,
  runExpiryPass,
  runOutcomeInvariantSweep,
  runRetentionPurge,
  processDelivery,
  _resetWorkerCadence,
} from '../src/services/platformDeliveryService.js';

let admin;
let campaign;

async function mintRow(prospectId, overrides = {}) {
  return PlatformDelivery.create({
    prospectId,
    platform: 'meta',
    eventKey: 'lead',
    eventId: `ev-${prospectId}-${overrides.eventKey || 'lead'}`,
    eventTime: new Date(),
    dedupeAnchorAt: new Date(),
    pixelId: 'pix-w',
    state: 'pending',
    ...overrides,
  });
}

async function forceRow(id, sets) {
  const cols = [];
  const repl = { id };
  for (const [k, v] of Object.entries(sets)) {
    cols.push(`"${k}" = :${k}`);
    repl[k] = v;
  }
  await sequelize.query(
    `UPDATE platform_deliveries SET ${cols.join(', ')}, "updatedAt" = now() WHERE id = :id`,
    { replacements: repl }
  );
}

const rowById = (id) => PlatformDelivery.findByPk(id, { raw: true });

beforeAll(async () => {
  await getApp();
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  campaign = await createTestCampaign(admin.id, { metaPixelId: 'pix-w' });
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  _resetWorkerCadence();
  // The worker's due-scan and the invariant sweep are GLOBAL — start every
  // test from an empty ledger so rows left by earlier suites in this same
  // jest process can't leak into scans.
  await sequelize.query(`DELETE FROM platform_deliveries`);
});

afterEach(() => {
  delete process.env.PLATFORM_DELIVERY_PLANNING_ENABLED;
  delete process.env.PLATFORM_DELIVERY_PAUSED;
  delete process.env.META_CAPI_ENABLED;
  delete process.env.META_CAPI_ACCESS_TOKEN;
  jest.restoreAllMocks();
});

const metaOn = () => {
  process.env.META_CAPI_ENABLED = 'true';
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
};

describe('runDeliveryWorker — send pass', () => {
  it('attempts due rows in COALESCE(nextAttemptAt, createdAt) order with concurrency ≤5', async () => {
    metaOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const r = await mintRow(p.id, {
        prospectId: (await createTestProspect(campaign.id, { leadSource: 'website' })).id,
        state: 'retry_wait',
        nextAttemptAt: new Date(Date.now() - (7 - i) * 60_000), // row 0 most overdue
      });
      rows.push(r);
    }
    const order = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const metaSend = jest.fn(async (prospect, ctx) => {
      order.push(ctx.eventId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 60));
      inFlight -= 1;
      return { sent: true, status: 200, body: { fbtrace_id: 'fb-w' } };
    });
    const out = await runDeliveryWorker({ deps: { metaSend, canMarketTo: async () => false } });
    expect(out.acquired).toBe(true);
    expect(out.value.attempted).toBe(7);
    expect(out.value.outcomes.sent).toBe(7);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    // Every due row was attempted exactly once; the first five lane fills are
    // drawn from the five most-overdue rows (send-call order within them can
    // race on claim latency, so assert membership, not sequence).
    expect(new Set(order)).toEqual(new Set(rows.map((r) => r.eventId)));
    expect(new Set(order.slice(0, 5))).toEqual(new Set(rows.slice(0, 5).map((r) => r.eventId)));
  });

  it('PAUSED skips send work but the expiry pass still runs', async () => {
    metaOn();
    process.env.PLATFORM_DELIVERY_PAUSED = 'true';
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const due = await mintRow(p.id, { state: 'pending', createdAt: new Date(Date.now() - 10 * 60_000) });
    await forceRow(due.id, { createdAt: new Date(Date.now() - 10 * 60_000) }); // model create ignores createdAt override
    const p2 = await createTestProspect(campaign.id, { leadSource: 'website' });
    const past = await mintRow(p2.id, { eventKey: 'confirmed_resident', eventId: `cr:${p2.id}` });
    await forceRow(past.id, { dedupeAnchorAt: new Date(Date.now() - 200 * 3600_000) });
    const metaSend = jest.fn();
    const out = await runDeliveryWorker({ deps: { metaSend } });
    expect(metaSend).not.toHaveBeenCalled();
    expect(out.value.attempted).toBe(0);
    expect(out.value.expired).toBe(1);
    expect((await rowById(past.id)).state).toBe('expired');
    expect((await rowById(due.id)).state).toBe('pending'); // paused, not expired (inside horizon)
  });

  it('with provider flags OFF the attempts classify config_blocked and expiry still runs in the same tick', async () => {
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const due = await mintRow(p.id, { state: 'retry_wait', nextAttemptAt: new Date(Date.now() - 1000) });
    const p2 = await createTestProspect(campaign.id, { leadSource: 'website' });
    const old = await mintRow(p2.id, {});
    await forceRow(old.id, { dedupeAnchorAt: new Date(Date.now() - 60 * 3600_000) });
    const out = await runDeliveryWorker({ deps: {} });
    expect(out.value.outcomes.config_blocked).toBeGreaterThanOrEqual(1);
    expect((await rowById(due.id)).state).toBe('config_blocked');
    expect((await rowById(old.id)).state).toBe('expired');
  });

  it('accept-then-disconnect provider: the retry resends the SAME event id (at-least-once with provider dedupe)', async () => {
    metaOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const row = await mintRow(p.id, {});
    // Attempt 1: the provider ingested the event but the socket died before the response.
    const disconnecting = jest.fn(async () => ({ sent: false, error: 'socket hang up' }));
    const first = await processDelivery(row.id, { deps: { metaSend: disconnecting, canMarketTo: async () => false, jitterRatio: 0 } });
    expect(first.outcome).toBe('retry_wait');
    let mid = await rowById(row.id);
    expect(mid.state).toBe('retry_wait');
    expect(mid.sendAttempts).toBe(1);
    expect(mid.firstWireAt).not.toBeNull(); // the wire anchor exists even though the result was lost
    // Attempt 2 (due): same eventId goes out again — the provider dedupes.
    await forceRow(row.id, { nextAttemptAt: new Date(Date.now() - 1000) });
    const sends = [];
    const ok = jest.fn(async (prospect, ctx) => { sends.push(ctx.eventId); return { sent: true, status: 200, body: { fbtrace_id: 'fb-2' } }; });
    const second = await processDelivery(row.id, { deps: { metaSend: ok, canMarketTo: async () => false } });
    expect(second.outcome).toBe('sent');
    expect(sends).toEqual([row.eventId]);
    expect((await rowById(row.id)).sendAttempts).toBe(2);
  });
});

describe('runExpiryPass — §3.3.7 rules', () => {
  it('never touches an ACTIVE sending lease, even past deadline; a stale lease expires', async () => {
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const active = await mintRow(p.id, {});
    await forceRow(active.id, {
      state: 'sending', claimedAt: new Date(), claimToken: '00000000-0000-4000-8000-0000000000b1',
      dedupeAnchorAt: new Date(Date.now() - 60 * 3600_000),
    });
    expect(await runExpiryPass()).toBe(0);
    expect((await rowById(active.id)).state).toBe('sending'); // in-flight settle wins

    await forceRow(active.id, { claimedAt: new Date(Date.now() - 11 * 60_000) });
    expect(await runExpiryPass()).toBe(1);
    expect((await rowById(active.id)).state).toBe('expired');
  });

  it('applies the CReg anchor-vs-fallback split off the prospect\'s persisted reveal timestamp', async () => {
    const withAnchor = await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: { registrationEventAt: new Date(Date.now() - 30 * 3600_000).toISOString() },
    });
    const anchored = await mintRow(withAnchor.id, { eventKey: 'complete_registration', eventId: `reg-${withAnchor.id}` });
    await forceRow(anchored.id, { dedupeAnchorAt: new Date(Date.now() - 30 * 3600_000) });

    const withoutAnchor = await createTestProspect(campaign.id, { leadSource: 'website' });
    const fallback = await mintRow(withoutAnchor.id, { eventKey: 'complete_registration', eventId: `reg-${withoutAnchor.id}` });
    await forceRow(fallback.id, { dedupeAnchorAt: new Date(Date.now() - 30 * 3600_000) });

    await runExpiryPass();
    // 30h old: inside the 47h anchored horizon, past the 24h fallback horizon.
    expect((await rowById(anchored.id)).state).toBe('pending');
    expect((await rowById(fallback.id)).state).toBe('expired');
  });
});

describe('runOutcomeInvariantSweep — §3.5', () => {
  it('plans rows for young facts with no row and no marker; skips marked, old, and already-rowed facts', async () => {
    process.env.PLATFORM_DELIVERY_PLANNING_ENABLED = 'true';
    const young = await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: { outcomes: { confirmed_resident: new Date(Date.now() - 3600_000).toISOString() } },
    });
    const marked = await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: {
        outcomes: { confirmed_resident: new Date(Date.now() - 3600_000).toISOString() },
        capi: { confirmedResidentAt: new Date().toISOString() },
      },
    });
    const old = await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: { outcomes: { confirmed_resident: new Date(Date.now() - 200 * 3600_000).toISOString() } },
    });
    const planned = await runOutcomeInvariantSweep();
    // The sweep is global — prospects from earlier suites in this jest
    // process may be healed too, so assert per-prospect, not the total.
    expect(planned).toBeGreaterThanOrEqual(1);
    expect(await PlatformDelivery.count({ where: { prospectId: young.id, eventKey: 'confirmed_resident' } })).toBe(1);
    expect(await PlatformDelivery.count({ where: { prospectId: marked.id } })).toBe(0);
    expect(await PlatformDelivery.count({ where: { prospectId: old.id } })).toBe(0);
    // Idempotent: a second sweep plans nothing new (every plannable fact now has its row).
    expect(await runOutcomeInvariantSweep()).toBe(0);
  });

  it('plans nothing with the planning flag off (sole row-creation control)', async () => {
    await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: { outcomes: { closed_won: new Date().toISOString() } },
    });
    expect(await runOutcomeInvariantSweep()).toBe(0);
  });
});

describe('runRetentionPurge — §3.6', () => {
  it('purges only terminal rows older than the retention window', async () => {
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const oldSent = await mintRow(p.id, {});
    await forceRow(oldSent.id, { state: 'sent' });
    await sequelize.query(
      `UPDATE platform_deliveries SET "updatedAt" = now() - interval '100 days' WHERE id = :id`,
      { replacements: { id: oldSent.id } }
    );
    const p2 = await createTestProspect(campaign.id, { leadSource: 'website' });
    const oldPending = await mintRow(p2.id, {});
    await sequelize.query(
      `UPDATE platform_deliveries SET "updatedAt" = now() - interval '100 days' WHERE id = :id`,
      { replacements: { id: oldPending.id } }
    );
    const p3 = await createTestProspect(campaign.id, { leadSource: 'website' });
    const freshSent = await mintRow(p3.id, {});
    await forceRow(freshSent.id, { state: 'sent' });

    const purged = await runRetentionPurge();
    expect(purged).toBe(1);
    expect(await rowById(oldSent.id)).toBeNull();
    expect(await rowById(oldPending.id)).not.toBeNull(); // non-terminal rows are never purged
    expect(await rowById(freshSent.id)).not.toBeNull();
  });
});
