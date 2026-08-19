/**
 * DB-backed coverage for the platform-delivery outbox core
 * (ads-centralisation §3.7): planning at both entry points (facts+rows
 * atomicity, persisted-fact reads, erased/absent aborts, marker-aware skips,
 * idempotence), the fenced claim/reservation/settle machine (races, ghost
 * settles, the in-CAS reservation cap, config_blocked semantics, destination
 * pinning), row-ownership routing (no dual send; the §3.3.5 outcome mapping
 * incl. paused pending), the capture-path budget (plannedOk=false performs no
 * queries), and the erasure fence.
 */
import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { sequelize, Prospect, PlatformDelivery } from '../src/models/index.js';
import {
  planSubmitDeliveriesTx,
  planOutcomeDeliveriesTx,
  processDelivery,
  dispatchSubmitDeliveries,
  dispatchOutcomeDelivery,
} from '../src/services/platformDeliveryService.js';
import { makeLeadOutcomeService } from '../src/services/leadOutcomeService.js';
import { makeProspectService } from '../src/services/prospectService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let admin;
let campaign;

const PLANNING_FLAG = 'PLATFORM_DELIVERY_PLANNING_ENABLED';

function planningOn() { process.env[PLANNING_FLAG] = 'true'; }

async function planned(prospect, { campaign: c = null, eventId = `ev-${prospect.id}`, registrationEventId, registrationEventAt } = {}) {
  await sequelize.transaction(async (t) => {
    await planSubmitDeliveriesTx(t, {
      prospect, sourceCampaign: c, eventId, registrationEventId, registrationEventAt,
    });
  });
  return PlatformDelivery.findAll({ where: { prospectId: prospect.id }, order: [['platform', 'ASC'], ['eventKey', 'ASC']], raw: true });
}

async function rowById(id) {
  return PlatformDelivery.findByPk(id, { raw: true });
}

/** Force a row into an exact state via raw SQL (bypasses the state machine on purpose). */
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

const metaOn = () => {
  process.env.META_CAPI_ENABLED = 'true';
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
};
const tiktokOn = () => {
  process.env.TIKTOK_EVENTS_API_ENABLED = 'true';
  process.env.TIKTOK_ACCESS_TOKEN = 'test-token';
};

beforeAll(async () => {
  await getApp();
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  campaign = await createTestCampaign(admin.id, { metaPixelId: 'pix-meta-camp', tiktokPixelId: 'pix-tt-camp' });
});

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  delete process.env[PLANNING_FLAG];
  delete process.env.PLATFORM_DELIVERY_PAUSED;
  delete process.env.META_CAPI_ENABLED;
  delete process.env.META_CAPI_ACCESS_TOKEN;
  delete process.env.TIKTOK_EVENTS_API_ENABLED;
  delete process.env.TIKTOK_ACCESS_TOKEN;
  delete process.env.META_PIXEL_ID;
  delete process.env.TIKTOK_PIXEL_ID;
  delete process.env.PLATFORM_DELIVERY_MAX_ATTEMPTS;
  jest.restoreAllMocks();
});

describe('submit-time planning (§3.3.1)', () => {
  it('plans nothing with the flag off — the SOLE row-creation control', async () => {
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign });
    expect(rows).toHaveLength(0);
  });

  it('plans meta+tiktok lead rows (and CReg pairs only with a registrationEventId), pinning the campaign pixel', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign, registrationEventId: 'reg-1', registrationEventAt: new Date(Date.now() - 60_000).toISOString() });
    expect(rows.map((r) => `${r.platform}:${r.eventKey}`).sort()).toEqual([
      'meta:complete_registration', 'meta:lead', 'tiktok:complete_registration', 'tiktok:lead',
    ]);
    for (const r of rows) {
      expect(r.state).toBe('pending');
      expect(r.pixelId).toBe(r.platform === 'meta' ? 'pix-meta-camp' : 'pix-tt-camp');
      expect(r.sendAttempts).toBe(0);
    }
    const creg = rows.find((r) => r.platform === 'meta' && r.eventKey === 'complete_registration');
    const lead = rows.find((r) => r.platform === 'meta' && r.eventKey === 'lead');
    // CReg anchors on the browser reveal timestamp — strictly before the lead's capture anchor.
    expect(new Date(creg.dedupeAnchorAt).getTime()).toBeLessThan(new Date(lead.dedupeAnchorAt).getTime());
    expect(creg.eventId).toBe('reg-1');
  });

  it('origin-excludes Retell / Meta-Lead-Ads prospects even with the flag on', async () => {
    planningOn();
    const retell = await createTestProspect(campaign.id, { leadSource: 'call_bot', retellCallId: `call-${Date.now()}` });
    expect(await planned(retell, { campaign })).toHaveLength(0);
    const mla = await createTestProspect(campaign.id, { leadSource: 'website', sourceMetadata: { metaLeadgenId: 'lg-1' } });
    expect(await planned(mla, { campaign })).toHaveLength(0);
  });

  it('falls back to the env pixel, then NULL, at planning time', async () => {
    planningOn();
    process.env.META_PIXEL_ID = 'pix-meta-env';
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign: null });
    const meta = rows.find((r) => r.platform === 'meta');
    const tiktok = rows.find((r) => r.platform === 'tiktok');
    expect(meta.pixelId).toBe('pix-meta-env');
    expect(tiktok.pixelId).toBeNull(); // no campaign, no env id — resolvable later or config_blocked
  });
});

describe('outcome planning — the shared in-txn helper (§3.3.2)', () => {
  it('reads each key\'s PERSISTED fact as eventTime (an admin replay cannot retime CR)', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const t1 = '2026-08-10T00:00:00.000Z';
    const t2 = '2026-08-15T00:00:00.000Z';
    await p.update({ sourceMetadata: { outcomes: { confirmed_resident: t1, closed_won: t2 } } });
    await sequelize.transaction(async (t) => {
      // Caller passes NO timestamps — a later `won` replay carries none either.
      const res = await planOutcomeDeliveriesTx(t, { prospectId: p.id, keys: ['confirmed_resident', 'closed_won'] });
      expect(res.inserted).toBe(2);
    });
    const rows = await PlatformDelivery.findAll({ where: { prospectId: p.id }, raw: true });
    const cr = rows.find((r) => r.eventKey === 'confirmed_resident');
    const cw = rows.find((r) => r.eventKey === 'closed_won');
    expect(cr.platform).toBe('meta');
    expect(new Date(cr.eventTime).toISOString()).toBe(t1);
    expect(new Date(cr.dedupeAnchorAt).toISOString()).toBe(t1);
    expect(new Date(cw.eventTime).toISOString()).toBe(t2);
    expect(cr.eventId).toBe(`confirmed_resident:${p.id}`);
    // Idempotent: replay inserts nothing and retimes nothing.
    await p.update({ sourceMetadata: { outcomes: { confirmed_resident: '2026-08-16T00:00:00.000Z', closed_won: t2 } } });
    await sequelize.transaction(async (t) => {
      const res = await planOutcomeDeliveriesTx(t, { prospectId: p.id, keys: ['confirmed_resident'] });
      expect(res.inserted).toBe(0);
    });
    expect(new Date((await rowById(cr.id)).eventTime).toISOString()).toBe(t1);
  });

  it('aborts on erased and on an absent fact; skips keys with the exact legacy marker', async () => {
    planningOn();
    const erased = await createTestProspect(campaign.id, { leadSource: 'website', sourceMetadata: { erased: true, outcomes: { confirmed_resident: '2026-08-10T00:00:00Z' } } });
    await sequelize.transaction(async (t) => {
      const res = await planOutcomeDeliveriesTx(t, { prospectId: erased.id, keys: ['confirmed_resident'] });
      expect(res).toMatchObject({ planned: false, reason: 'erased' });
    });
    expect(await PlatformDelivery.count({ where: { prospectId: erased.id } })).toBe(0);

    const noFact = await createTestProspect(campaign.id, { leadSource: 'website' });
    await sequelize.transaction(async (t) => {
      const res = await planOutcomeDeliveriesTx(t, { prospectId: noFact.id, keys: ['confirmed_resident'] });
      expect(res.inserted).toBe(0);
    });

    const marked = await createTestProspect(campaign.id, {
      leadSource: 'website',
      sourceMetadata: { outcomes: { confirmed_resident: '2026-08-10T00:00:00Z' }, capi: { confirmedResidentAt: '2026-08-10T00:01:00Z' } },
    });
    await sequelize.transaction(async (t) => {
      const res = await planOutcomeDeliveriesTx(t, { prospectId: marked.id, keys: ['confirmed_resident'] });
      expect(res.inserted).toBe(0); // old-binary outcome send is never re-planned
    });
  });

  it('origin-excludes Retell prospects (outcome events stay legacy-guarded for them)', async () => {
    planningOn();
    const retell = await createTestProspect(campaign.id, {
      leadSource: 'call_bot', retellCallId: `call-o-${Date.now()}`,
      sourceMetadata: { outcomes: { confirmed_resident: '2026-08-10T00:00:00Z' } },
    });
    await sequelize.transaction(async (t) => {
      const res = await planOutcomeDeliveriesTx(t, { prospectId: retell.id, keys: ['confirmed_resident'] });
      expect(res).toMatchObject({ planned: false, reason: 'origin_excluded' });
    });
  });
});

describe('claim / reservation / settle machine (§3.3.3–.4)', () => {
  async function onePendingRow(overrides = {}) {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign });
    const row = rows.find((r) => r.platform === 'meta' && r.eventKey === 'lead');
    if (Object.keys(overrides).length) await forceRow(row.id, overrides);
    return { p, row: await rowById(row.id) };
  }

  it('claim race: exactly one of two concurrent attempts wins; the loser reports claim_miss', async () => {
    metaOn();
    const { row } = await onePendingRow();
    let inFlight = 0;
    let maxInFlight = 0;
    const metaSend = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 150));
      inFlight -= 1;
      return { sent: true, status: 200, body: { fbtrace_id: 'fb-race' } };
    });
    const deps = { metaSend, canMarketTo: async () => false };
    const [a, b] = await Promise.all([
      processDelivery(row.id, { deps }),
      processDelivery(row.id, { deps }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['claim_miss', 'sent']);
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);
    const settled = await rowById(row.id);
    expect(settled.state).toBe('sent');
    expect(settled.sendAttempts).toBe(1);
    expect(settled.providerRequestId).toBe('fb-race');
  });

  it('stale-lease reclaim resends; a ghost settle with the old token loses the CAS', async () => {
    metaOn();
    const ghostToken = '00000000-0000-4000-8000-000000000001';
    const { row } = await onePendingRow({
      state: 'sending', claimToken: ghostToken,
      claimedAt: new Date(Date.now() - 11 * 60_000),
      firstWireAt: new Date(Date.now() - 20 * 60_000), // a wire happened; settle was lost (accept-then-crash)
      sendAttempts: 1,
      lastAttemptAt: new Date(Date.now() - 20 * 60_000),
    });
    const metaSend = jest.fn(async () => ({ sent: true, status: 200, body: { fbtrace_id: 'fb-2' } }));
    const res = await processDelivery(row.id, { deps: { metaSend, canMarketTo: async () => false } });
    expect(res.outcome).toBe('sent'); // resend INSIDE the wire deadline — at-least-once
    expect(metaSend).toHaveBeenCalledTimes(1);
    // The ghost's settle (old token) must now hit nothing.
    const [, meta] = await sequelize.query(
      `UPDATE platform_deliveries SET state = 'retry_wait', "updatedAt" = now()
        WHERE id = :id AND state = 'sending' AND "claimToken" = :token`,
      { replacements: { id: row.id, token: ghostToken } }
    );
    expect(meta.rowCount).toBe(0);
    expect((await rowById(row.id)).state).toBe('sent');
  });

  it('expires (never resends) a reclaimed row whose first wire was beyond the dedupe window', async () => {
    metaOn();
    const { row } = await onePendingRow({
      state: 'sending', claimToken: '00000000-0000-4000-8000-000000000002',
      claimedAt: new Date(Date.now() - 11 * 60_000),
      firstWireAt: new Date(Date.now() - 48 * 3600_000),
      sendAttempts: 1,
    });
    const metaSend = jest.fn();
    const res = await processDelivery(row.id, { deps: { metaSend } });
    expect(res.outcome).toBe('expired');
    expect(metaSend).not.toHaveBeenCalled();
    expect((await rowById(row.id)).state).toBe('expired');
    expect((await rowById(row.id)).errorCode).toBe('deadline');
  });

  it('enforces the reservation cap IN the CAS — a capped row settles failed_permanent/retry_cap without a wire', async () => {
    metaOn();
    process.env.PLATFORM_DELIVERY_MAX_ATTEMPTS = '3';
    const { row } = await onePendingRow({ sendAttempts: 3 });
    const metaSend = jest.fn();
    const res = await processDelivery(row.id, { deps: { metaSend } });
    expect(res).toMatchObject({ outcome: 'failed_permanent', errorCode: 'retry_cap' });
    expect(metaSend).not.toHaveBeenCalled();
    const after = await rowById(row.id);
    expect(after.state).toBe('failed_permanent');
    expect(after.errorCode).toBe('retry_cap');
    expect(after.sendAttempts).toBe(3); // the reservation never went through
  });

  it('config_blocked is non-terminal and burns NO attempt fields; it sends once config resolves', async () => {
    const { row } = await onePendingRow(); // provider flags OFF
    const res = await processDelivery(row.id, { deps: { metaSend: jest.fn() } });
    expect(res.outcome).toBe('config_blocked');
    let after = await rowById(row.id);
    expect(after.state).toBe('config_blocked');
    expect(after.sendAttempts).toBe(0);
    expect(after.firstWireAt).toBeNull();
    expect(after.lastAttemptAt).toBeNull();
    expect(after.nextAttemptAt).not.toBeNull();

    metaOn();
    await forceRow(row.id, { nextAttemptAt: new Date(Date.now() - 1000) });
    const metaSend = jest.fn(async () => ({ sent: true, status: 200, body: { fbtrace_id: 'fb-3' } }));
    const res2 = await processDelivery(row.id, { deps: { metaSend, canMarketTo: async () => false } });
    expect(res2.outcome).toBe('sent');
    after = await rowById(row.id);
    expect(after.sendAttempts).toBe(1);
  });

  it('destination pinned at planning survives campaign edit + env change; NULL destination blocks then pins on resolve', async () => {
    planningOn();
    metaOn();
    const owner = await createTestUser({ role: 'admin' });
    const editable = await createTestCampaign(owner.user.id, { metaPixelId: 'pix-original' });
    const p = await createTestProspect(editable.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign: editable });
    const metaRow = rows.find((r) => r.platform === 'meta' && r.eventKey === 'lead');
    expect(metaRow.pixelId).toBe('pix-original');

    await editable.update({ metaPixelId: 'pix-edited' });
    process.env.META_PIXEL_ID = 'pix-env-late';
    const metaSend = jest.fn(async (prospect, ctx) => ({ sent: true, status: 200, body: { fbtrace_id: `fb-${ctx.pixelIdOverride}` } }));
    const res = await processDelivery(metaRow.id, { deps: { metaSend, canMarketTo: async () => false } });
    expect(res.outcome).toBe('sent');
    expect(metaSend.mock.calls[0][1].pixelIdOverride).toBe('pix-original'); // pinned, immutable once non-null

    // NULL-destination row: blocks with zero attempt-field writes, then pins
    // the late-resolved id. The prospect must be CAMPAIGN-LESS — a campaign
    // pixel would resolve the destination at attempt time.
    delete process.env.META_PIXEL_ID;
    const p2 = await createTestProspect(null, { leadSource: 'website' });
    const rows2 = await planned(p2, { campaign: null });
    const nullRow = rows2.find((r) => r.platform === 'meta' && r.eventKey === 'lead');
    expect(nullRow.pixelId).toBeNull();
    const blocked = await processDelivery(nullRow.id, { deps: { metaSend: jest.fn() } });
    expect(blocked.outcome).toBe('config_blocked');
    expect((await rowById(nullRow.id)).sendAttempts).toBe(0);

    process.env.META_PIXEL_ID = 'pix-env-resolved';
    await forceRow(nullRow.id, { nextAttemptAt: new Date(Date.now() - 1000) });
    const res2 = await processDelivery(nullRow.id, { deps: { metaSend, canMarketTo: async () => false } });
    expect(res2.outcome).toBe('sent');
    expect(metaSend.mock.calls[1][1].pixelIdOverride).toBe('pix-env-resolved');
    expect((await rowById(nullRow.id)).pixelId).toBe('pix-env-resolved'); // pinned by the reservation CAS
  });

  it('writes the legacy capi marker in the settle transaction for outcome keys', async () => {
    planningOn();
    metaOn();
    const factAt = new Date(Date.now() - 3600_000).toISOString(); // inside the 156h outcome horizon
    const p = await createTestProspect(campaign.id, { leadSource: 'website', sourceMetadata: { outcomes: { confirmed_resident: factAt } } });
    await sequelize.transaction(async (t) => {
      await planOutcomeDeliveriesTx(t, { prospectId: p.id, keys: ['confirmed_resident'], campaign: null });
    });
    const row = await PlatformDelivery.findOne({ where: { prospectId: p.id, eventKey: 'confirmed_resident' }, raw: true });
    process.env.META_PIXEL_ID = 'pix-any';
    const before = Date.now();
    const res = await processDelivery(row.id, { deps: { metaSend: async () => ({ sent: true, status: 200, body: { fbtrace_id: 'fb-o' } }), canMarketTo: async () => false } });
    expect(res.outcome).toBe('sent');
    const fresh = await Prospect.findByPk(p.id, { raw: true });
    const marker = fresh.sourceMetadata?.capi?.confirmedResidentAt;
    expect(marker).toBeTruthy();
    expect(Date.parse(marker)).toBeGreaterThanOrEqual(before - 1000); // marker records DELIVERY time
  });

  it('skips (erased) between claim and wire — the pre-wire fresh check fences the send', async () => {
    planningOn();
    metaOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const rows = await planned(p, { campaign });
    const row = rows.find((r) => r.platform === 'meta' && r.eventKey === 'lead');
    await p.update({ sourceMetadata: { erased: true } });
    const metaSend = jest.fn();
    const res = await processDelivery(row.id, { deps: { metaSend } });
    expect(res).toMatchObject({ outcome: 'skipped', errorCode: 'erased' });
    expect(metaSend).not.toHaveBeenCalled();
  });
});

describe('row-ownership routing (§3.2/§3.3.5)', () => {
  it('plannedOk=false performs NO ownership query and fires every legacy closure synchronously (§3.4 budget)', async () => {
    const findAllSpy = jest.spyOn(PlatformDelivery, 'findAll');
    const fired = [];
    const legacy = {
      metaLead: () => fired.push('metaLead'),
      metaCompleteRegistration: () => fired.push('metaCReg'),
      tiktokLead: () => fired.push('tiktokLead'),
      tiktokCompleteRegistration: null, // no reveal happened
    };
    const promise = dispatchSubmitDeliveries({ prospect: { id: 'no-such' }, plannedOk: false, marketingConsent: false, legacy });
    // The legacy closures fire synchronously — before the promise resolves.
    expect(fired).toEqual(['metaLead', 'metaCReg', 'tiktokLead']);
    await promise;
    expect(findAllSpy).not.toHaveBeenCalled();
  });

  it('pairs WITH rows never fire legacy senders (no dual send), even when the ledger attempt is blocked', async () => {
    planningOn(); // provider flags OFF ⇒ the ledger attempt config_blocks; legacy must STILL not fire
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    await planned(p, { campaign, registrationEventId: 'reg-dual' });
    const fired = [];
    const legacy = {
      metaLead: () => fired.push('metaLead'),
      metaCompleteRegistration: () => fired.push('metaCReg'),
      tiktokLead: () => fired.push('tiktokLead'),
      tiktokCompleteRegistration: () => fired.push('tiktokCReg'),
    };
    const { owned } = await dispatchSubmitDeliveries({ prospect: p, plannedOk: true, marketingConsent: false, legacy });
    expect(owned).toHaveLength(4);
    expect(fired).toEqual([]);
    // Give the floating inline attempts a beat, then confirm they classified config_blocked.
    await new Promise((r) => setTimeout(r, 300));
    const states = (await PlatformDelivery.findAll({ where: { prospectId: p.id }, raw: true })).map((r) => r.state);
    expect(new Set(states)).toEqual(new Set(['config_blocked']));
  });

  it('mixed states: only the pair WITHOUT a row falls back to legacy', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    await planned(p, { campaign }); // lead rows only — no CReg rows
    const fired = [];
    const legacy = {
      metaLead: () => fired.push('metaLead'),
      metaCompleteRegistration: () => fired.push('metaCReg'),
      tiktokLead: () => fired.push('tiktokLead'),
      tiktokCompleteRegistration: () => fired.push('tiktokCReg'),
    };
    await dispatchSubmitDeliveries({ prospect: p, plannedOk: true, marketingConsent: false, legacy });
    expect(fired.sort()).toEqual(['metaCReg', 'tiktokCReg']);
  });

  it('dispatchOutcomeDelivery maps every row state onto the legacy contract (§3.3.5, incl. paused pending)', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website', sourceMetadata: { outcomes: { confirmed_resident: new Date().toISOString() } } });
    expect(await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).toEqual({ owned: false });

    await sequelize.transaction(async (t) => {
      await planOutcomeDeliveriesTx(t, { prospectId: p.id, keys: ['confirmed_resident'] });
    });
    const row = await PlatformDelivery.findOne({ where: { prospectId: p.id, eventKey: 'confirmed_resident' }, raw: true });

    // pending + PAUSED ⇒ transientFailed (send work paused, row stays owned)
    process.env.PLATFORM_DELIVERY_PAUSED = 'true';
    expect(await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' }))
      .toEqual({ owned: true, legacyOutcome: 'transientFailed' });
    expect((await rowById(row.id)).state).toBe('pending');
    delete process.env.PLATFORM_DELIVERY_PAUSED;

    // held by an ACTIVE lease ⇒ transientFailed
    await forceRow(row.id, { state: 'sending', claimedAt: new Date(), claimToken: '00000000-0000-4000-8000-00000000000a' });
    expect((await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).legacyOutcome).toBe('transientFailed');

    // config_blocked, not due ⇒ guarded
    await forceRow(row.id, { state: 'config_blocked', claimToken: null, claimedAt: null, nextAttemptAt: new Date(Date.now() + 3600_000) });
    expect((await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).legacyOutcome).toBe('guarded');

    // retry_wait, not due ⇒ transientFailed
    await forceRow(row.id, { state: 'retry_wait', nextAttemptAt: new Date(Date.now() + 3600_000) });
    expect((await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).legacyOutcome).toBe('transientFailed');

    // terminal failure ⇒ permanentFailed
    await forceRow(row.id, { state: 'expired', nextAttemptAt: null });
    expect((await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).legacyOutcome).toBe('permanentFailed');

    // pre-existing sent ⇒ duplicate
    await forceRow(row.id, { state: 'sent' });
    expect((await dispatchOutcomeDelivery({ prospectId: p.id, key: 'confirmed_resident' })).legacyOutcome).toBe('duplicate');
  });
});

describe('outcome entry points — facts+rows atomicity (§3.3.2)', () => {
  function outcomeService(overrides = {}) {
    return makeLeadOutcomeService({
      googleUploadsEnabled: () => false,
      canMarketTo: async () => false,
      sendConversionEvent: jest.fn(async () => ({ sent: true, status: 200, body: {} })),
      logger: silentLogger,
      ...overrides,
    });
  }

  it('processLeadOutcome commits fact + row together; the row carries the persisted fact time', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const occurredAt = new Date(Date.now() - 3600_000).toISOString(); // inside the outcome horizon
    const svc = outcomeService();
    const result = await svc.processLeadOutcome({ external_id: p.id, new_status: 'qualified', occurred_at: occurredAt });
    expect(result.skipped).toBeUndefined();
    const fresh = await Prospect.findByPk(p.id, { raw: true });
    expect(fresh.sourceMetadata.outcomes.confirmed_resident).toBe(occurredAt);
    const row = await PlatformDelivery.findOne({ where: { prospectId: p.id, eventKey: 'confirmed_resident' }, raw: true });
    expect(row).not.toBeNull();
    expect(new Date(row.eventTime).toISOString()).toBe(occurredAt);
  });

  it('a failed planning step rolls the WHOLE facts+planning txn back — no fact, no row (reconciler heals)', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const svc = outcomeService({
      planOutcomeDeliveriesTx: jest.fn(async () => { throw new Error('boom'); }),
    });
    await svc.processLeadOutcome({ external_id: p.id, new_status: 'qualified', occurred_at: '2026-08-14T03:00:00.000Z' });
    const fresh = await Prospect.findByPk(p.id, { raw: true });
    expect(fresh.sourceMetadata?.outcomes?.confirmed_resident).toBeUndefined();
    expect(await PlatformDelivery.count({ where: { prospectId: p.id } })).toBe(0);
  });

  it('routes ledger-owned keys through the row and maps a not-due row to transientFailed (external 503 contract feed)', async () => {
    planningOn();
    const p = await createTestProspect(campaign.id, { leadSource: 'website' });
    const svc = outcomeService();
    // First pass plans the row; provider flags are OFF so the inline attempt config_blocks ⇒ guarded.
    const first = await svc.processLeadOutcome({
      external_id: p.id, new_status: 'qualified', occurred_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(first.guarded).toContain('ConfirmedResident');
    // Force the row into a future retry_wait: the replay must classify transientFailed off the ROW,
    // and the legacy sender must never fire (ownership).
    const row = await PlatformDelivery.findOne({ where: { prospectId: p.id, eventKey: 'confirmed_resident' }, raw: true });
    await forceRow(row.id, { state: 'retry_wait', nextAttemptAt: new Date(Date.now() + 3600_000), errorCode: 'http_5xx' });
    const sendConversionEvent = jest.fn();
    const svc2 = outcomeService({ sendConversionEvent });
    const replay = await svc2.processLeadOutcome({ external_id: p.id, new_status: 'qualified', occurred_at: '2026-08-14T04:00:00.000Z' });
    expect(replay.transientFailed).toContain('ConfirmedResident');
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  it('admin edit plans rows inside the status transaction (savepoint-isolated: a planner failure never fails the edit)', async () => {
    planningOn();
    const svc = makeProspectService({
      buildProspectWhere: async () => ({}),
      processLeadOutcome: jest.fn(async () => ({ dispatched: [], duplicate: [], failed: [] })),
      logger: silentLogger,
    });
    const p1 = await createTestProspect(campaign.id, { leadSource: 'website' });
    await svc.updateProspect(p1.id, { leadStatus: 'qualified' }, { id: admin.id, role: 'admin' });
    const fresh1 = await Prospect.findByPk(p1.id, { raw: true });
    expect(fresh1.sourceMetadata.outcomes.confirmed_resident).toBeTruthy();
    const row = await PlatformDelivery.findOne({ where: { prospectId: p1.id, eventKey: 'confirmed_resident' }, raw: true });
    expect(row).not.toBeNull();
    expect(new Date(row.eventTime).toISOString()).toBe(fresh1.sourceMetadata.outcomes.confirmed_resident);

    // Savepoint isolation: a throwing planner loses the rows but keeps the edit + the fact.
    const svcBroken = makeProspectService({
      buildProspectWhere: async () => ({}),
      processLeadOutcome: jest.fn(async () => ({ dispatched: [], duplicate: [], failed: [] })),
      planOutcomeDeliveriesTx: jest.fn(async () => { throw new Error('planner down'); }),
      logger: silentLogger,
    });
    const p2 = await createTestProspect(campaign.id, { leadSource: 'website' });
    const updated = await svcBroken.updateProspect(p2.id, { leadStatus: 'qualified' }, { id: admin.id, role: 'admin' });
    expect(updated.leadStatus).toBe('qualified');
    const fresh2 = await Prospect.findByPk(p2.id, { raw: true });
    expect(fresh2.sourceMetadata.outcomes.confirmed_resident).toBeTruthy();
    expect(await PlatformDelivery.count({ where: { prospectId: p2.id } })).toBe(0); // sweep heals
  });
});

describe('capture path (§3.3.1/§3.4/§3.8)', () => {
  function captureService(overrides = {}) {
    return makeProspectService({
      dispatchEvent: jest.fn(async () => {}),
      canMarketTo: async () => false,
      sendLeadEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendCompleteRegistrationEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendTikTokLeadEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendTikTokCompleteRegistrationEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      logger: silentLogger,
      ...overrides,
    });
  }

  const submitBody = (extra = {}) => ({
    firstName: 'Cap',
    lastName: 'Ture',
    // Random 8-digit number — the helpers factory mints Date.now()+n phones in
    // THIS SAME campaign, so a clock-derived suffix here can collide with it
    // under the per-campaign (campaignId, phone) unique index.
    phone: `+65${String(10000000 + Math.floor(Math.random() * 89999999))}`,
    leadSource: 'website',
    campaignId: campaign.id,
    ...extra,
  });

  it('plans the four rows in the capture transaction and persists the clamped reveal timestamp', async () => {
    planningOn();
    const svc = captureService();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { prospect } = await svc.createProspect(submitBody(), null, {
      meta: { eventId: 'cap-ev-1', registrationEventId: 'cap-reg-1', registrationEventAt: future },
    });
    const rows = await PlatformDelivery.findAll({ where: { prospectId: prospect.id }, raw: true });
    expect(rows).toHaveLength(4);
    const fresh = await Prospect.findByPk(prospect.id, { raw: true });
    // Forged future reveal is clamped to ≤ now.
    expect(Date.parse(fresh.sourceMetadata.registrationEventAt)).toBeLessThanOrEqual(Date.now());
    const creg = rows.find((r) => r.platform === 'meta' && r.eventKey === 'complete_registration');
    expect(Date.parse(new Date(creg.dedupeAnchorAt).toISOString())).toBeLessThanOrEqual(Date.now());
  });

  it('server-generates a persisted eventId when the client omits one, and the lead rows use it', async () => {
    planningOn();
    const svc = captureService();
    const { prospect } = await svc.createProspect(submitBody(), null, {});
    const fresh = await Prospect.findByPk(prospect.id, { raw: true });
    expect(fresh.sourceMetadata.eventId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await PlatformDelivery.findAll({ where: { prospectId: prospect.id, eventKey: 'lead' }, raw: true });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.eventId).toBe(fresh.sourceMetadata.eventId);
  });

  it('savepoint failure ⇒ capture succeeds, no rows, and the legacy senders fire (§3.3.1)', async () => {
    planningOn();
    const sendLeadEvent = jest.fn(async () => ({ sent: false, reason: 'guarded' }));
    const sendTikTokLeadEvent = jest.fn(async () => ({ sent: false, reason: 'guarded' }));
    const svc = captureService({
      sendLeadEvent,
      sendTikTokLeadEvent,
      planSubmitDeliveriesTx: jest.fn(async () => { throw new Error('outbox down'); }),
    });
    const { prospect } = await svc.createProspect(submitBody(), null, { meta: { eventId: 'cap-ev-sp' } });
    expect(prospect.id).toBeTruthy();
    expect(await PlatformDelivery.count({ where: { prospectId: prospect.id } })).toBe(0);
    await new Promise((r) => setTimeout(r, 100)); // dispatch is fire-and-forget
    expect(sendLeadEvent).toHaveBeenCalledTimes(1);
    expect(sendTikTokLeadEvent).toHaveBeenCalledTimes(1);
  });

  it('planning OFF is byte-equivalent legacy: no rows, legacy senders fire (§3.8 rollback shape)', async () => {
    const sendLeadEvent = jest.fn(async () => ({ sent: false, reason: 'guarded' }));
    const svc = captureService({ sendLeadEvent });
    const { prospect } = await svc.createProspect(submitBody(), null, { meta: { eventId: 'cap-ev-off' } });
    expect(await PlatformDelivery.count({ where: { prospectId: prospect.id } })).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(sendLeadEvent).toHaveBeenCalledTimes(1);
  });

  it('planning ON: ledger owns the pairs — legacy senders never fire (no dual send)', async () => {
    planningOn();
    const sendLeadEvent = jest.fn();
    const sendTikTokLeadEvent = jest.fn();
    const svc = captureService({ sendLeadEvent, sendTikTokLeadEvent });
    const { prospect } = await svc.createProspect(submitBody(), null, { meta: { eventId: 'cap-ev-own' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(sendLeadEvent).not.toHaveBeenCalled();
    expect(sendTikTokLeadEvent).not.toHaveBeenCalled();
    const rows = await PlatformDelivery.findAll({ where: { prospectId: prospect.id }, raw: true });
    expect(rows).toHaveLength(2);
    // Provider flags are off ⇒ the inline attempts classified config_blocked (no wire, no legacy).
    for (const r of rows) expect(['pending', 'config_blocked']).toContain(r.state);
  });
});
