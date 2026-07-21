import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import {
  EmailBroadcast, EmailBroadcastRecipient, Cohort, Consumer, ConsentEvent,
} from '../src/models/index.js';
import { hashPhone } from '../src/utils/piiHashing.js';

/**
 * /api/email-broadcasts surface (tracker "emailpush"): admin gating on every
 * route, draft CRUD + the draft-only edit/delete fences, phantom 422s, the
 * send preflight at the HTTP boundary, the paged send log, the self-only
 * test send, and the erasure matrix scrubbing recipient rows.
 */

const RUN = Date.now() % 1000000000;
let seq = 0;
const nextPhone = () => `+657${String(RUN + (seq += 1)).padStart(7, '0').slice(-7)}`;

let app;
let admin;
let adminToken;
let agentToken;
let campaign;
let cohort;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const NIL = '00000000-0000-4000-8000-000000000000';

async function makeConsumer({ email } = {}) {
  const phone = nextPhone();
  const consumer = await Consumer.create({
    phone, phoneHash: hashPhone(phone), firstName: 'Route', lastName: 'Fixture',
    email: email || `route-${RUN}-${seq}@example.test`,
    firstSeenAt: new Date(), lastSeenAt: new Date(), signupCount: 1,
  });
  await createTestProspect(campaign.id, {
    phone, consumerId: consumer.id, demographics: { dateOfBirth: '1992-02-02' },
  });
  await ConsentEvent.create({
    consumerId: consumer.id, campaignId: null, kind: 'contact', granted: true,
    channels: ['phone'], version: `emailpush-routes-${RUN}`, source: 'signup',
    verified: true, occurredAt: new Date(),
  });
  return consumer;
}

function validBody(overrides = {}) {
  return {
    cohortId: cohort.id,
    campaignId: campaign.id,
    subject: 'Route test push',
    bodyText: 'One paragraph.',
    ...overrides,
  };
}

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  const agent = await createTestUser({ role: 'agent' });
  adminToken = admin.token;
  agentToken = agent.token;
  campaign = await createTestCampaign(admin.user.id, { name: `Broadcast Routes ${RUN}` });
  cohort = await Cohort.create({
    name: `Broadcast Routes Cohort ${RUN}`,
    definition: {
      filters: { campaignIds: [campaign.id], drawIds: [], anyDraw: false, campaignTags: [], attributes: { postalPrefixes: [], incomes: [], educations: [], genders: [] } },
      ageGate: { minAge: 18, maxAge: null },
      marketingContext: { campaignId: null },
    },
  });
});

afterAll(async () => {
  await closeDb();
});

describe('auth gating', () => {
  test('401 without a token, 403 for non-admin, on every route', async () => {
    const routes = [
      ['post', '/api/email-broadcasts'],
      ['get', '/api/email-broadcasts'],
      ['get', `/api/email-broadcasts/${NIL}`],
      ['put', `/api/email-broadcasts/${NIL}`],
      ['delete', `/api/email-broadcasts/${NIL}`],
      ['post', `/api/email-broadcasts/${NIL}/send`],
      ['post', `/api/email-broadcasts/${NIL}/cancel`],
      ['post', `/api/email-broadcasts/${NIL}/test`],
      ['get', `/api/email-broadcasts/${NIL}/recipients`],
    ];
    for (const [method, path] of routes) {
      const anon = await request(app)[method](path);
      expect(anon.status).toBe(401);
      const nonAdmin = await request(app)[method](path).set(auth(agentToken));
      expect(nonAdmin.status).toBe(403);
    }
  });
});

describe('draft lifecycle', () => {
  test('create → detail (with definition + ctaUrlPreview) → edit → delete', async () => {
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.ctaLabel).toBe('Learn more');
    expect(created.body.data.cohort.name).toContain('Broadcast Routes Cohort');
    expect(created.body.data.campaign.name).toContain('Broadcast Routes');

    const detail = await request(app).get(`/api/email-broadcasts/${id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.cohort.definition).toBeTruthy();
    expect(detail.body.data.ctaUrlPreview).toContain(`campaign_id=${campaign.id}`);
    expect(detail.body.data.ctaUrlPreview).toContain('utm_medium=email');
    expect(detail.body.data.liveCounts).toEqual({ pending: 0, attempting: 0, sent: 0, skipped: 0, failed: 0 });

    const listed = await request(app).get('/api/email-broadcasts').set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((b) => b.id === id)).toBe(true);

    const edited = await request(app).put(`/api/email-broadcasts/${id}`).set(auth(adminToken)).send({ subject: 'Edited subject' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.subject).toBe('Edited subject');

    const deleted = await request(app).delete(`/api/email-broadcasts/${id}`).set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(await EmailBroadcast.findByPk(id)).toBeNull();
  });

  test('phantom cohort / campaign 422; malformed id 404; validation 400s', async () => {
    const phantomCohort = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody({ cohortId: NIL }));
    expect(phantomCohort.status).toBe(422);
    const phantomCampaign = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody({ campaignId: NIL }));
    expect(phantomCampaign.status).toBe(422);

    const malformed = await request(app).get('/api/email-broadcasts/not-a-uuid').set(auth(adminToken));
    expect(malformed.status).toBe(404);

    const missingSubject = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody({ subject: undefined }));
    expect(missingSubject.status).toBe(400);
    const longSubject = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody({ subject: 'x'.repeat(201) }));
    expect(longSubject.status).toBe(400);
    const unknownKey = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody({ nope: true }));
    expect(unknownKey.status).toBe(400);
    const badResume = await request(app).post(`/api/email-broadcasts/${NIL}/send`).set(auth(adminToken)).send({ resume: 'yes' });
    expect(badResume.status).toBe(400);
  });

  test('non-draft broadcasts cannot be edited or deleted (409)', async () => {
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    await EmailBroadcast.update({ status: 'completed' }, { where: { id } });

    const edited = await request(app).put(`/api/email-broadcasts/${id}`).set(auth(adminToken)).send({ subject: 'Nope' });
    expect(edited.status).toBe(409);
    const deleted = await request(app).delete(`/api/email-broadcasts/${id}`).set(auth(adminToken));
    expect(deleted.status).toBe(409);
  });
});

describe('send / cancel / test at the HTTP boundary', () => {
  test('send 422s on the transport preflight (unconfigured test env) and reverts to draft', async () => {
    await makeConsumer();
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    const sent = await request(app).post(`/api/email-broadcasts/${id}/send`).set(auth(adminToken)).send({});
    expect(sent.status).toBe(422);
    expect(sent.body.message).toMatch(/transport/i);
    const after = await EmailBroadcast.findByPk(id);
    expect(after.status).toBe('draft');
    expect(after.lastError).toMatch(/transport/i);
  });

  test('cancel on a draft 409s; cancel on an interrupted broadcast lands cancelled', async () => {
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    const noop = await request(app).post(`/api/email-broadcasts/${id}/cancel`).set(auth(adminToken));
    expect(noop.status).toBe(409);

    await EmailBroadcast.update({ status: 'interrupted' }, { where: { id } });
    const consumer = await makeConsumer();
    await EmailBroadcastRecipient.create({ broadcastId: id, consumerId: consumer.id, email: consumer.email, status: 'pending' });

    const cancelled = await request(app).post(`/api/email-broadcasts/${id}/cancel`).set(auth(adminToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    const rows = await EmailBroadcastRecipient.findAll({ where: { broadcastId: id } });
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].reason).toBe('cancelled');
  });

  test('test send takes NO address parameter and 422s while the mailer is unconfigured', async () => {
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    const res = await request(app).post(`/api/email-broadcasts/${id}/test`).set(auth(adminToken)).send({ to: 'attacker@example.com' });
    // The body is ignored (no schema accepts `to`); the send targets the
    // requesting admin and fails only on the unconfigured transport.
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not configured|Mailer/i);
  });
});

describe('send log', () => {
  test('recipients page + filter by status', async () => {
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    await EmailBroadcast.update({ status: 'completed' }, { where: { id } });
    const statuses = ['sent', 'sent', 'skipped', 'failed'];
    for (const status of statuses) {
      const c = await makeConsumer();
      await EmailBroadcastRecipient.create({
        broadcastId: id, consumerId: c.id, email: c.email, status,
        reason: status === 'skipped' ? 'suppressed' : status === 'failed' ? 'send_error' : null,
        sentAt: status === 'sent' ? new Date() : null,
      });
    }

    const all = await request(app).get(`/api/email-broadcasts/${id}/recipients`).set(auth(adminToken));
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(4);

    const sentOnly = await request(app).get(`/api/email-broadcasts/${id}/recipients?status=sent`).set(auth(adminToken));
    expect(sentOnly.body.data.total).toBe(2);
    expect(sentOnly.body.data.recipients.every((r) => r.status === 'sent')).toBe(true);

    const paged = await request(app).get(`/api/email-broadcasts/${id}/recipients?limit=2&offset=2`).set(auth(adminToken));
    expect(paged.body.data.recipients).toHaveLength(2);
    expect(paged.body.data.limit).toBe(2);
    expect(paged.body.data.offset).toBe(2);
  });
});

describe('erasure integration', () => {
  test('erasing a consumer nulls recipient email + error, keeps delivery facts', async () => {
    const c = await makeConsumer({ email: `erase-${RUN}@example.test` });
    const created = await request(app).post('/api/email-broadcasts').set(auth(adminToken)).send(validBody());
    const id = created.body.data.id;
    await EmailBroadcast.update({ status: 'completed' }, { where: { id } });
    const row = await EmailBroadcastRecipient.create({
      broadcastId: id, consumerId: c.id, email: c.email, status: 'failed',
      reason: 'send_error', error: `550 mailbox ${c.email} unavailable`, sentAt: null,
    });

    const erased = await request(app)
      .post(`/api/consumers/${c.id}/erase`)
      .set(auth(adminToken))
      .send({ confirm: 'ERASE' });
    expect(erased.status).toBe(200);

    const after = await EmailBroadcastRecipient.findByPk(row.id);
    expect(after.email).toBeNull();
    expect(after.error).toBeNull();
    expect(after.status).toBe('failed');
    expect(after.reason).toBe('send_error');
    expect(after.consumerId).toBe(c.id);
  });
});
