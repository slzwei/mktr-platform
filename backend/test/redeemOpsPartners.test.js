/**
 * Phase 2 Partner CRM — DB-backed tests (brief §37 Claiming + Dedupe).
 * Covers: create with dedupe gates, SIMULTANEOUS CLAIMS → one winner, release,
 * unauthorized reassign, stage machine, activity → lastActivity stamping,
 * merge preserving children, and second-outlet (add-as-location) legitimacy.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  PartnerOrganisation, PartnerContact, OutreachActivity, sequelize,
} from '../src/models/index.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';

let app;
let admin, execA, execB, bdm;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  execA = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  execB = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  bdm = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'bdm' });
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
    expect(row.pipelineStage).toBe('CLAIMED');
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
      .send({ toStage: 'PARTNERED' }); // CLAIMED → PARTNERED is not allowed
    expect(bad.status).toBe(400);

    const forcedNoReason = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED' });
    expect(forcedNoReason.status).toBe(400);

    const forced = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(admin.token))
      .send({ toStage: 'PARTNERED', reason: 'signed at event' });
    expect(forced.status).toBe(200);
  });

  test('non-owner exec cannot move stage or log activity on someone else’s partner', async () => {
    const move = await request(app)
      .patch(`/api/redeem-ops/partners/${partnerId}/stage`)
      .set(auth(execB.token))
      .send({ toStage: 'FOLLOW_UP_LATER' });
    expect(move.status).toBe(403);

    const log = await request(app)
      .post(`/api/redeem-ops/partners/${partnerId}/activities`)
      .set(auth(execB.token))
      .send({ type: 'call_attempt', summary: 'tried calling' });
    expect(log.status).toBe(403);
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
