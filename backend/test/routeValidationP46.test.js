/**
 * P4-6 — route-layer validation for the previously unguarded admin writes
 * (users.js / agents.js), plus the partnerService.editActivity gap (the one
 * redeemOps write that passed raw fields through: arbitrary strings persisted
 * into `direction`). Happy paths mirror what the real clients send
 * (src/api/client.js UserEntity.invite / agents.invite), so adding schemas
 * cannot have broken them.
 */
process.env.REDEEM_OPS_ENABLED = 'true'; // partners routes are flag-mounted

import request from 'supertest';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import { OutreachActivity } from '../src/models/index.js';

let app;
let admin;
let agentUser;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  agentUser = await createTestUser({ role: 'agent' });
  await seedRedeemOpsCategory('Nail Salon');
});

afterAll(async () => {
  await closeDb();
});

describe('users.js admin writes are schema-guarded', () => {
  test('POST /api/users rejects a bodyless/junk create (email required, junk role)', async () => {
    const missing = await request(app).post('/api/users').set(auth(admin.token)).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('Validation Error');

    const junkRole = await request(app)
      .post('/api/users')
      .set(auth(admin.token))
      .send({ email: `u-${Date.now()}@test.com`, role: 'superadmin' });
    expect(junkRole.status).toBe(400);
  });

  test('POST /api/users accepts the real create shape', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(admin.token))
      .send({ email: `create-${Date.now()}@test.com`, firstName: 'Val', lastName: 'Idated', role: 'agent' });
    expect(res.status).toBe(201);
  });

  test('POST /api/users/bulk-delete rejects non-uuid ids and an empty list', async () => {
    const junk = await request(app)
      .post('/api/users/bulk-delete')
      .set(auth(admin.token))
      .send({ ids: ['not-a-uuid'] });
    expect(junk.status).toBe(400);

    const empty = await request(app).post('/api/users/bulk-delete').set(auth(admin.token)).send({ ids: [] });
    expect(empty.status).toBe(400);
  });

  test('PUT /api/users/:id rejects junk admin fields but accepts a real profile edit', async () => {
    const junk = await request(app)
      .put(`/api/users/${agentUser.user.id}`)
      .set(auth(admin.token))
      .send({ role: 'root', owed_leads_count: -5 });
    expect(junk.status).toBe(400);

    const ok = await request(app)
      .put(`/api/users/${agentUser.user.id}`)
      .set(auth(admin.token))
      .send({ firstName: 'Edited', isActive: true });
    expect(ok.status).toBe(200);
  });

  test('PATCH status/approval enforce their enums', async () => {
    const badStatus = await request(app)
      .patch(`/api/users/${agentUser.user.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: 'maybe' });
    expect(badStatus.status).toBe(400);

    const badApproval = await request(app)
      .patch(`/api/users/${agentUser.user.id}/approval`)
      .set(auth(admin.token))
      .send({ approvalStatus: 'promoted' });
    expect(badApproval.status).toBe(400);

    const okApproval = await request(app)
      .patch(`/api/users/${agentUser.user.id}/approval`)
      .set(auth(admin.token))
      .send({ approvalStatus: 'approved' });
    expect(okApproval.status).toBe(200);
  });
});

describe('agents.js writes are schema-guarded', () => {
  test('POST /api/agents/invite rejects a missing email, accepts the real client shape', async () => {
    const bad = await request(app).post('/api/agents/invite').set(auth(admin.token)).send({ full_name: 'No Email' });
    expect(bad.status).toBe(400);

    // Real payload shape (src/api/client.js agents.invite) — reaches the
    // controller (email send is a side-effect; anything non-400 proves the
    // schema admitted it).
    const ok = await request(app)
      .post('/api/agents/invite')
      .set(auth(admin.token))
      .send({ email: `agent-inv-${Date.now()}@test.com`, full_name: 'Real Shape', owed_leads_count: 0 });
    expect(ok.status).not.toBe(400);
  });

  test('PUT /api/agents/:id rejects junk isActive, accepts a real edit', async () => {
    const bad = await request(app)
      .put(`/api/agents/${agentUser.user.id}`)
      .set(auth(admin.token))
      .send({ isActive: 'nope' });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .put(`/api/agents/${agentUser.user.id}`)
      .set(auth(admin.token))
      .send({ firstName: 'AgentEdit', isActive: true });
    expect(ok.status).toBe(200);
  });
});

describe('redeemOps editActivity no longer persists raw junk (P4-6 gap)', () => {
  let partnerId;
  let activityId;

  beforeAll(async () => {
    const partner = await request(app)
      .post('/api/redeem-ops/partners')
      .set(auth(admin.token))
      .send({ tradingName: `Edit Gap ${Date.now()}`, category: 'Nail Salon', primaryPhone: '+6591230099' });
    expect(partner.status).toBe(201);
    partnerId = partner.body.data.partner.id;
    const log = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/activities`)
      .set(auth(admin.token))
      .send({ type: 'call_attempt', summary: 'first touch', direction: 'outbound' });
    activityId = log.body.data.activity.id;
  });

  test('junk direction is rejected (used to persist verbatim)', async () => {
    const res = await request(app)
      .patch(`/api/redeem-ops/activities/${activityId}`)
      .set(auth(admin.token))
      .send({ direction: 'sideways<script>' });
    expect(res.status).toBe(400);

    const row = await OutreachActivity.findByPk(activityId);
    expect(row.direction).toBe('outbound'); // unchanged
  });

  test('junk occurredAt is rejected; a valid edit still lands', async () => {
    const bad = await request(app)
      .patch(`/api/redeem-ops/activities/${activityId}`)
      .set(auth(admin.token))
      .send({ occurredAt: 'not-a-date' });
    expect(bad.status).toBe(400);

    const blank = await request(app)
      .patch(`/api/redeem-ops/activities/${activityId}`)
      .set(auth(admin.token))
      .send({ summary: '   ' });
    expect(blank.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/redeem-ops/activities/${activityId}`)
      .set(auth(admin.token))
      .send({ direction: 'inbound', summary: 'corrected note' });
    expect(ok.status).toBe(200);

    const row = await OutreachActivity.findByPk(activityId);
    expect(row.direction).toBe('inbound');
    expect(row.summary).toBe('corrected note');
  });
});
