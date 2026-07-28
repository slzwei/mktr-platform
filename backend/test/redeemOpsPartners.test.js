/**
 * Phase 2 Partner CRM — DB-backed tests (brief §37 Claiming + Dedupe).
 * Covers: create with dedupe gates, SIMULTANEOUS CLAIMS → one winner, release,
 * unauthorized reassign, stage machine, activity → lastActivity stamping,
 * merge preserving children, and second-outlet (add-as-location) legitimacy.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import { randomBytes } from 'crypto';
import request from 'supertest';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import {
  PartnerOrganisation, PartnerContact, OutreachActivity,
  PartnerAssignmentEvent, PartnerStageEvent,
  RewardOffer, Activation, RewardEntitlement, Redemption, RewardInventoryEvent,
  RedeemOpsAuditEvent,
} from '../src/models/index.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';

let app;
let admin, execA, execB, bdm;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  execA = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  execB = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
  // Category writes validate against the taxonomy (migration 052); seed the one
  // this suite uses so partner creation isn't rejected as an unknown category.
  await seedRedeemOpsCategory('Nail Salon');
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function createPartner(token, body) {
  return request(app).post('/api/redeem-ops/partners').set(auth(token)).send(body);
}

describe('create + duplicate detection', () => {
  test('create succeeds and derives matching keys', async () => {
    const res = await createPartner(execA.token, {
      tradingName: 'Nail Bliss Pte Ltd',
      category: 'Nail Salon',
      primaryPhone: '+6591230001',
      website: 'https://www.nailbliss-test.sg',
      instagramHandle: '@nailbliss.test',
      uen: '202500001N',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.partner.normalizedName).toBe('nail bliss');
    expect(res.body.data.partner.websiteDomain).toBe('nailbliss-test.sg');
  });

  test.each([
    ['same UEN', { tradingName: 'Different Name Spa', uen: '202500001N' }],
    ['same phone', { tradingName: 'Other Salon', primaryPhone: '+6591230001' }],
    ['same domain', { tradingName: 'Third Salon', website: 'nailbliss-test.sg' }],
    ['same instagram', { tradingName: 'Fourth Salon', instagramHandle: 'nailbliss.test' }],
    ['same normalized name', { tradingName: 'NAIL   BLISS!!' }],
  ])('exact duplicate (%s) → 409 without overrideReason', async (_label, body) => {
    const res = await createPartner(execA.token, body);
    expect(res.status).toBe(409);
    expect(res.body.data.duplicates.exact.length).toBeGreaterThan(0);
  });

  test('exact duplicate + overrideReason → created (audited path)', async () => {
    const res = await createPartner(execA.token, {
      tradingName: 'NAIL BLISS',
      overrideReason: 'Different outlet, confirmed separate owner',
    });
    expect(res.status).toBe(201);
  });

  test('check-duplicates probe surfaces owner + stage for the UI', async () => {
    const res = await request(app)
      .get('/api/redeem-ops/partners/check-duplicates')
      .query({ uen: '202500001N' })
      .set(auth(execB.token));
    expect(res.status).toBe(200);
    expect(res.body.data.duplicates.exact[0].partner.uen).toBe('202500001N');
  });

  test('legitimate second outlet: add as location instead of new business', async () => {
    const partner = await PartnerOrganisation.findOne({ where: { uen: '202500001N' } });
    const res = await request(app)
      .post(`/api/redeem-ops/partners/${partner.id}/locations`)
      .set(auth(admin.token))
      .send({ name: 'Tampines Outlet', postalCode: '520123' });
    expect(res.status).toBe(201);
    expect(res.body.data.location.postalDistrict).toBe('52');
  });
});

describe('claiming (concurrency-safe)', () => {
  let partnerId;
  beforeAll(async () => {
    const res = await createPartner(admin.token, { tradingName: 'Claim Target Studio' });
    partnerId = res.body.data.partner.id;
  });

  test('SIMULTANEOUS claims → exactly one winner, loser gets 409 with claimedBy', async () => {
    const claimService = makeClaimService();
    const results = await Promise.allSettled([
      claimService.claimPartner(partnerId, execA.user),
      claimService.claimPartner(partnerId, execB.user),
      claimService.claimPartner(partnerId, bdm.user),
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled');
    const losses = results.filter((r) => r.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(2);
    for (const loss of losses) {
      expect(loss.reason.statusCode).toBe(409);
      expect(loss.reason.data.claimedBy).toBeTruthy();
    }
    const row = await PartnerOrganisation.findByPk(partnerId);
    expect(row.availability).toBe('owned');
    expect(row.pipelineStage).toBe('NEW'); // ownership is not pipeline progress
  });

  test('BULK claim: partial success — the taken one never rolls back the rest', async () => {
    const free = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await createPartner(admin.token, { tradingName: `Bulk Free ${i} ${randomBytes(3).toString('hex')}` });
      free.push(r.body.data.partner.id);
    }
    // One of the batch is already owned (partnerId, claimed above) — a shared
    // transaction would have discarded the three good claims with it.
    const res = await request(app)
      .post('/api/redeem-ops/partners/bulk-claim')
      .set(auth(execB.token))
      .send({ partnerIds: [...free, partnerId] });

    expect(res.status).toBe(200);
    expect(res.body.data.claimed.sort()).toEqual([...free].sort());
    expect(res.body.data.failed).toHaveLength(1);
    expect(res.body.data.failed[0]).toMatchObject({ id: partnerId, reason: 'already_claimed' });
    expect(res.body.data.failed[0].claimedBy).toBeTruthy(); // says WHO has it
    expect(res.body.message).toMatch(/3 of 4/);

    for (const id of free) {
      const row = await PartnerOrganisation.findByPk(id);
      expect(row.ownerUserId).toBe(execB.user.id);
      expect(row.availability).toBe('owned');
    }
  });

  test('BULK claim is concurrency-safe: two reps, one row, exactly one owner', async () => {
    const r = await createPartner(admin.token, { tradingName: `Bulk Race ${randomBytes(3).toString('hex')}` });
    const id = r.body.data.partner.id;
    const svc = makeClaimService();
    const [a, b] = await Promise.all([
      svc.claimPartnersBulk([id], execA.user),
      svc.claimPartnersBulk([id], bdm.user),
    ]);
    const winners = [a, b].filter((x) => x.claimed.length === 1);
    expect(winners).toHaveLength(1); // the conditional UPDATE still arbitrates
    const row = await PartnerOrganisation.findByPk(id);
    expect([execA.user.id, bdm.user.id]).toContain(row.ownerUserId);
  });

  test('BULK claim rejects an empty or oversized batch', async () => {
    const empty = await request(app).post('/api/redeem-ops/partners/bulk-claim')
      .set(auth(execB.token)).send({ partnerIds: [] });
    expect(empty.status).toBe(400);
    const huge = await request(app).post('/api/redeem-ops/partners/bulk-claim')
      .set(auth(execB.token))
      .send({ partnerIds: Array.from({ length: 101 }, () => '00000000-0000-4000-8000-000000000000') });
    expect(huge.status).toBe(400);
  });

  test('claiming an owned business over HTTP → 409', async () => {
    const res = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/claim`)
      .set(auth(execB.token));
    expect(res.status).toBe(409);
  });

  test('non-owner cannot release; owner can', async () => {
    const row = await PartnerOrganisation.findByPk(partnerId);
    const ownerToken = [execA, execB, bdm].find((u) => u.user.id === row.ownerUserId).token;
    const nonOwner = [execA, execB].find((u) => u.user.id !== row.ownerUserId);

    const denied = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/release`)
      .set(auth(nonOwner.token));
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/release`)
      .set(auth(ownerToken));
    expect(ok.status).toBe(200);
    await row.reload();
    expect(row.ownerUserId).toBeNull();
    expect(row.availability).toBe('available');
  });

  test('outreach exec cannot reassign; bdm can', async () => {
    const denied = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/assign`)
      .set(auth(execA.token))
      .send({ toUserId: execB.user.id });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/assign`)
      .set(auth(bdm.token))
      .send({ toUserId: execB.user.id, reason: 'territory' });
    expect(ok.status).toBe(200);
    const row = await PartnerOrganisation.findByPk(partnerId);
    expect(row.ownerUserId).toBe(execB.user.id);
  });
});

/**
 * The rest of the multi-select family. Same contract as the bulk claim: a
 * PARTIAL batch is a success reported per row, the row-level gates are the same
 * ones the single-row routes enforce, and every applied row still writes its own
 * assignment/stage event.
 */
describe('bulk release / assign / stage', () => {
  const bulkUrl = (action) => `/api/redeem-ops/partners/bulk-${action}`;
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

  /** A fresh unowned row (random name so the dedupe gate never fires). */
  async function freshPartner(label) {
    const res = await createPartner(admin.token, {
      tradingName: `${label} ${randomBytes(4).toString('hex')}`,
    });
    expect(res.status).toBe(201);
    return res.body.data.partner.id;
  }
  const claimAs = (id, who) => request(app)
    .post(`/api/redeem-ops/partners/${id}/claim`).set(auth(who.token));

  test('BULK release: only the caller’s own rows go back to the pool', async () => {
    const mine = await freshPartner('Bulk Release Mine');
    const theirs = await freshPartner('Bulk Release Theirs');
    const unowned = await freshPartner('Bulk Release Unowned');
    await claimAs(mine, execA);
    await claimAs(theirs, execB);

    const res = await request(app).post(bulkUrl('release')).set(auth(execA.token))
      .send({ partnerIds: [mine, theirs, unowned], reason: 'handover' });

    expect(res.status).toBe(200);
    expect(res.body.data.released).toEqual([mine]);
    expect(res.body.message).toMatch(/1 of 3/);
    const failed = byId(res.body.data.failed);
    // A teammate's row names the teammate; an unowned one just isn't owned.
    expect(failed[theirs]).toMatchObject({ reason: 'owned_by_other' });
    expect(failed[theirs].claimedBy.fullName).toBe(execB.user.fullName);
    expect(failed[unowned]).toMatchObject({ reason: 'not_owned' });

    const mineRow = await PartnerOrganisation.findByPk(mine);
    expect(mineRow.ownerUserId).toBeNull();
    expect(mineRow.availability).toBe('available');
    expect((await PartnerAssignmentEvent.findOne({
      where: { partnerOrganisationId: mine, kind: 'release' },
    })).reason).toBe('handover');
    // The one that wasn't the caller's is untouched.
    expect((await PartnerOrganisation.findByPk(theirs)).ownerUserId).toBe(execB.user.id);
  });

  test('BULK assign: a mixed batch lands on one person, each row recording from → to', async () => {
    const owned = await freshPartner('Bulk Assign Owned');
    const free = await freshPartner('Bulk Assign Free');
    await claimAs(owned, execA);

    const res = await request(app).post(bulkUrl('assign')).set(auth(bdm.token))
      .send({ partnerIds: [owned, free], toUserId: execB.user.id, reason: 'territory swap' });

    expect(res.status).toBe(200);
    expect(res.body.data.assigned.sort()).toEqual([owned, free].sort());
    expect(res.body.data.failed).toHaveLength(0);
    for (const id of [owned, free]) {
      expect((await PartnerOrganisation.findByPk(id)).ownerUserId).toBe(execB.user.id);
    }
    const reassign = await PartnerAssignmentEvent.findOne({
      where: { partnerOrganisationId: owned, kind: 'reassign' },
    });
    expect(reassign.fromUserId).toBe(execA.user.id);
    expect(reassign.toUserId).toBe(execB.user.id);
    // The unowned one is an assign, not a reassign — there was no 'from'.
    expect((await PartnerAssignmentEvent.findOne({
      where: { partnerOrganisationId: free, kind: 'assign' },
    })).fromUserId).toBeNull();
  });

  test('BULK assign to someone who is not ops staff fails the request, writing nothing', async () => {
    const id = await freshPartner('Bulk Assign Outsider');
    const outsider = await createTestUser({ role: 'agent' });
    const res = await request(app).post(bulkUrl('assign')).set(auth(bdm.token))
      .send({ partnerIds: [id], toUserId: outsider.user.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/active Redeem Ops staff/i);
    expect((await PartnerOrganisation.findByPk(id)).ownerUserId).toBeNull();
  });

  test('BULK stage: legal moves land, refusals keep the machine’s own words', async () => {
    const moves = await freshPartner('Bulk Stage Moves');
    const already = await freshPartner('Bulk Stage Already');
    const notMine = await freshPartner('Bulk Stage Not Mine');
    await claimAs(moves, execA);
    await claimAs(already, execA);
    await claimAs(notMine, execB);
    await request(app).patch(`/api/redeem-ops/partners/${already}/stage`)
      .set(auth(execA.token)).send({ toStage: 'CONTACTED' });

    const res = await request(app).post(bulkUrl('stage')).set(auth(execA.token))
      .send({ partnerIds: [moves, already, notMine], toStage: 'CONTACTED' });

    expect(res.status).toBe(200);
    // The already-there row is a no-op, not a failure.
    expect(res.body.data.moved.sort()).toEqual([moves, already].sort());
    const failed = byId(res.body.data.failed);
    expect(failed[notMine].reason).toBe('not_owner');
    expect(failed[notMine].message).toMatch(/only move businesses you own/i);

    expect((await PartnerOrganisation.findByPk(moves)).pipelineStage).toBe('CONTACTED');
    expect((await PartnerStageEvent.findOne({
      where: { partnerOrganisationId: moves, toStage: 'CONTACTED' },
    })).actorUserId).toBe(execA.user.id);
    expect((await PartnerOrganisation.findByPk(notMine)).pipelineStage).toBe('NEW');
  });

  test('BULK stage: an illegal jump is a reported skip, never a 500', async () => {
    const id = await freshPartner('Bulk Stage Leap');
    await claimAs(id, execA);
    const res = await request(app).post(bulkUrl('stage')).set(auth(execA.token))
      .send({ partnerIds: [id], toStage: 'PARTNERED' }); // NEW → PARTNERED
    expect(res.status).toBe(200);
    expect(res.body.data.moved).toHaveLength(0);
    expect(res.body.data.failed[0].reason).toBe('rejected');
    expect((await PartnerOrganisation.findByPk(id)).pipelineStage).toBe('NEW');
  });

  test('BULK stage → LOST needs a reason, and records it', async () => {
    const id = await freshPartner('Bulk Stage Lost');
    await claimAs(id, execA);

    const bad = await request(app).post(bulkUrl('stage')).set(auth(execA.token))
      .send({ partnerIds: [id], toStage: 'LOST' });
    expect(bad.status).toBe(400); // refused BEFORE any row is written
    expect((await PartnerOrganisation.findByPk(id)).pipelineStage).toBe('NEW');

    const ok = await request(app).post(bulkUrl('stage')).set(auth(execA.token))
      .send({ partnerIds: [id], toStage: 'LOST', lostReason: 'not_interested' });
    expect(ok.status).toBe(200);
    const row = await PartnerOrganisation.findByPk(id);
    expect(row.pipelineStage).toBe('LOST');
    expect(row.lostReason).toBe('not_interested');
    expect(row.availability).toBe('disqualified'); // leaves the working pool
  });

  test('each bulk route carries its single-row sibling’s capability', async () => {
    const id = await freshPartner('Bulk Caps');
    await claimAs(id, execA);
    // An outreach exec claims and releases but never reassigns.
    expect((await request(app).post(bulkUrl('release')).set(auth(execA.token))
      .send({ partnerIds: [id] })).status).toBe(200);
    expect((await request(app).post(bulkUrl('assign')).set(auth(execA.token))
      .send({ partnerIds: [id], toUserId: execB.user.id })).status).toBe(403);
    // An analyst can see partners and do none of it.
    const analyst = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'analyst' });
    for (const [action, body] of [
      ['release', { partnerIds: [id] }],
      ['assign', { partnerIds: [id], toUserId: execB.user.id }],
      ['stage', { partnerIds: [id], toStage: 'CONTACTED' }],
    ]) {
      expect((await request(app).post(bulkUrl(action)).set(auth(analyst.token))
        .send(body)).status).toBe(403);
    }
  });

  test('every bulk route refuses an empty or oversized batch', async () => {
    const id = await freshPartner('Bulk Shape');
    for (const [action, extra] of [
      ['release', {}],
      ['assign', { toUserId: bdm.user.id }],
      ['stage', { toStage: 'CONTACTED' }],
    ]) {
      const empty = await request(app).post(bulkUrl(action)).set(auth(admin.token))
        .send({ partnerIds: [], ...extra });
      expect(empty.status).toBe(400);
      const huge = await request(app).post(bulkUrl(action)).set(auth(admin.token))
        .send({ partnerIds: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), ...extra });
      expect(huge.status).toBe(400);
    }
    // …and the ids must be uuids.
    expect((await request(app).post(bulkUrl('release')).set(auth(admin.token))
      .send({ partnerIds: [id, 'not-a-uuid'] })).status).toBe(400);
  });
});

describe('stage machine + activities + row-level ownership', () => {
  let partnerId;
  beforeAll(async () => {
    const res = await createPartner(admin.token, { tradingName: 'Stagecraft Fitness' });
    partnerId = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${partnerId}/claim`).set(auth(execA.token));
  });

  test('invalid transition rejected for exec; forced by admin only with reason', async () => {
    const bad = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'PARTNERED' }); // NEW → PARTNERED is not allowed
    expect(bad.status).toBe(400);

    const forcedNoReason = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED' });
    expect(forcedNoReason.status).toBe(400);

    // Entry requirement: no contact on record yet → 422 even for a forcing admin.
    const noContact = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED', reason: 'signed at event' });
    expect(noContact.status).toBe(422);

    await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/contacts`)
      .set(auth(execA.token))
      .send({ name: 'Deal Maker', mobile: '+6591239999' });

    const forced = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED', reason: 'signed at event' });
    expect(forced.status).toBe(200);
  });

  test('backward move: owner exec can correct a mis-drop, but only with a reason', async () => {
    const res = await createPartner(admin.token, { tradingName: 'Backtrack Barbers' });
    const backId = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${backId}/claim`).set(auth(execA.token));
    await request(app)
      .patch(`/api/redeem-ops/partners/${backId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'CONTACTED' });

    const noReason = await request(app)
      .patch(`/api/redeem-ops/partners/${backId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'NEW' });
    expect(noReason.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/redeem-ops/partners/${backId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'NEW', reason: 'Moved back to correct a mis-drop' });
    expect(ok.status).toBe(200);
    const row = await PartnerOrganisation.findByPk(backId);
    expect(row.pipelineStage).toBe('NEW');

    // Forward skips stay closed to execs even with a reason.
    const jump = await request(app)
      .patch(`/api/redeem-ops/partners/${backId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'MEETING', reason: 'trying to skip ahead' });
    expect(jump.status).toBe(400);
  });

  test('backward move rescues a card stuck in PARTNERED (no legal exits)', async () => {
    const res = await createPartner(admin.token, { tradingName: 'Unstick Studio' });
    const stuckId = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${stuckId}/claim`).set(auth(execA.token));
    await request(app)
      .post(`/api/redeem-ops/partners/${stuckId}/contacts`)
      .set(auth(execA.token))
      .send({ name: 'Deal Maker', mobile: '+6591238888' });
    for (const toStage of ['CONTACTED', 'MEETING', 'PARTNERED']) {
      const step = await request(app)
        .patch(`/api/redeem-ops/partners/${stuckId}/stage`)
        .set(auth(execA.token))
        .send({ toStage });
      expect(step.status).toBe(200);
    }

    const back = await request(app)
      .patch(`/api/redeem-ops/partners/${stuckId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'PROPOSAL', reason: 'Partnered was a mis-drop' });
    expect(back.status).toBe(200);
    const row = await PartnerOrganisation.findByPk(stuckId);
    expect(row.pipelineStage).toBe('PROPOSAL');
    expect(row.availability).toBe('owned'); // back in the working pool
  });

  test('LOST requires a reason from the fixed list', async () => {
    const res = await createPartner(admin.token, { tradingName: 'Lost Cause Cafe' });
    const lostId = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${lostId}/claim`).set(auth(execA.token));

    const noReason = await request(app)
      .patch(`/api/redeem-ops/partners/${lostId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'LOST' });
    expect(noReason.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/redeem-ops/partners/${lostId}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'LOST', lostReason: 'not_interested' });
    expect(ok.status).toBe(200);
    const row = await PartnerOrganisation.findByPk(lostId);
    expect(row.pipelineStage).toBe('LOST');
    expect(row.lostReason).toBe('not_interested');
    expect(row.availability).toBe('disqualified'); // out of the working pool
  });

  test('snooze parks with a wake date; unsnooze restores availability', async () => {
    const res = await createPartner(admin.token, { tradingName: 'Sleepy Spa' });
    const snoozeId = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${snoozeId}/claim`).set(auth(execA.token));

    const past = await request(app)
      .post(`/api/redeem-ops/partners/${snoozeId}/snooze`)
      .set(auth(execA.token))
      .send({ until: new Date(Date.now() - 3600 * 1000).toISOString() });
    expect(past.status).toBe(400);

    const wake = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const ok = await request(app)
      .post(`/api/redeem-ops/partners/${snoozeId}/snooze`)
      .set(auth(execA.token))
      .send({ until: wake });
    expect(ok.status).toBe(200);
    let row = await PartnerOrganisation.findByPk(snoozeId);
    expect(row.availability).toBe('follow_up_later');
    expect(row.snoozedUntil).not.toBeNull();

    const un = await request(app)
      .post(`/api/redeem-ops/partners/${snoozeId}/unsnooze`)
      .set(auth(execA.token));
    expect(un.status).toBe(200);
    row = await PartnerOrganisation.findByPk(snoozeId);
    expect(row.availability).toBe('owned');
    expect(row.snoozedUntil).toBeNull();
  });

  test('non-owner exec cannot move stage or log activity on someone else’s partner', async () => {
    const move = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(execB.token))
      .send({ toStage: 'CONTACTED' });
    expect(move.status).toBe(403);

    const log = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/activities`)
      .set(auth(execB.token))
      .send({ type: 'call_attempt', summary: 'tried calling' });
    expect(log.status).toBe(403);
  });

  test('a BDM cannot move or edit a colleague’s business, but may still log activity', async () => {
    const res = await createPartner(admin.token, { tradingName: `Colleague Deal ${Date.now()}` });
    const id = res.body.data.partner.id;
    await request(app).post(`/api/redeem-ops/partners/${id}/claim`).set(auth(execA.token));

    // NEW → CONTACTED is a legal transition; the refusal is purely about ownership.
    const move = await request(app)
      .patch(`/api/redeem-ops/partners/${id}/stage`)
      .set(auth(bdm.token))
      .send({ toStage: 'CONTACTED' });
    expect(move.status).toBe(403);
    expect(await PartnerOrganisation.findByPk(id).then((r) => r.pipelineStage)).toBe('NEW');

    const edit = await request(app)
      .put(`/api/redeem-ops/partners/${id}`)
      .set(auth(bdm.token))
      .send({ tradingName: 'Renamed By Someone Else' });
    expect(edit.status).toBe(403);

    const contact = await request(app)
      .post(`/api/redeem-ops/partners/${id}/contacts`)
      .set(auth(bdm.token))
      .send({ name: 'Not My Contact' });
    expect(contact.status).toBe(403);

    const location = await request(app)
      .post(`/api/redeem-ops/partners/${id}/locations`)
      .set(auth(bdm.token))
      .send({ name: 'Not My Outlet', postalCode: '049483' });
    expect(location.status).toBe(403);

    const snooze = await request(app)
      .post(`/api/redeem-ops/partners/${id}/snooze`)
      .set(auth(bdm.token))
      .send({ until: new Date(Date.now() + 7 * 86400000).toISOString() });
    expect(snooze.status).toBe(403);

    // Visibility is not the thing being restricted — a manager may still log a touch.
    const log = await request(app)
      .post(`/api/redeem-ops/partners/${id}/activities`)
      .set(auth(bdm.token))
      .send({ type: 'internal_note', summary: 'checked in with the team', direction: 'internal' });
    expect(log.status).toBe(201);

    // …and the owner is unaffected.
    const owned = await request(app)
      .patch(`/api/redeem-ops/partners/${id}/stage`)
      .set(auth(execA.token))
      .send({ toStage: 'CONTACTED' });
    expect(owned.status).toBe(200);
  });

  test('an unowned business must be claimed before anyone can move it', async () => {
    const res = await createPartner(admin.token, { tradingName: `Nobody's Deal ${Date.now()}` });
    const id = res.body.data.partner.id;
    expect(await PartnerOrganisation.findByPk(id).then((r) => r.ownerUserId)).toBeNull();

    const denied = await request(app)
      .patch(`/api/redeem-ops/partners/${id}/stage`)
      .set(auth(bdm.token))
      .send({ toStage: 'CONTACTED' });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/claim/i);

    await request(app).post(`/api/redeem-ops/partners/${id}/claim`).set(auth(bdm.token));
    const allowed = await request(app)
      .patch(`/api/redeem-ops/partners/${id}/stage`)
      .set(auth(bdm.token))
      .send({ toStage: 'CONTACTED' });
    expect(allowed.status).toBe(200);
  });

  test('meaningful activity stamps firstOutreachAt/lastActivityAt; internal note does not', async () => {
    const note = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/activities`)
      .set(auth(execA.token))
      .send({ type: 'internal_note', summary: 'research notes', direction: 'internal' });
    expect(note.status).toBe(201);
    let row = await PartnerOrganisation.findByPk(partnerId);
    expect(row.firstOutreachAt).toBeNull();

    const call = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/activities`)
      .set(auth(execA.token))
      .send({ type: 'call_connected', summary: 'spoke to owner', outcome: 'positive' });
    expect(call.status).toBe(201);
    row = await PartnerOrganisation.findByPk(partnerId);
    expect(row.firstOutreachAt).not.toBeNull();
    expect(row.lastActivityAt).not.toBeNull();
  });

  test('timeline merges activities + stage + assignment events, newest first', async () => {
    const res = await request(app)
      .get(`/api/redeem-ops/partners/${partnerId}/timeline`)
      .set(auth(execA.token));
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.data.entries.map((e) => e.kind));
    expect(kinds.has('activity')).toBe(true);
    expect(kinds.has('stage')).toBe(true);
    expect(kinds.has('assignment')).toBe(true);
  });
});

describe('merge preserves everything', () => {
  test('children re-point to survivor; loser hidden from lists but retained', async () => {
    const a = await createPartner(admin.token, { tradingName: 'Merge Survivor Grooming' });
    const b = await createPartner(admin.token, { tradingName: 'Merge Duplicate Grooming', overrideReason: 'test twin' });
    const survivorId = a.body.data.partner.id;
    const duplicateId = b.body.data.partner.id;

    await request(app)
      .post(`/api/redeem-ops/partners/${duplicateId}/contacts`)
      .set(auth(admin.token))
      .send({ name: 'Dup Contact' });
    await request(app)
      .post(`/api/redeem-ops/partners/${duplicateId}/claim`)
      .set(auth(execA.token));
    await request(app)
      .post(`/api/redeem-ops/partners/${duplicateId}/activities`)
      .set(auth(execA.token))
      .send({ type: 'email_sent', summary: 'intro email' });

    const denied = await request(app)
      .post(`/api/redeem-ops/partners/${survivorId}/merge`)
      .set(auth(execA.token))
      .send({ duplicateId });
    expect(denied.status).toBe(403); // outreach_exec lacks partners.merge

    const res = await request(app)
      .post(`/api/redeem-ops/partners/${survivorId}/merge`)
      .set(auth(admin.token))
      .send({ duplicateId, reason: 'same business' });
    expect(res.status).toBe(200);

    const contacts = await PartnerContact.findAll({ where: { partnerOrganisationId: survivorId } });
    expect(contacts.map((c) => c.name)).toContain('Dup Contact');
    const activities = await OutreachActivity.findAll({ where: { partnerOrganisationId: survivorId } });
    expect(activities.length).toBeGreaterThan(0);

    const loser = await PartnerOrganisation.findByPk(duplicateId);
    expect(loser.mergedIntoId).toBe(survivorId);

    const list = await request(app)
      .get('/api/redeem-ops/partners')
      .query({ search: 'Merge Duplicate' })
      .set(auth(admin.token));
    expect(list.body.data.partners.map((p) => p.id)).not.toContain(duplicateId);

    const detail = await request(app)
      .get(`/api/redeem-ops/partners/${duplicateId}`)
      .set(auth(admin.token));
    expect(detail.status).toBe(404);
  });
});

describe('delete — plain vs force cascade', () => {
  async function makePartnerRow(name) {
    const res = await createPartner(admin.token, { tradingName: name });
    expect(res.status).toBe(201);
    return res.body.data.partner;
  }

  // The fulfilment chain hangs off ON DELETE RESTRICT edges — built directly
  // (the API flow needs verified phones, unlock policies, inventory…) since
  // the subject here is deletion order, not issuance.
  async function attachChain(partnerId) {
    const offer = await RewardOffer.create({
      partnerOrganisationId: partnerId, title: 'Free trial class', createdBy: admin.user.id,
    });
    const activation = await Activation.create({
      partnerOrganisationId: partnerId, rewardOfferId: offer.id, createdBy: admin.user.id,
    });
    const entitlement = await RewardEntitlement.create({
      rewardOfferId: offer.id, activationId: activation.id,
      // unique per chain — uq_re_presentation_token
      presentationTokenHash: randomBytes(32).toString('hex'),
    });
    const redemption = await Redemption.create({
      entitlementId: entitlement.id, rewardOfferId: offer.id,
      activationId: activation.id, partnerOrganisationId: partnerId,
    });
    await RewardInventoryEvent.create({
      rewardOfferId: offer.id, type: 'committed', quantity: 5, actorUserId: admin.user.id,
    });
    return { offer, activation, entitlement, redemption };
  }

  test('plain delete removes a clean business', async () => {
    const p = await makePartnerRow('Delete Me Clean');
    const res = await request(app).delete(`/api/redeem-ops/partners/${p.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(await PartnerOrganisation.findByPk(p.id)).toBeNull();
  });

  test('plain delete with fulfilment history → 409 carrying blocker counts', async () => {
    const p = await makePartnerRow('Delete Me Loaded');
    await attachChain(p.id);
    const res = await request(app).delete(`/api/redeem-ops/partners/${p.id}`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.data.forceable).toBe(true);
    expect(res.body.data.blockers).toMatchObject({
      offers: 1, activations: 1, entitlements: 1, redemptions: 1,
    });
    expect(await PartnerOrganisation.findByPk(p.id)).not.toBeNull();
  });

  test('force delete cascades the whole chain and audits the counts', async () => {
    const p = await makePartnerRow('Delete Me Fully');
    const chain = await attachChain(p.id);
    const res = await request(app)
      .delete(`/api/redeem-ops/partners/${p.id}?force=true`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(await PartnerOrganisation.findByPk(p.id)).toBeNull();
    expect(await RewardOffer.findByPk(chain.offer.id)).toBeNull();
    expect(await Activation.findByPk(chain.activation.id)).toBeNull();
    expect(await RewardEntitlement.findByPk(chain.entitlement.id)).toBeNull();
    expect(await Redemption.findByPk(chain.redemption.id)).toBeNull();
    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'partner.deleted', entityId: p.id },
    });
    expect(audit.reason).toContain('force cascade: 1 offers, 1 activations, 1 entitlements, 1 redemptions');
  });

  test('PARTNERED blocks plain delete but yields to force', async () => {
    const p = await makePartnerRow('Delete Me Partnered');
    // Stage set directly — the machine requires contacts for PARTNERED entry,
    // which is not the subject here.
    await PartnerOrganisation.update({ pipelineStage: 'PARTNERED' }, { where: { id: p.id } });
    const plain = await request(app).delete(`/api/redeem-ops/partners/${p.id}`).set(auth(admin.token));
    expect(plain.status).toBe(409);
    expect(plain.body.data.forceable).toBe(true);
    expect(plain.body.data.blockers.stage).toBe('PARTNERED');
    const forced = await request(app)
      .delete(`/api/redeem-ops/partners/${p.id}?force=true`).set(auth(admin.token));
    expect(forced.status).toBe(200);
    expect(await PartnerOrganisation.findByPk(p.id)).toBeNull();
  });

  test('force refuses when a lucky draw hangs off an activation', async () => {
    const p = await makePartnerRow('Delete Me Draw');
    await attachChain(p.id);
    const svc = makePartnerService({ Draw: { count: async () => 1 } });
    await expect(svc.deletePartner(p.id, admin.user, null, { force: true }))
      .rejects.toThrow(/lucky draw/i);
    expect(await PartnerOrganisation.findByPk(p.id)).not.toBeNull();
  });

  test('delete stays behind partners.delete (outreach exec → 403)', async () => {
    const p = await makePartnerRow('Delete Me Capability');
    const res = await request(app).delete(`/api/redeem-ops/partners/${p.id}`).set(auth(execA.token));
    expect(res.status).toBe(403);
  });
});
