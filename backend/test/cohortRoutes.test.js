import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { Consumer, ConsentEvent, Cohort } from '../src/models/index.js';
import { hashPhone } from '../src/utils/piiHashing.js';

/**
 * /api/cohorts API surface (tracker "cohortapi"): admin gating on every
 * route, CRUD + snapshot lifecycle, preview, members paging, and loud
 * validation failures (incl. the §9.5-2 minAge floor at the HTTP boundary).
 */

const RUN = Date.now() % 1000000000;
let app;
let adminToken;
let agentToken;
let campaign;

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  const agent = await createTestUser({ role: 'agent' });
  adminToken = admin.token;
  agentToken = agent.token;
  campaign = await createTestCampaign(admin.user.id, { name: `Cohort Routes ${RUN}` });

  // One reachable person: adult, verified global grant.
  const phone = `+659${String(RUN).padStart(7, '0').slice(-7)}`;
  const consumer = await Consumer.create({
    phone, phoneHash: hashPhone(phone), firstName: 'Route', lastName: 'Fixture',
    firstSeenAt: new Date(), lastSeenAt: new Date(), signupCount: 1,
  });
  await createTestProspect(campaign.id, {
    phone, consumerId: consumer.id, demographics: { dateOfBirth: '1991-01-01' },
  });
  await ConsentEvent.create({
    consumerId: consumer.id, campaignId: null, kind: 'contact', granted: true,
    channels: ['phone'], version: 'cohort-routes-v1', source: 'signup',
    verified: true, occurredAt: new Date(),
  });
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('auth gating', () => {
  test('401 without a token, 403 for non-admin, on every route', async () => {
    const routes = [
      ['post', '/api/cohorts/preview'],
      ['get', '/api/cohorts/facets'],
      ['post', '/api/cohorts'],
      ['get', '/api/cohorts'],
      ['get', '/api/cohorts/00000000-0000-4000-8000-000000000000'],
      ['put', '/api/cohorts/00000000-0000-4000-8000-000000000000'],
      ['delete', '/api/cohorts/00000000-0000-4000-8000-000000000000'],
      ['get', '/api/cohorts/00000000-0000-4000-8000-000000000000/members'],
    ];
    for (const [method, path] of routes) {
      const bare = await request(app)[method](path);
      expect(bare.status).toBe(401);
      const asAgent = await request(app)[method](path).set(auth(agentToken));
      expect(asAgent.status).toBe(403);
    }
  });
});

describe('preview', () => {
  test('returns counts for a definition without saving anything', async () => {
    const res = await request(app)
      .post('/api/cohorts/preview')
      .set(auth(adminToken))
      .send({ definition: { filters: { campaignIds: [campaign.id] } } });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.reachable).toBe(1);
    expect(res.body.data.gate).toMatchObject({ minAge: 18, campaignId: null, channel: 'all' });
    expect(await Cohort.count()).toBe(0);
  });

  test('validation: minAge 16 is a 400 at the boundary', async () => {
    const res = await request(app)
      .post('/api/cohorts/preview')
      .set(auth(adminToken))
      .send({ definition: { ageGate: { minAge: 16 } } });
    expect(res.status).toBe(400);
  });

  test('gate scope referencing a phantom campaign is a 422', async () => {
    const res = await request(app)
      .post('/api/cohorts/preview')
      .set(auth(adminToken))
      .send({ definition: { marketingContext: { campaignId: '00000000-0000-4000-8000-000000000000' } } });
    expect(res.status).toBe(422);
  });

  test('facets returns the live vocabulary', async () => {
    const res = await request(app).get('/api/cohorts/facets').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.attributes.incomes)).toBe(true);
    expect(Array.isArray(res.body.data.campaigns)).toBe(true);
  });

  test('validation: unknown keys and bad uuids fail loudly', async () => {
    const unknown = await request(app)
      .post('/api/cohorts/preview')
      .set(auth(adminToken))
      .send({ definition: { filters: { campaignIds: [campaign.id] } }, surprise: true });
    expect(unknown.status).toBe(400);
    const badUuid = await request(app)
      .post('/api/cohorts/preview')
      .set(auth(adminToken))
      .send({ definition: { filters: { campaignIds: ['nope'] } } });
    expect(badUuid.status).toBe(400);
  });
});

describe('CRUD lifecycle', () => {
  let cohortId;

  test('create stores the canonical definition and snapshots counts', async () => {
    const res = await request(app)
      .post('/api/cohorts')
      .set(auth(adminToken))
      .send({
        name: `Everyone ${RUN}`,
        description: 'route test cohort',
        definition: { filters: { campaignIds: [campaign.id, campaign.id] } },
      });
    expect(res.status).toBe(201);
    cohortId = res.body.data.id;
    expect(res.body.data.definition.filters.campaignIds).toEqual([campaign.id]); // deduped
    expect(res.body.data.definition.ageGate).toEqual({ minAge: 18, maxAge: null }); // defaulted
    expect(res.body.data.lastTotalCount).toBe(1);
    expect(res.body.data.lastReachableCount).toBe(1);
    expect(res.body.data.preview.byReason).toBeDefined();
  });

  test('list shows it; get returns it; refresh recomputes', async () => {
    const list = await request(app).get('/api/cohorts').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((c) => c.id)).toContain(cohortId);

    const get = await request(app).get(`/api/cohorts/${cohortId}`).set(auth(adminToken));
    expect(get.status).toBe(200);
    expect(get.body.data.preview).toBeUndefined();

    const refreshed = await request(app).get(`/api/cohorts/${cohortId}?refresh=1`).set(auth(adminToken));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.preview.total).toBe(1);
  });

  test('members returns the resolved split for the saved cohort', async () => {
    const res = await request(app)
      .get(`/api/cohorts/${cohortId}/members?status=reachable&limit=10`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.members[0].reachable).toBe(true);
    expect(res.body.data.members[0].reasons).toEqual([]);

    const bad = await request(app)
      .get(`/api/cohorts/${cohortId}/members?status=weird`)
      .set(auth(adminToken));
    expect(bad.status).toBe(422);
  });

  test('update re-normalizes and re-snapshots when the definition changes', async () => {
    const res = await request(app)
      .put(`/api/cohorts/${cohortId}`)
      .set(auth(adminToken))
      .send({ definition: { filters: { campaignIds: [campaign.id] }, ageGate: { minAge: 21 } } });
    expect(res.status).toBe(200);
    expect(res.body.data.definition.ageGate.minAge).toBe(21);
    expect(res.body.data.preview.total).toBe(1);

    const nameOnly = await request(app)
      .put(`/api/cohorts/${cohortId}`)
      .set(auth(adminToken))
      .send({ name: `Renamed ${RUN}` });
    expect(nameOnly.status).toBe(200);
    expect(nameOnly.body.data.name).toBe(`Renamed ${RUN}`);
    expect(nameOnly.body.data.preview).toBeUndefined();
  });

  test('update with a 17+ definition is rejected at the boundary', async () => {
    const res = await request(app)
      .put(`/api/cohorts/${cohortId}`)
      .set(auth(adminToken))
      .send({ definition: { ageGate: { minAge: 17 } } });
    expect(res.status).toBe(400);
  });

  test('archive hides from list and 404s thereafter', async () => {
    const del = await request(app).delete(`/api/cohorts/${cohortId}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/cohorts').set(auth(adminToken));
    expect(list.body.data.map((c) => c.id)).not.toContain(cohortId);
    const get = await request(app).get(`/api/cohorts/${cohortId}`).set(auth(adminToken));
    expect(get.status).toBe(404);
    const again = await request(app).delete(`/api/cohorts/${cohortId}`).set(auth(adminToken));
    expect(again.status).toBe(404);
  });

  test('malformed ids 404 cleanly, never 500', async () => {
    const res = await request(app).get('/api/cohorts/not-a-uuid').set(auth(adminToken));
    expect(res.status).toBe(404);
  });
});
