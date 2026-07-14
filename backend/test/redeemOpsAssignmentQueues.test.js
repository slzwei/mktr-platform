/**
 * Phase 4 Assignment Queues (the persisted API/model names remain pools).
 * DB-backed coverage for free-text labels, computed status, and unchanged
 * claim-next concurrency / mid-flight conditional-claim retry behavior.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  PartnerOrganisation, ProspectingPoolMember,
} from '../src/models/index.js';
import { makePoolService } from '../src/services/redeemOps/poolService.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';

let app;
let admin;
let bdm;
let execA;
let execB;
let seq = 0;

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const uniq = (base) => `${base} ${Date.now()}-${++seq}`;

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

async function createPartner(label) {
  const res = await request(app)
    .post('/api/redeem-ops/partners')
    .set(auth(admin.token))
    .send({ tradingName: uniq(label) });
  expect(res.status).toBe(201);
  return res.body.data.partner;
}

async function createQueue(body = {}) {
  const res = await request(app)
    .post('/api/redeem-ops/pools')
    .set(auth(bdm.token))
    .send({ name: uniq('Assignment Queue'), ...body });
  expect(res.status).toBe(201);
  return res.body.data.pool;
}

async function stockQueue(poolId, count) {
  const partners = [];
  for (let i = 0; i < count; i += 1) partners.push(await createPartner(`Queue Prospect ${i}`));
  const res = await request(app)
    .post(`/api/redeem-ops/pools/${poolId}/members`)
    .set(auth(bdm.token))
    .send({ partnerIds: partners.map((partner) => partner.id) });
  expect(res.status).toBe(200);
  expect(res.body.data.added).toBe(count);
  return partners;
}

describe('labels and computed status', () => {
  test('a free-text category outside the taxonomy is trimmed and accepted', async () => {
    const category = uniq('Experimental Wellness Cohort');
    const queue = await createQueue({ category: `  ${category}  `, area: 'East-ish' });
    expect(queue.category).toBe(category);
    expect(queue.area).toBe('East-ish');
  });

  test('listPools computes exhausted, active, and archived without storing status', async () => {
    const service = makePoolService();
    const exhausted = await service.createPool({ name: uniq('Empty Queue') }, bdm.user);
    const active = await service.createPool({ name: uniq('Stocked Queue') }, bdm.user);
    await stockQueue(active.id, 1);
    const archived = await service.createPool({ name: uniq('Archived Queue') }, bdm.user);
    await service.updatePool(archived.id, { isActive: false }, bdm.user);

    const listed = await service.listPools();
    const byId = new Map(listed.map((pool) => [pool.id, pool]));
    expect(byId.get(exhausted.id).status).toBe('exhausted');
    expect(byId.get(active.id).status).toBe('active');
    expect(byId.get(archived.id).status).toBe('archived');
    expect(byId.get(archived.id).isActive).toBe(false);
  });
});

describe('claim-next invariants', () => {
  test('concurrent claimers receive different partners', async () => {
    const queue = await createQueue();
    await stockQueue(queue.id, 2);
    const service = makePoolService();
    const [first, second] = await Promise.all([
      service.claimNext(queue.id, execA.user),
      service.claimNext(queue.id, execB.user),
    ]);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);

    const rows = await PartnerOrganisation.findAll({ where: { id: [first, second] } });
    expect(rows.map((row) => row.ownerUserId).sort()).toEqual([
      execA.user.id, execB.user.id,
    ].sort());
  });

  test('a partner claimed after member selection is removed and the retry returns the next', async () => {
    const queue = await createQueue();
    const partners = await stockQueue(queue.id, 2);
    const realClaims = makeClaimService();
    let interceptedPartnerId = null;
    let intercept = true;
    const service = makePoolService({
      claims: {
        claimPartnerTx: async (partnerId, user, transaction, via) => {
          if (intercept) {
            intercept = false;
            interceptedPartnerId = partnerId;
            await realClaims.claimPartner(partnerId, execB.user);
          }
          return realClaims.claimPartnerTx(partnerId, user, transaction, via);
        },
      },
    });

    const claimedPartnerId = await service.claimNext(queue.id, execA.user);
    expect(interceptedPartnerId).toBeTruthy();
    expect(claimedPartnerId).toBeTruthy();
    expect(claimedPartnerId).not.toBe(interceptedPartnerId);
    expect(partners.map((partner) => partner.id)).toEqual(expect.arrayContaining([
      interceptedPartnerId, claimedPartnerId,
    ]));

    const racedMember = await ProspectingPoolMember.findOne({
      where: { poolId: queue.id, partnerOrganisationId: interceptedPartnerId },
    });
    expect(racedMember.status).toBe('removed');
    expect((await PartnerOrganisation.findByPk(interceptedPartnerId)).ownerUserId).toBe(execB.user.id);
    expect((await PartnerOrganisation.findByPk(claimedPartnerId)).ownerUserId).toBe(execA.user.id);
  });
});
