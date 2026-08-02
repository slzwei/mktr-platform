/**
 * P2-12 regression: ONE LIKE-escaper across every search endpoint.
 *
 * utils/escapeLike.js escapes the BACKSLASH first, then % and _, and caps the
 * length — but it was imported by exactly one file. Six sites carried an
 * uncorrected inline copy that escaped only %/_ , so a search term ending in a
 * single backslash produced a pattern ending in the escape character and
 * Postgres refused it: "LIKE pattern must not end with escape character" → 500.
 * Three redeem-ops sites escaped nothing at all, so `%` matched everything and
 * there was no length cap.
 *
 * These drive the real HTTP surfaces — a 500 here is the actual user-visible
 * bug, not a unit-level abstraction of it.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import { PartnerOrganisation } from '../src/models/index.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';

let app, admin;

/** Every search surface that carried an inline copy or no escaping at all. */
const ENDPOINTS = [
  ['campaigns', '/api/campaigns'],
  ['agents', '/api/agents'],
  ['users', '/api/users'],
  ['prospects', '/api/prospects'],
];

const HOSTILE = [
  ['a single trailing backslash', 'abc\\'],
  ['a lone backslash', '\\'],
  ['a double backslash', 'a\\\\b'],
  ['a percent wildcard', '%'],
  ['an underscore wildcard', '_'],
  ['every metacharacter at once', '%_\\'],
];

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  await createTestCampaign(admin.user.id, { name: 'Escape Test Campaign' });
});

afterAll(async () => { await closeDb(); });

for (const [label, path] of ENDPOINTS) {
  describe(`GET ${label}?search — hostile patterns never 500`, () => {
    for (const [name, term] of HOSTILE) {
      it(`survives ${name}`, async () => {
        const res = await request(app)
          .get(path)
          .query({ search: term })
          .set('Authorization', `Bearer ${admin.token}`);

        // 200 (or an auth/permission code) — anything but a server error.
        expect(res.status).toBeLessThan(500);
      });
    }
  });
}

describe('wildcards are treated LITERALLY, not as patterns', () => {
  it('a bare % does not match every campaign', async () => {
    const all = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${admin.token}`);
    const wildcard = await request(app)
      .get('/api/campaigns')
      .query({ search: '%' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(all.status).toBe(200);
    expect(wildcard.status).toBe(200);

    const count = (r) => (r.body?.data?.campaigns || r.body?.data || []).length;
    expect(count(all)).toBeGreaterThan(0);
    // Escaped, '%' is a literal character no campaign name contains.
    expect(count(wildcard)).toBeLessThan(count(all));
  });

  it('a bare _ does not act as a single-character wildcard', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .query({ search: '_' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect((res.body?.data?.campaigns || res.body?.data || []).length).toBe(0);
  });
});

/**
 * The redeem-ops sites escaped NOTHING, so a bare `%` was a live SQL wildcard:
 * it matched every partner regardless of what the operator typed. This is the
 * discriminating case for those three call sites.
 */
describe('redeem-ops partner search treats wildcards literally', () => {
  const partners = [];
  let svc;

  beforeAll(async () => {
    svc = makePartnerService();
    for (const tradingName of ['Escape Alpha Spa', 'Escape Beta Salon']) {
      partners.push(await PartnerOrganisation.create({
        tradingName, normalizedName: tradingName.toLowerCase(), createdBy: admin.user.id,
      }));
    }
  });

  afterAll(async () => {
    await PartnerOrganisation.destroy({ where: { id: partners.map((p) => p.id) } });
  });

  it('a bare % matches NOTHING — it is a character, not a wildcard', async () => {
    const all = await svc.listPartners({}, admin.user);
    const wildcard = await svc.listPartners({ search: '%' }, admin.user);

    const count = (r) => (r.partners || r.rows || r).length;
    expect(count(all)).toBeGreaterThanOrEqual(2);
    expect(count(wildcard)).toBe(0);
  });

  it('a bare _ matches nothing either', async () => {
    const res = await svc.listPartners({ search: '_' }, admin.user);
    expect((res.partners || res.rows || res).length).toBe(0);
  });

  it('an ordinary term still finds its partner', async () => {
    const res = await svc.listPartners({ search: 'Escape Alpha' }, admin.user);
    expect((res.partners || res.rows || res).length).toBe(1);
  });

  it('caps an over-long term instead of passing it to the database', async () => {
    const res = await svc.listPartners({ search: 'x'.repeat(5000) }, admin.user);
    expect((res.partners || res.rows || res).length).toBe(0);
  });
});
