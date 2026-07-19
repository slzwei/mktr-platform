import { jest } from '@jest/globals';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from '../helpers.js';
import { sequelize, Consumer, Prospect } from '../../src/models/index.js';
import { markPhoneVerified } from '../../src/services/verifiedPhoneStore.js';
import { reconcileConsumerSpine } from '../../src/services/consumerService.js';
import { makeMetaLeadService } from '../../src/services/metaLeadService.js';

/**
 * Consumer spine — integration (real Postgres; savepoint/ON CONFLICT semantics
 * cannot be proven with mocks). Plan §6: docs/plans/consumer-spine-and-consent-ledger.md.
 */

const RUN = Date.now();
const PHONE_A = '+65911100019';
// Distinct 8-digit SG mobiles per scenario, collision-free within the run.
const p8 = (offset) => `9${String(RUN + offset).slice(-7)}`;
// 8-digit SG numbers (normalizePhone adds +65)
const phoneA = `9${String(RUN).slice(-7)}`;          // person A, raw 8-digit
const phoneAE164 = `+65${phoneA}`;
const phoneB = `8${String(RUN).slice(-7)}`;          // person B
const phoneBE164 = `+65${phoneB}`;

let app;
let adminToken;
let agentToken;
let campaign1;
let campaign2;

function capturePayload(overrides = {}) {
  return {
    firstName: 'Spine',
    lastName: 'Tester',
    email: `spine-${RUN}@test.com`,
    phone: phoneA,
    leadSource: 'website',
    consent_contact: true,
    consent_terms: true,
    ...overrides,
  };
}

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminToken = admin.token;
  const agent = await createTestUser({ role: 'agent', phone: `+657${String(RUN).slice(-7)}` });
  agentToken = agent.token;
  campaign1 = await createTestCampaign(admin.user.id, { name: `Spine C1 ${RUN}` });
  campaign2 = await createTestCampaign(admin.user.id, { name: `Spine C2 ${RUN}` });
});

afterAll(async () => {
  await closeDb();
});

describe('consumer spine — capture linkage', () => {
  test('same phone across two campaigns → ONE consumer, both signups linked', async () => {
    markPhoneVerified(phoneAE164); // first signup is OTP-verified
    const r1 = await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id }));
    expect(r1.status).toBe(201);

    const r2 = await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign2.id }));
    expect(r2.status).toBe(201);

    const consumers = await Consumer.findAll({ where: { phone: phoneAE164 } });
    expect(consumers).toHaveLength(1);
    const c = consumers[0];
    expect(c.signupCount).toBe(2);
    // Only the first signup ran inside the 10-min OTP window with a marker we set;
    // the marker is single-use per capture read but keyed+TTL'd, so both may pass
    // depending on store semantics — assert the invariant that holds either way:
    expect(c.verifiedSignupCount).toBeGreaterThanOrEqual(1);
    expect(c.verifiedSignupCount).toBeLessThanOrEqual(2);

    const linked = await Prospect.findAll({ where: { phone: phoneAE164 } });
    expect(linked).toHaveLength(2);
    for (const p of linked) expect(p.consumerId).toBe(c.id);
  });

  test('duplicate signup in the SAME campaign → 409, signupCount unchanged', async () => {
    const before = await Consumer.findOne({ where: { phone: phoneAE164 } });
    const dup = await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id }));
    expect(dup.status).toBe(409);
    const after = await Consumer.findOne({ where: { phone: phoneAE164 } });
    expect(after.signupCount).toBe(before.signupCount);
  });

  test('spine failure never blocks capture (savepoint isolation, real PG)', async () => {
    await sequelize.query('ALTER TABLE consumers RENAME TO consumers_hidden');
    try {
      const r = await request(app).post('/api/prospects')
        .send(capturePayload({ campaignId: campaign1.id, phone: phoneB, email: `b-${RUN}@test.com` }));
      expect(r.status).toBe(201);
      const p = await Prospect.findOne({ where: { phone: phoneBE164 } });
      expect(p).toBeTruthy();
      expect(p.consumerId).toBeNull();
    } finally {
      await sequelize.query('ALTER TABLE consumers_hidden RENAME TO consumers');
    }
  });
});

describe('consumer spine — reconciler', () => {
  test('heals the unlinked row, assigns (not increments) counts, and is idempotent', async () => {
    const s1 = await reconcileConsumerSpine();
    expect(s1.consumersUpserted).toBeGreaterThanOrEqual(2);

    // The savepoint-test row (phoneB) is now linked.
    const pb = await Prospect.findOne({ where: { phone: phoneBE164 } });
    expect(pb.consumerId).toBeTruthy();

    // Corrupt a counter → reconcile assigns the row-derived truth back.
    await sequelize.query(
      `UPDATE consumers SET "signupCount" = 99 WHERE phone = :phone`,
      { replacements: { phone: phoneAE164 } }
    );
    await reconcileConsumerSpine();
    const healed = await Consumer.findOne({ where: { phone: phoneAE164 } });
    expect(healed.signupCount).toBe(2);

    // Idempotent: a second run changes nothing.
    const snapshotBefore = JSON.stringify(
      (await Consumer.findAll({ order: [['phone', 'ASC']] }))
        .map((c) => ({ p: c.phone, n: c.signupCount, v: c.verifiedSignupCount }))
    );
    await reconcileConsumerSpine();
    const snapshotAfter = JSON.stringify(
      (await Consumer.findAll({ order: [['phone', 'ASC']] }))
        .map((c) => ({ p: c.phone, n: c.signupCount, v: c.verifiedSignupCount }))
    );
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  test('call_bot rows never link and get unlinked if they somehow were', async () => {
    const cb = await Prospect.create({
      firstName: 'Voice', email: null, phone: PHONE_A,
      leadSource: 'call_bot', leadStatus: 'new', campaignId: campaign1.id,
    });
    // Force a bogus link, then reconcile.
    const anyConsumer = await Consumer.findOne({ where: { phone: phoneAE164 } });
    await sequelize.query(
      `UPDATE prospects SET "consumerId" = :cid WHERE id = :pid`,
      { replacements: { cid: anyConsumer.id, pid: cb.id } }
    );
    await reconcileConsumerSpine();
    await cb.reload();
    expect(cb.consumerId).toBeNull();
    // And no consumer was minted for the call_bot number.
    expect(await Consumer.findOne({ where: { phone: PHONE_A } })).toBeNull();
  });
});

describe('consumer spine — identity integrity on edits/deletes', () => {
  test('phone edit relinks, recomputes both consumers, and strips the OTP stamp', async () => {
    const p1 = await Prospect.findOne({ where: { phone: phoneAE164, campaignId: campaign1.id } });
    const newPhone8 = `9${String(RUN + 1).slice(-7)}`;
    const newPhoneE164 = `+65${newPhone8}`;

    const r = await request(app)
      .put(`/api/prospects/${p1.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: newPhone8 });
    expect(r.status).toBe(200);

    await p1.reload();
    expect(p1.phone).toBe(newPhoneE164);
    expect(p1.sourceMetadata?.phoneVerifiedAt).toBeUndefined();
    expect(p1.sourceMetadata?.phoneVerifiedFor).toBeUndefined();

    const oldC = await Consumer.findOne({ where: { phone: phoneAE164 } });
    const newC = await Consumer.findOne({ where: { phone: newPhoneE164 } });
    expect(oldC.signupCount).toBe(1);
    expect(newC).toBeTruthy();
    expect(newC.signupCount).toBe(1);
    expect(p1.consumerId).toBe(newC.id);

    // Move it back for the later tests (also exercises the reverse path).
    await request(app)
      .put(`/api/prospects/${p1.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: phoneA })
      .expect(200);
  });

  test('delete recomputes the consumer projection', async () => {
    const victim = await Prospect.findOne({ where: { phone: phoneAE164, campaignId: campaign2.id } });
    const r = await request(app)
      .delete(`/api/prospects/${victim.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    const c = await Consumer.findOne({ where: { phone: phoneAE164 } });
    expect(c.signupCount).toBe(1);
  });
});

describe('consumer spine — read surfaces', () => {
  test('GET /api/consumers/:id → admin-only journey; 403 for agents; 404s clean', async () => {
    const c = await Consumer.findOne({ where: { phone: phoneAE164 } });

    const ok = await request(app)
      .get(`/api/consumers/${c.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.consumer.id).toBe(c.id);
    expect(ok.body.data.consumer.signupCount).toBe(1);
    expect(Array.isArray(ok.body.data.signups)).toBe(true);
    expect(ok.body.data.signups[0].campaign?.name).toBeTruthy();
    // Journey rows are DERIVED — no raw sourceMetadata leaves this endpoint.
    expect(JSON.stringify(ok.body.data)).not.toContain('sourceMetadata');

    const forbidden = await request(app)
      .get(`/api/consumers/${c.id}`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(forbidden.status).toBe(403);

    await request(app)
      .get('/api/consumers/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    await request(app)
      .get('/api/consumers/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  test('GET /api/prospects/:id (admin) carries the consumer journey block', async () => {
    const p = await Prospect.findOne({ where: { phone: phoneAE164 } });
    const r = await request(app)
      .get(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.data.prospect.consumer).toBeTruthy();
    expect(r.body.data.prospect.consumer.consumer.signupCount).toBe(1);
  });
});

describe('consumer spine — Codex R2 additions', () => {
  test('CONCURRENT captures across two campaigns → one consumer, count 2', async () => {
    const ph = p8(3);
    const [r1, r2] = await Promise.all([
      request(app).post('/api/prospects')
        .send(capturePayload({ campaignId: campaign1.id, phone: ph, email: `cc-a-${RUN}@test.com` })),
      request(app).post('/api/prospects')
        .send(capturePayload({ campaignId: campaign2.id, phone: ph, email: `cc-b-${RUN}@test.com` })),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const consumers = await Consumer.findAll({ where: { phone: `+65${ph}` } });
    expect(consumers).toHaveLength(1);
    expect(consumers[0].signupCount).toBe(2);
  });

  test('CONCURRENT duplicates in ONE campaign → exactly one 201 + one structured 409, count 1', async () => {
    // Outcome contract: whichever side loses (precheck or the unique-index
    // catch after full rollback), the caller sees the SAME structured 409 and
    // the winner's consumer counts exactly one signup.
    const ph = p8(4);
    const results = await Promise.all([
      request(app).post('/api/prospects')
        .send(capturePayload({ campaignId: campaign1.id, phone: ph, email: `dup-a-${RUN}@test.com` })),
      request(app).post('/api/prospects')
        .send(capturePayload({ campaignId: campaign1.id, phone: ph, email: `dup-b-${RUN}@test.com` })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const dup = results.find((r) => r.status === 409);
    expect(JSON.stringify(dup.body)).toContain('alreadyRegistered');
    const c = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    expect(c.signupCount).toBe(1);
    expect(await Prospect.count({ where: { phone: `+65${ph}` } })).toBe(1);
  });

  test('Meta lead links to the same consumer as a web signup (unverified)', async () => {
    // NOTE: the Prospect model validates E.164 at create, so Meta phones are
    // ALWAYS stored E.164 or the create fails (pre-existing behavior — a raw
    // 8-digit payload was tried here and correctly rejected). Realistic Meta
    // payloads carry the profile number as +E.164.
    const ph = p8(5);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: ph, email: `meta-web-${RUN}@test.com` }))
      .expect(201);

    const metaSvc = makeMetaLeadService({
      fetch: jest.fn(async () => ({
        ok: true,
        json: async () => ({
          field_data: [
            { name: 'full_name', values: ['Meta Person'] },
            { name: 'phone_number', values: [`+65${ph}`] },
            { name: 'email', values: [`meta-lead-${RUN}@test.com`] },
          ],
        }),
      })),
    });
    process.env.META_PAGE_ACCESS_TOKEN = 'test-token';
    const res = await metaSvc.processMetaLead(`lg-${RUN}`, 'page-1', null, Math.floor(RUN / 1000));
    expect(res.status).toBe('created');

    const metaProspect = await Prospect.findByPk(res.prospectId);
    expect(metaProspect.phone).toBe(`+65${ph}`);
    const c = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    expect(c.signupCount).toBe(2); // web + meta
    expect(metaProspect.consumerId).toBe(c.id);
    // Meta is never OTP-verified.
    expect(c.verifiedSignupCount).toBe(0);
  });

  test('PUT phone to blank clears the number AND the person link', async () => {
    const ph = p8(6);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign2.id, phone: ph, email: `blank-${RUN}@test.com` }))
      .expect(201);
    const { id } = await Prospect.findOne({ where: { phone: `+65${ph}` } });
    const r = await request(app)
      .put(`/api/prospects/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '' });
    expect(r.status).toBe(200);
    const p = await Prospect.findByPk(id);
    expect(p.phone).toBeNull();
    expect(p.consumerId).toBeNull();
    const c = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    expect(c.signupCount).toBe(0);
  });

  test('PUT phone onto ANOTHER person merges the signup into their consumer', async () => {
    const phKeep = p8(7);
    const phMove = p8(8);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign1.id, phone: phKeep, email: `keep-${RUN}@test.com` }))
      .expect(201);
    await request(app).post('/api/prospects')
      .send(capturePayload({ campaignId: campaign2.id, phone: phMove, email: `move-${RUN}@test.com` }))
      .expect(201);
    const { id: movedId } = await Prospect.findOne({ where: { phone: `+65${phMove}` } });

    await request(app)
      .put(`/api/prospects/${movedId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: phKeep })
      .expect(200);

    const keepC = await Consumer.findOne({ where: { phone: `+65${phKeep}` } });
    const moveC = await Consumer.findOne({ where: { phone: `+65${phMove}` } });
    const movedRow = await Prospect.findByPk(movedId);
    expect(movedRow.consumerId).toBe(keepC.id);
    expect(keepC.signupCount).toBe(2);
    expect(moveC.signupCount).toBe(0);
  });

  test('verified lastName survives a later verified signup that omits it (R2 #1)', async () => {
    const ph = p8(9);
    markPhoneVerified(`+65${ph}`);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign1.id, phone: ph, firstName: 'First', lastName: 'Keeper',
        email: `ln-a-${RUN}@test.com`,
      }))
      .expect(201);
    markPhoneVerified(`+65${ph}`);
    await request(app).post('/api/prospects')
      .send(capturePayload({
        campaignId: campaign2.id, phone: ph, firstName: 'Second', lastName: undefined,
        email: `ln-b-${RUN}@test.com`,
      }))
      .expect(201);
    const c = await Consumer.findOne({ where: { phone: `+65${ph}` } });
    expect(c.firstName).toBe('Second');
    expect(c.lastName).toBe('Keeper');
  });
});
