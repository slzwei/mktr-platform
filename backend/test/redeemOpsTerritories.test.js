/**
 * Redeem Ops admin-curated Discover territories (migration 063).
 * Covers runtime flag exposure, capability gating, CRUD, active-list filtering,
 * case-insensitive uniqueness, reserved All Singapore sentinel, and write audits.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
delete process.env.DISCOVERY_TERRITORIES_ENABLED;

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { DiscoveryTerritory, RedeemOpsAuditEvent } from '../src/models/index.js';

let app;
let admin;
let bdm;
let exec;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterEach(() => {
  delete process.env.DISCOVERY_TERRITORIES_ENABLED;
});

afterAll(async () => {
  await closeDb();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });
let nameSeq = 0;
const uniq = (base) => `${base} ${Date.now()}-${++nameSeq}`;
const createTerritory = (token, name) => request(app)
  .post('/api/redeem-ops/territories')
  .set(auth(token))
  .send({ name });

describe('read access and runtime flag', () => {
  test('any Redeem Ops principal can list active territories; flag defaults off', async () => {
    const res = await request(app).get('/api/redeem-ops/territories').set(auth(exec.token));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(Array.isArray(res.body.data.territories)).toBe(true);
    expect(res.body.data.territories.some((territory) => territory.name === 'All Singapore')).toBe(false);
  });

  test('enabled is read at request time', async () => {
    process.env.DISCOVERY_TERRITORIES_ENABLED = 'true';
    const res = await request(app).get('/api/redeem-ops/territories').set(auth(exec.token));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
  });
});

describe('CRUD and capability gate', () => {
  test('bdm cannot write; admin can create, list, rename/retire, restore, and delete', async () => {
    const initialName = uniq('Upper Thomson');
    expect((await createTerritory(bdm.token, initialName)).status).toBe(403);

    const created = await createTerritory(admin.token, initialName);
    expect(created.status).toBe(201);
    const id = created.body.data.territory.id;
    expect(created.body.data.territory.name).toBe(initialName);

    const activeList = await request(app).get('/api/redeem-ops/territories').set(auth(exec.token));
    expect(activeList.body.data.territories.some((territory) => territory.id === id)).toBe(true);

    const renamed = uniq('Thomson');
    const update = await request(app)
      .patch(`/api/redeem-ops/territories/${id}`)
      .set(auth(admin.token))
      .send({ name: renamed, isActive: false });
    expect(update.status).toBe(200);
    expect(update.body.data.territory).toMatchObject({ id, name: renamed, isActive: false });

    const afterRetire = await request(app).get('/api/redeem-ops/territories').set(auth(exec.token));
    expect(afterRetire.body.data.territories.some((territory) => territory.id === id)).toBe(false);
    const allRows = await request(app)
      .get('/api/redeem-ops/territories?includeInactive=true')
      .set(auth(exec.token));
    expect(allRows.body.data.territories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, name: renamed, isActive: false }),
    ]));

    const restore = await request(app)
      .patch(`/api/redeem-ops/territories/${id}`)
      .set(auth(admin.token))
      .send({ isActive: true });
    expect(restore.status).toBe(200);
    expect(restore.body.data.territory.isActive).toBe(true);

    const deleted = await request(app)
      .delete(`/api/redeem-ops/territories/${id}`)
      .set(auth(admin.token));
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect(await DiscoveryTerritory.findByPk(id)).toBeNull();

    const audits = await RedeemOpsAuditEvent.findAll({
      where: { entityType: 'discovery_territory', entityId: id },
    });
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining([
      'settings.territory_created',
      'settings.territory_updated',
      'settings.territory_deleted',
    ]));
  });
});

describe('name controls', () => {
  test('case-insensitive duplicate returns 409', async () => {
    const name = uniq('Harbourfront');
    expect((await createTerritory(admin.token, name)).status).toBe(201);
    expect((await createTerritory(admin.token, name.toUpperCase())).status).toBe(409);
  });

  test("'All Singapore' is reserved case-insensitively", async () => {
    expect((await createTerritory(admin.token, 'All Singapore')).status).toBe(400);
    expect((await createTerritory(admin.token, '  ALL SINGAPORE  ')).status).toBe(400);
    expect((await createTerritory(admin.token, 'All   Singapore')).status).toBe(400);
  });
});
