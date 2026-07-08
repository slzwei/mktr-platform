/**
 * Phase 3 — tasks, pools, queue (brief §37 Tasks + pool claim-next concurrency).
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { PartnerOrganisation, OutreachTask, ProspectingPoolMember, sequelize } from '../src/models/index.js';
import { makePoolService } from '../src/services/redeemOps/poolService.js';
import { runRedeemOpsStaleSweep } from '../src/services/redeemOps/staleSweep.js';
import { sgtDayWindow } from '../src/services/redeemOps/taskService.js';

let app;
let admin, bdm, execA, execB;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
  execA = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  execB = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function makePartner(name) {
  const res = await request(app)
    .post('/api/redeem-ops/partners')
    .set(auth(admin.token))
    .send({ tradingName: name });
  return res.body.data.partner;
}

describe('tasks', () => {
  let partner;
  beforeAll(async () => {
    partner = await makePartner('Task Target Cafe');
  });

  test('create → nextTaskAt denormalized onto the partner', async () => {
    const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post('/api/redeem-ops/tasks')
      .set(auth(execA.token))
      .send({ title: 'Follow up on 1 Sept', partnerOrganisationId: partner.id, dueAt: due });
    expect(res.status).toBe(201);
    const row = await PartnerOrganisation.findByPk(partner.id);
    expect(new Date(row.nextTaskAt).toISOString()).toBe(due);
  });

  test('exec cannot assign a task to someone else; manager can', async () => {
    const due = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const denied = await request(app)
      .post('/api/redeem-ops/tasks')
      .set(auth(execA.token))
      .send({ title: 'For B', partnerOrganisationId: partner.id, dueAt: due, assigneeUserId: execB.user.id });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post('/api/redeem-ops/tasks')
      .set(auth(bdm.token))
      .send({ title: 'For B', partnerOrganisationId: partner.id, dueAt: due, assigneeUserId: execB.user.id });
    expect(ok.status).toBe(201);
  });

  test('due-state buckets respect the SGT day window', async () => {
    const { start } = sgtDayWindow();
    await OutreachTask.create({
      title: 'Overdue thing', partnerOrganisationId: partner.id,
      assigneeUserId: execA.user.id, createdBy: execA.user.id,
      dueAt: new Date(start.getTime() - 3600 * 1000),
    });
    const res = await request(app)
      .get('/api/redeem-ops/tasks')
      .query({ due: 'overdue' })
      .set(auth(execA.token));
    expect(res.status).toBe(200);
    expect(res.body.data.tasks.some((t) => t.title === 'Overdue thing')).toBe(true);
    // exec's list never contains someone else's tasks
    expect(res.body.data.tasks.every((t) => t.assigneeUserId === execA.user.id)).toBe(true);
  });

  test('completion stamps completedAt/By and clears nextTaskAt when none remain', async () => {
    const solo = await makePartner('Solo Task Studio');
    const created = await request(app)
      .post('/api/redeem-ops/tasks')
      .set(auth(execA.token))
      .send({ title: 'One and done', partnerOrganisationId: solo.id, dueAt: new Date().toISOString() });
    const taskId = created.body.data.task.id;

    const notMine = await request(app)
      .patch(`/api/redeem-ops/tasks/${taskId}`)
      .set(auth(execB.token))
      .send({ status: 'completed' });
    expect(notMine.status).toBe(403);

    const done = await request(app)
      .patch(`/api/redeem-ops/tasks/${taskId}`)
      .set(auth(execA.token))
      .send({ status: 'completed' });
    expect(done.status).toBe(200);
    expect(done.body.data.task.completedBy).toBe(execA.user.id);

    const row = await PartnerOrganisation.findByPk(solo.id);
    expect(row.nextTaskAt).toBeNull();
  });
});

describe('pools + claim-next concurrency', () => {
  let poolId;
  const partnerIds = [];

  beforeAll(async () => {
    const poolRes = await request(app)
      .post('/api/redeem-ops/pools')
      .set(auth(bdm.token))
      .send({ name: `Nail Salons Central ${Date.now()}` });
    poolId = poolRes.body.data.pool.id;
    for (let i = 0; i < 3; i += 1) {
      const p = await makePartner(`Pool Prospect ${Date.now()}-${i}`);
      partnerIds.push(p.id);
    }
    const add = await request(app)
      .post(`/api/redeem-ops/pools/${poolId}/members`)
      .set(auth(bdm.token))
      .send({ partnerIds });
    expect(add.body.data.added).toBe(3);
  });

  test('exec cannot create pools or add members', async () => {
    const denied = await request(app)
      .post('/api/redeem-ops/pools')
      .set(auth(execA.token))
      .send({ name: 'Nope' });
    expect(denied.status).toBe(403);
  });

  test('CONCURRENT claim-next → different partners, no double-claim', async () => {
    const pools = makePoolService();
    const [a, b] = await Promise.all([
      pools.claimNext(poolId, execA.user),
      pools.claimNext(poolId, execB.user),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);

    const rows = await PartnerOrganisation.findAll({ where: { id: [a, b] } });
    const owners = rows.map((r) => r.ownerUserId).sort();
    expect(owners).toEqual([execA.user.id, execB.user.id].sort());
  });

  test('a partner claimed OUTSIDE the pool never surfaces via claim-next (pool exhausted)', async () => {
    const remaining = await ProspectingPoolMember.findOne({ where: { poolId, status: 'available' } });
    // Claim it directly (outside the pool) — the claim-next join now filters it out
    await request(app)
      .post(`/api/redeem-ops/partners/${remaining.partnerOrganisationId}/claim`)
      .set(auth(bdm.token));

    const pools = makePoolService();
    const next = await pools.claimNext(poolId, execA.user);
    expect(next).toBeNull(); // pool had only that one left → exhausted, never re-offered

    const viaHttp = await request(app)
      .post(`/api/redeem-ops/pools/${poolId}/claim-next`)
      .set(auth(execA.token));
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body.data.partnerId).toBeNull();
  });
});

describe('stale sweep', () => {
  test('flags at-risk + stale, but spares FOLLOW_UP_LATER with a future task', async () => {
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);

    const atRisk = await makePartner('AtRisk Barber');
    await PartnerOrganisation.update(
      { ownerUserId: execA.user.id, availability: 'owned', claimedAt: new Date(Date.now() - 72 * 3600 * 1000) },
      { where: { id: atRisk.id } }
    );

    const stale = await makePartner('Stale Bakery');
    await PartnerOrganisation.update(
      { ownerUserId: execA.user.id, availability: 'owned', claimedAt: old, firstOutreachAt: old, lastActivityAt: old, pipelineStage: 'CONTACTED' },
      { where: { id: stale.id } }
    );

    const parked = await makePartner('Parked Gym');
    await PartnerOrganisation.update(
      { ownerUserId: execA.user.id, availability: 'follow_up_later', claimedAt: old, firstOutreachAt: old, lastActivityAt: old, pipelineStage: 'FOLLOW_UP_LATER' },
      { where: { id: parked.id } }
    );
    await OutreachTask.create({
      title: 'Revisit in Q4', partnerOrganisationId: parked.id,
      assigneeUserId: execA.user.id, createdBy: execA.user.id,
      dueAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    await runRedeemOpsStaleSweep();

    expect((await PartnerOrganisation.findByPk(atRisk.id)).atRiskFlag).toBe(true);
    expect((await PartnerOrganisation.findByPk(stale.id)).staleFlag).toBe(true);
    expect((await PartnerOrganisation.findByPk(parked.id)).staleFlag).toBe(false);
  });
});

describe('queue', () => {
  test('my queue aggregates buckets for the signed-in user', async () => {
    const res = await request(app).get('/api/redeem-ops/queue').set(auth(execA.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('overdueTasks');
    expect(res.body.data).toHaveProperty('awaitingFirstOutreach');
    expect(res.body.data.overdueTasks.total).toBeGreaterThan(0);
  });

  test('team pipeline is manager/analyst-gated', async () => {
    expect((await request(app).get('/api/redeem-ops/team/pipeline').set(auth(execA.token))).status).toBe(403);
    expect((await request(app).get('/api/redeem-ops/team/pipeline').set(auth(bdm.token))).status).toBe(200);
  });
});
