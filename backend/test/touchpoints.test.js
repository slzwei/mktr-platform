/**
 * DB-backed coverage for the touchpoint arc (ads-centralisation §4.8):
 * the /touch beacon (flag gate, dual-source sid validation, adoption +
 * rolling 90d cookie, server-stamped occurredAt, referrer-origin stripping,
 * bogus-campaign tolerance), the per-sid locked cap under concurrency, the
 * erased-session sweep upsert/consumption (shared-session guard, bounded,
 * window-dropped), retention purging, and the §4.5 binding (every submit
 * binds a session; the explicit-campaign guard drops qr/attribution but
 * KEEPS the session).
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { sequelize, Touchpoint, ErasedSessionSweep, Prospect } from '../src/models/index.js';
import { recordTouch, consumeErasedSessionSweeps, purgeOldTouchpoints } from '../src/services/touchpointService.js';
import { makeProspectService } from '../src/services/prospectService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const ORIGIN = 'http://localhost:5173';
const sidOf = (n) => n.toString(16).padStart(32, '0');

let app;
let admin;
let campaign;

beforeAll(async () => {
  app = await getApp();
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  campaign = await createTestCampaign(admin.id);
});

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  delete process.env.TOUCHPOINTS_ENABLED;
  delete process.env.TOUCHPOINTS_MAX_PER_SESSION_DAY;
  delete process.env.TOUCHPOINT_RETENTION_DAYS;
  jest.restoreAllMocks();
});

const touchOn = () => { process.env.TOUCHPOINTS_ENABLED = 'true'; };

const postTouch = (body = {}, set = {}) => {
  let req = request(app).post('/api/analytics/touch').set('Origin', ORIGIN);
  for (const [k, v] of Object.entries(set)) req = req.set(k, v);
  return req.send({ surface: 'browse', ...body });
};

describe('POST /api/analytics/touch', () => {
  it('skips (200) with the flag off — no row, no cookie', async () => {
    const res = await postTouch({}, { 'X-Session-Id': sidOf(0xa1) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, skipped: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await Touchpoint.count({ where: { sessionId: sidOf(0xa1) } })).toBe(0);
  });

  it('adopts a valid header sid: records the row and sets the 90d httpOnly cookie', async () => {
    touchOn();
    const sid = sidOf(0xa2);
    const res = await postTouch(
      {
        path: '/explore?utm_source=fb',
        referrer: 'https://www.facebook.com/some/long/path?with=query',
        utm_source: 'fb',
        fbclid: 'click-123',
      },
      { 'X-Session-Id': sid }
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('sid='));
    expect(cookie).toContain(`sid=${sid}`);
    expect(cookie).toContain('Max-Age=7776000'); // 90 days
    expect(cookie).toContain('HttpOnly');
    const row = await Touchpoint.findOne({ where: { sessionId: sid }, raw: true });
    expect(row.surface).toBe('browse');
    expect(row.landingPath).toBe('/explore?utm_source=fb');
    // Full referrer in, ORIGIN only stored.
    expect(row.referrerOrigin).toBe('https://www.facebook.com');
    expect(row.utmSource).toBe('fb');
    expect(row.fbclid).toBe('click-123');
    // occurredAt is the SERVER clock (client timestamps are unrepresentable —
    // stripUnknown drops any body time field before the controller sees it).
    expect(Math.abs(Date.now() - new Date(row.occurredAt).getTime())).toBeLessThan(10_000);
  });

  it('validated cookie WINS over a different header sid, and the cookie re-issues (rolling)', async () => {
    touchOn();
    const cookieSid = sidOf(0xa3);
    const headerSid = sidOf(0xa4);
    const res = await postTouch({}, { Cookie: `sid=${cookieSid}`, 'X-Session-Id': headerSid });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('sid='));
    expect(cookie).toContain(`sid=${cookieSid}`);
    expect(await Touchpoint.count({ where: { sessionId: cookieSid } })).toBe(1);
    expect(await Touchpoint.count({ where: { sessionId: headerSid } })).toBe(0);
  });

  it('ignores INVALID sids from both sources (skip, never 400) and falls back cookie→header', async () => {
    touchOn();
    const bad = await postTouch({}, { Cookie: 'sid=not-a-sid', 'X-Session-Id': 'ALSO-BAD' });
    expect(bad.status).toBe(200);
    expect(bad.body.skipped).toBe('no_session');

    const headerSid = sidOf(0xa5);
    const mixed = await postTouch({}, { Cookie: 'sid=not-a-sid', 'X-Session-Id': headerSid });
    expect(mixed.status).toBe(200);
    expect(await Touchpoint.count({ where: { sessionId: headerSid } })).toBe(1);
  });

  it('nulls a well-formed but NONEXISTENT campaignId instead of failing the insert', async () => {
    touchOn();
    const sid = sidOf(0xa6);
    const res = await postTouch(
      { surface: 'leadcapture', campaignId: '00000000-0000-4000-8000-00000000dead' },
      { 'X-Session-Id': sid }
    );
    expect(res.status).toBe(200);
    const row = await Touchpoint.findOne({ where: { sessionId: sid }, raw: true });
    expect(row.campaignId).toBeNull();

    const real = await postTouch({ surface: 'offer', campaignId: campaign.id }, { 'X-Session-Id': sid });
    expect(real.status).toBe(200);
    const rows = await Touchpoint.findAll({ where: { sessionId: sid }, raw: true });
    expect(rows.find((r) => r.surface === 'offer').campaignId).toBe(campaign.id);
  });

  it('rejects an unknown surface (Joi enum) — the one hard 400', async () => {
    touchOn();
    const res = await postTouch({ surface: 'admin' }, { 'X-Session-Id': sidOf(0xa7) });
    expect(res.status).toBe(400);
  });
});

describe('the per-sid locked cap (§4.3)', () => {
  it('holds the 24h cap exactly under concurrency', async () => {
    process.env.TOUCHPOINTS_MAX_PER_SESSION_DAY = '5';
    const sid = sidOf(0xb1);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => recordTouch({ sid, surface: 'browse', landingPath: '/x' }))
    );
    expect(results.filter((r) => r.recorded)).toHaveLength(5);
    expect(results.filter((r) => r.skipped === 'capped')).toHaveLength(7);
    expect(await Touchpoint.count({ where: { sessionId: sid } })).toBe(5);
  });
});

describe('erased-session sweeps (§4.6)', () => {
  it('deletes only in-window rows for swept sids, honours the shared-session guard, and drops rows past the window', async () => {
    const sweptSid = sidOf(0xc1);
    const sharedSid = sidOf(0xc2);
    // Swept sid: one row inside the window, one stamped after sweepUntil.
    await recordTouch({ sid: sweptSid, surface: 'browse', landingPath: '/in-window' });
    await ErasedSessionSweep.create({ sessionId: sweptSid, sweepUntil: new Date(Date.now() + 3600_000) });
    const late = await Touchpoint.create({
      sessionId: sweptSid, occurredAt: new Date(Date.now() + 7200_000), surface: 'browse',
    });
    // Shared sid: a SURVIVING prospect still references it — never swept.
    await createTestProspect(campaign.id, { leadSource: 'website', sessionId: sharedSid });
    await recordTouch({ sid: sharedSid, surface: 'browse', landingPath: '/shared' });
    await ErasedSessionSweep.create({ sessionId: sharedSid, sweepUntil: new Date(Date.now() + 3600_000) });

    const pass1 = await consumeErasedSessionSweeps();
    expect(pass1.deleted).toBeGreaterThanOrEqual(1);
    expect(await Touchpoint.count({ where: { sessionId: sweptSid } })).toBe(1); // only the post-window row survives
    expect((await Touchpoint.findOne({ where: { sessionId: sweptSid }, raw: true })).id).toBe(late.id);
    expect(await Touchpoint.count({ where: { sessionId: sharedSid } })).toBe(1); // guard held
    // Windows are still open ⇒ both sweep rows remain for the next pass.
    expect(await ErasedSessionSweep.count({ where: { sessionId: [sweptSid, sharedSid] } })).toBe(2);

    // Age the swept sid's window out ⇒ the next pass drops its row in-txn.
    await sequelize.query(
      `UPDATE erased_session_sweeps SET "sweepUntil" = now() - interval '1 minute' WHERE "sessionId" = :sid`,
      { replacements: { sid: sweptSid } }
    );
    await consumeErasedSessionSweeps();
    expect(await ErasedSessionSweep.count({ where: { sessionId: sweptSid } })).toBe(0);
    expect(await ErasedSessionSweep.count({ where: { sessionId: sharedSid } })).toBe(1);
  });
});

describe('retention purge (§4.6)', () => {
  it('purges only rows past TOUCHPOINT_RETENTION_DAYS, in bounded batches', async () => {
    const sid = sidOf(0xd1);
    await recordTouch({ sid, surface: 'browse', landingPath: '/fresh' });
    const old = await Touchpoint.create({
      sessionId: sid, occurredAt: new Date(Date.now() - 200 * 24 * 3600_000), surface: 'browse',
    });
    const purged = await purgeOldTouchpoints();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await Touchpoint.findByPk(old.id)).toBeNull();
    expect(await Touchpoint.count({ where: { sessionId: sid } })).toBe(1);
  });
});

describe('§4.5 binding — every web submit carries the session', () => {
  function captureService(overrides = {}) {
    return makeProspectService({
      dispatchEvent: jest.fn(async () => {}),
      canMarketTo: async () => false,
      sendLeadEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendCompleteRegistrationEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendTikTokLeadEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      sendTikTokCompleteRegistrationEvent: jest.fn(async () => ({ sent: false, reason: 'guarded' })),
      logger: silentLogger,
    });
  }
  let seq = 0;
  const body = (extra = {}) => ({
    firstName: 'Touch', lastName: 'Bind',
    phone: `+65${String(10000000 + Math.floor(Math.random() * 89999999))}`,
    leadSource: 'website', campaignId: campaign.id, ...extra,
  });

  it('binds the header sid WITHOUT any attribution row (fastest-submit case) — and a /touch with the same header converges', async () => {
    touchOn();
    const sid = sidOf(0xe1 + (seq += 1));
    await postTouch({}, { 'X-Session-Id': sid });
    const svc = captureService();
    const { prospect } = await svc.createProspect(body(), null, { headers: { 'x-session-id': sid } });
    const fresh = await Prospect.findByPk(prospect.id, { raw: true });
    expect(fresh.sessionId).toBe(sid);
    expect(await Touchpoint.count({ where: { sessionId: sid } })).toBe(1); // same key joins them
  });

  it('ignores an INVALID raw header sid (validation is the §4.2 contract)', async () => {
    const svc = captureService();
    const { prospect } = await svc.createProspect(body(), null, { headers: { 'x-session-id': 'garbage' } });
    const fresh = await Prospect.findByPk(prospect.id, { raw: true });
    expect(fresh.sessionId).toBeNull();
  });

  it('the explicit-campaign guard drops a foreign QR + attribution but KEEPS the sessionId', async () => {
    const { user: owner } = await createTestUser({ role: 'admin' });
    const otherCampaign = await createTestCampaign(owner.id);
    const { QrTag } = await import('../src/models/index.js');
    const foreignQr = await QrTag.create({
      name: `guard-split-${Date.now()}`, slug: `guard-split-${Date.now()}`,
      campaignId: otherCampaign.id, type: 'campaign', destinationUrl: 'https://redeem.sg/x',
    });
    const sid = sidOf(0xf1);
    const svc = captureService();
    const { prospect } = await svc.createProspect(
      body({ qrTagId: foreignQr.id }), // explicit campaign ≠ the QR's campaign
      null,
      { headers: { 'x-session-id': sid } }
    );
    const fresh = await Prospect.findByPk(prospect.id, { raw: true });
    expect(fresh.sessionId).toBe(sid); // kept — browsing identity, not a routing input
    expect(fresh.qrTagId).toBeNull(); // dropped — could skew routing
    expect(fresh.attributionId).toBeNull();
    expect(fresh.campaignId).toBe(campaign.id);
  });
});
