/**
 * Redeem Ops Phase 1 route + authorization tests (DB-backed, house harness).
 * Covers the Phase 1 gate in docs/redeem-ops/IMPLEMENTATION_PLAN.md:
 *   - capability enforcement (admin bypass, sub-role grant/deny, non-ops 403)
 *   - team invite + role grant with atomic audit rows
 *   - redeem_ops users cannot reach existing admin surfaces
 *   - redeem_ops users are invisible to role='agent' scopes (agent-sync guardrail)
 */
process.env.REDEEM_OPS_ENABLED = 'true'; // must be set before getApp() mounts routes

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { User, RedeemOpsAuditEvent } from '../src/models/index.js';

let app;
let admin, bdm, exec, agent;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  agent = await createTestUser({ role: 'agent' });
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('flag + mounting', () => {
  test('namespace is mounted when REDEEM_OPS_ENABLED=true', async () => {
    const res = await request(app).get('/api/redeem-ops/meta/constants').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.subRoles).toContain('outreach_exec');
    expect(res.body.data.pipelineStages).toContain('PARTNERED');
  });
});

describe('capability enforcement', () => {
  test('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/redeem-ops/team');
    expect(res.status).toBe(401);
  });

  test('admin bypass: implicit super_admin can list team', async () => {
    const res = await request(app).get('/api/redeem-ops/team').set(auth(admin.token));
    expect(res.status).toBe(200);
    const emails = res.body.data.team.map((u) => u.email);
    expect(emails).toEqual(expect.arrayContaining([bdm.user.email, exec.user.email]));
    expect(emails).not.toContain(agent.user.email);
  });

  test('bdm holds analytics.view_team → 200; outreach_exec does not → 403', async () => {
    expect((await request(app).get('/api/redeem-ops/team').set(auth(bdm.token))).status).toBe(200);
    expect((await request(app).get('/api/redeem-ops/team').set(auth(exec.token))).status).toBe(403);
  });

  test('a plain agent is not a Redeem Ops principal → 403', async () => {
    const res = await request(app).get('/api/redeem-ops/meta/constants').set(auth(agent.token));
    expect(res.status).toBe(403);
  });

  test('redeem_ops users cannot reach existing admin surfaces (requireAdmin untouched)', async () => {
    const res = await request(app).get('/api/users').set(auth(bdm.token));
    expect(res.status).toBe(403);
  });
});

describe('team invite', () => {
  test('super admin invites an outreach exec → redeem_ops user with sub-role + audit row', async () => {
    const email = `invitee-${Date.now()}@test.com`;
    const res = await request(app)
      .post('/api/redeem-ops/team/invite')
      .set(auth(admin.token))
      .send({ email, full_name: 'New Outreach', redeemOpsRole: 'outreach_exec' });
    expect(res.status).toBe(201);
    expect(res.body.data.inviteLink).toContain('/auth/accept-invite');

    const created = await User.findOne({ where: { email } });
    expect(created.role).toBe('redeem_ops');
    expect(created.redeemOpsRole).toBe('outreach_exec');

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'access.invited', entityId: created.id },
    });
    expect(audit).not.toBeNull();
    expect(audit.actorUserId).toBe(admin.user.id);
  });

  test('invalid sub-role → 400; non-super-admin → 403', async () => {
    const bad = await request(app)
      .post('/api/redeem-ops/team/invite')
      .set(auth(admin.token))
      .send({ email: `x-${Date.now()}@test.com`, full_name: 'X', redeemOpsRole: 'warlord' });
    expect(bad.status).toBe(400);

    const forbidden = await request(app)
      .post('/api/redeem-ops/team/invite')
      .set(auth(bdm.token))
      .send({ email: `y-${Date.now()}@test.com`, full_name: 'Y', redeemOpsRole: 'analyst' });
    expect(forbidden.status).toBe(403);
  });
});

describe('role grant / revoke', () => {
  test('super admin changes a sub-role atomically with an audit row', async () => {
    const res = await request(app)
      .patch(`/api/redeem-ops/team/${exec.user.id}/role`)
      .set(auth(admin.token))
      .send({ redeemOpsRole: 'bdm' });
    expect(res.status).toBe(200);

    await exec.user.reload();
    expect(exec.user.redeemOpsRole).toBe('bdm');

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'access.role_granted', entityId: exec.user.id },
      order: [['createdAt', 'DESC']],
    });
    expect(audit).not.toBeNull();
    expect(audit.before).toEqual({ redeemOpsRole: 'outreach_exec' });
    expect(audit.after).toEqual({ redeemOpsRole: 'bdm' });

    // restore for other tests
    await exec.user.update({ redeemOpsRole: 'outreach_exec' });
  });

  test('cannot grant a sub-role to an agent; non-super-admin cannot grant at all', async () => {
    const toAgent = await request(app)
      .patch(`/api/redeem-ops/team/${agent.user.id}/role`)
      .set(auth(admin.token))
      .send({ redeemOpsRole: 'analyst' });
    expect(toAgent.status).toBe(400);

    const byBdm = await request(app)
      .patch(`/api/redeem-ops/team/${exec.user.id}/role`)
      .set(auth(bdm.token))
      .send({ redeemOpsRole: 'analyst' });
    expect(byBdm.status).toBe(403);
  });
});

describe('audit listing', () => {
  test('audit is capability-gated and filterable', async () => {
    expect((await request(app).get('/api/redeem-ops/audit').set(auth(exec.token))).status).toBe(403);

    const res = await request(app)
      .get('/api/redeem-ops/audit')
      .query({ action: 'access.role_granted', limit: 10 })
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.events)).toBe(true);
    for (const evt of res.body.data.events) {
      expect(evt.action).toBe('access.role_granted');
    }
  });
});

describe('agent-sync guardrail', () => {
  test("redeem_ops users are invisible to role='agent' scopes (sync sweeps, routing pools)", async () => {
    const agents = await User.findAll({ where: { role: 'agent' }, attributes: ['id'] });
    const ids = agents.map((u) => u.id);
    expect(ids).toContain(agent.user.id);
    expect(ids).not.toContain(bdm.user.id);
    expect(ids).not.toContain(exec.user.id);
  });
});
