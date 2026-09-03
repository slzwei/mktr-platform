/**
 * /api/rsvp (admin) + /api/rsvp-public — docs/plans/rsvp-pages.md §5 on a real
 * database: explicit admin gating on every route, the lifecycle contract, the
 * publish guard, slug rules, frozen fields, the submit transaction (validation,
 * honeypot, dedupe-upsert that never overwrites consent, capacity under the
 * event lock incl. CONCURRENT submits), and cursor pagination.
 */
import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import { sequelize, RsvpEvent, RsvpResponse } from '../src/models/index.js';
import { CURRENT_RSVP_CONSENT_VERSION, RSVP_CONSENT_VERSIONS } from '../src/services/rsvpConsentRegistry.js';

const RUN = Date.now().toString(36).slice(-5);
const ZERO = '00000000-0000-4000-8000-000000000000';
let app;
let adminToken;
let agentToken;
let seq = 0;

beforeAll(async () => {
  process.env.RSVP_ENABLED = 'true'; // routes mount at init — before the first getApp()
  app = await getApp();
  adminToken = (await createTestUser({ role: 'admin' })).token;
  agentToken = (await createTestUser({ role: 'agent' })).token;
});

afterAll(async () => {
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const admin = () => auth(adminToken);
const slugOf = (s) => `${s}-${RUN}-${++seq}`;

async function createEvent(body = {}) {
  const res = await request(app).post('/api/rsvp').set(admin()).send({ title: 'Launch night', organiserName: 'Acme Pte Ltd', ...body });
  expect(res.status).toBe(201);
  return res.body.data.event;
}

const CONTENT_LAYOUT = {
  blocks: [
    { id: 'b_hero', type: 'hero', headline: 'Launch night', subheadline: 'Drinks + demos' },
    { id: 'b_when', type: 'details', rows: [{ label: 'When', value: 'Sat 4 Oct, 7pm' }] },
    { id: 'b_form', type: 'form', headline: 'Save your spot', submitLabel: 'Count me in' },
  ],
  fields: [
    { key: 'name' }, { key: 'email' }, { key: 'phone', label: 'Mobile' },
    { key: 'f_diet', type: 'select', label: 'Diet', required: true, options: ['Veg', 'Halal'] },
    { key: 'f_note', type: 'textarea', label: 'Note' },
    { key: 'f_okay', type: 'checkbox', label: 'I will bring ID', required: true },
  ],
};

async function publishedEvent(over = {}) {
  const ev = await createEvent({ slug: slugOf('live'), ...over.create });
  const patch = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ layout: CONTENT_LAYOUT, ...over.patch });
  expect(patch.status).toBe(200);
  const pub = await request(app).post(`/api/rsvp/${ev.id}/publish`).set(admin());
  expect(pub.status).toBe(200);
  return pub.body.data.event;
}

const answersFor = (email, extra = {}) => ({
  answers: { name: 'Alice Tan', email, phone: '91234567', f_diet: 'Veg', f_note: 'hi', f_okay: true, ...extra },
  consent: true,
});
const respond = (slug, body) => request(app).post(`/api/rsvp-public/${slug}/respond`).send(body);

describe('admin gating', () => {
  test('401 without a token and 403 for a non-admin on every route', async () => {
    const routes = [
      ['get', '/api/rsvp'], ['post', '/api/rsvp'], ['get', '/api/rsvp/slug-availability?slug=x'],
      ['get', `/api/rsvp/${ZERO}`], ['patch', `/api/rsvp/${ZERO}`], ['post', `/api/rsvp/${ZERO}/publish`],
      ['post', `/api/rsvp/${ZERO}/close`], ['delete', `/api/rsvp/${ZERO}`], ['get', `/api/rsvp/${ZERO}/responses`],
      ['get', `/api/rsvp/${ZERO}/responses.csv`], ['patch', `/api/rsvp/${ZERO}/responses/${ZERO}`], ['post', `/api/rsvp/${ZERO}/purge`],
    ];
    for (const [method, path] of routes) {
      expect((await request(app)[method](path)).status).toBe(401);
      expect((await request(app)[method](path).set(auth(agentToken))).status).toBe(403);
    }
  });

  test('the public surface needs no token', async () => {
    expect((await request(app).get('/api/rsvp-public/nope-nope')).status).toBe(404);
  });
});

describe('create / read / update', () => {
  test('a new event is a seeded draft with the consent copy naming the organiser', async () => {
    const ev = await createEvent();
    expect(ev).toMatchObject({ status: 'draft', slug: null, frozen: false, locked: false, goingCount: 0, responseCount: 0, consentVersion: CURRENT_RSVP_CONSENT_VERSION });
    expect(ev.layout.blocks.filter((b) => b.type === 'form')).toHaveLength(1);
    expect(ev.consent.copy).toContain('Acme Pte Ltd');
    expect(ev.problems).toEqual(['slug_missing']);
    const list = await request(app).get('/api/rsvp').set(admin());
    expect(list.body.data.events.some((e) => e.id === ev.id)).toBe(true);
    expect(list.body.data.events[0].layout).toBeUndefined();
  });

  test('validation is loud: unknown keys, empty title, malformed ids', async () => {
    expect((await request(app).post('/api/rsvp').set(admin()).send({ title: 'x', surprise: 1 })).status).toBe(400);
    expect((await request(app).post('/api/rsvp').set(admin()).send({ title: '   ' })).status).toBe(400);
    expect((await request(app).get('/api/rsvp/not-a-uuid').set(admin())).status).toBe(404);
    expect((await request(app).get(`/api/rsvp/${ZERO}`).set(admin())).status).toBe(404);
    const ev = await createEvent();
    expect((await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ capacity: 0 })).status).toBe(400);
    expect((await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ closesAt: 'soon' })).status).toBe(400);
    expect((await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ layout: 'x' })).status).toBe(400);
  });

  test('slug rules: shape, reserved roots, uniqueness, availability probe', async () => {
    const taken = slugOf('taken');
    await createEvent({ slug: taken });
    const dup = await request(app).post('/api/rsvp').set(admin()).send({ title: 'x', slug: taken });
    expect(dup.status).toBe(409);
    expect(dup.body.data.code).toBe('slug_taken');
    const reserved = await request(app).post('/api/rsvp').set(admin()).send({ title: 'x', slug: 'api' });
    expect(reserved.status).toBe(400);
    expect(reserved.body.data.code).toBe('slug_reserved');
    const bad = await request(app).post('/api/rsvp').set(admin()).send({ title: 'x', slug: 'Bad Slug' });
    expect(bad.status).toBe(400);
    expect(bad.body.data.code).toBe('slug_invalid');

    const probe = (slug) => request(app).get(`/api/rsvp/slug-availability?slug=${slug}`).set(admin()).then((r) => r.body.data);
    expect(await probe(taken)).toMatchObject({ available: false, reason: 'taken' });
    expect(await probe('uploads')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await probe('X')).toMatchObject({ available: false, reason: 'invalid' });
    expect(await probe(slugOf('free'))).toMatchObject({ available: true, reason: null });
  });

  test('layout writes are clamped; closesAt wall time is anchored to SGT', async () => {
    const ev = await createEvent();
    const res = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({
      layout: { internal: 1, blocks: [{ type: 'carousel' }, { id: 'b_h', type: 'hero', headline: 'Hi', secret: 'x' }, { type: 'form' }], fields: [{ key: 'foo' }] },
      closesAt: '2026-10-04T14:00',
      capacity: 40,
    });
    expect(res.status).toBe(200);
    const { layout, closesAt, capacity } = res.body.data.event;
    expect(layout.internal).toBeUndefined();
    expect(layout.blocks.map((b) => b.type)).toEqual(['hero', 'form']);
    expect(layout.blocks[0].secret).toBeUndefined();
    expect(layout.fields.map((f) => f.key)).toEqual(['name', 'email']);
    expect(new Date(closesAt).toISOString()).toBe('2026-10-04T06:00:00.000Z');
    expect(capacity).toBe(40);
    const cleared = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ closesAt: null, capacity: null });
    expect(cleared.body.data.event).toMatchObject({ closesAt: null, capacity: null });
  });
});

describe('lifecycle', () => {
  test('publish guard names every problem; publish stamps the era; slug + organiser freeze; close/reopen', async () => {
    const ev = await createEvent({ organiserName: '' });
    const noSlug = await request(app).post(`/api/rsvp/${ev.id}/publish`).set(admin());
    expect(noSlug.status).toBe(422);
    expect(noSlug.body.data.code).toBe('not_publishable');
    expect(noSlug.body.data.problems).toEqual(expect.arrayContaining(['slug_missing', 'organiser_missing']));

    const slug = slugOf('life');
    await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({
      slug, organiserName: 'Acme', layout: { ...CONTENT_LAYOUT, fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_one1', type: 'select', options: ['only'] }] },
    });
    const fewOptions = await request(app).post(`/api/rsvp/${ev.id}/publish`).set(admin());
    expect(fewOptions.status).toBe(422);
    expect(fewOptions.body.data.problems).toEqual(['options_too_few:f_one1']);

    await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ layout: CONTENT_LAYOUT });
    const pub = await request(app).post(`/api/rsvp/${ev.id}/publish`).set(admin());
    expect(pub.status).toBe(200);
    expect(pub.body.data.event).toMatchObject({ status: 'published', locked: true, consentVersion: CURRENT_RSVP_CONSENT_VERSION, problems: [] });
    const publishedAt = pub.body.data.event.publishedAt;
    expect(publishedAt).toBeTruthy();

    const reslug = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ slug: slugOf('renamed') });
    expect(reslug.status).toBe(409);
    expect(reslug.body.data.code).toBe('slug_frozen');
    const reorg = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ organiserName: 'Someone Else' });
    expect(reorg.status).toBe(409);
    expect(reorg.body.data.code).toBe('organiser_frozen');
    // Unchanged values are not a change.
    expect((await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ slug, organiserName: 'Acme', title: 'Renamed title' })).status).toBe(200);

    const closed = await request(app).post(`/api/rsvp/${ev.id}/close`).set(admin());
    expect(closed.body.data.event.status).toBe('closed');
    const again = await request(app).post(`/api/rsvp/${ev.id}/close`).set(admin());
    expect(again.status).toBe(409);
    expect(again.body.data.code).toBe('not_published');
    const reopened = await request(app).post(`/api/rsvp/${ev.id}/publish`).set(admin());
    expect(reopened.body.data.event).toMatchObject({ status: 'published', publishedAt });
  });

  test('delete: only an unpublished draft with no responses', async () => {
    const draft = await createEvent();
    expect((await request(app).delete(`/api/rsvp/${draft.id}`).set(admin())).status).toBe(200);
    expect((await request(app).get(`/api/rsvp/${draft.id}`).set(admin())).status).toBe(404);
    const live = await publishedEvent();
    const refused = await request(app).delete(`/api/rsvp/${live.id}`).set(admin());
    expect(refused.status).toBe(409);
    expect(refused.body.data.code).toBe('delete_refused');
  });
});

describe('public read', () => {
  test('404 for unknown, malformed, and draft slugs', async () => {
    expect((await request(app).get('/api/rsvp-public/does-not-exist')).status).toBe(404);
    expect((await request(app).get('/api/rsvp-public/X')).status).toBe(404);
    const draft = await createEvent({ slug: slugOf('draft') });
    expect((await request(app).get(`/api/rsvp-public/${draft.slug}`)).status).toBe(404);
  });

  test('open: rebuilt layout + rendered consent; closed / ended / full: chrome without a consent block', async () => {
    const ev = await publishedEvent();
    await sequelize.query(`UPDATE rsvp_events SET layout = layout || '{"internal":{"secret":1}}'::jsonb WHERE id = :id`, { replacements: { id: ev.id } });
    const open = await request(app).get(`/api/rsvp-public/${ev.slug}`);
    expect(open.status).toBe(200);
    expect(open.body.data).toMatchObject({ slug: ev.slug, title: 'Launch night', organiserName: 'Acme Pte Ltd', state: 'open' });
    expect(open.body.data.layout.internal).toBeUndefined();
    expect(open.body.data.layout.blocks.map((b) => b.type)).toEqual(['hero', 'details', 'form']);
    expect(open.body.data.consent).toEqual({ version: CURRENT_RSVP_CONSENT_VERSION, copy: expect.stringContaining('Acme Pte Ltd') });
    for (const key of ['id', 'createdBy', 'consentVersion', 'capacity', 'retentionUntil']) expect(open.body.data[key]).toBeUndefined();

    await request(app).post(`/api/rsvp/${ev.id}/close`).set(admin());
    const closed = await request(app).get(`/api/rsvp-public/${ev.slug}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.state).toBe('closed');
    expect(closed.body.data.consent).toBeUndefined();
    expect(closed.body.data.layout.blocks).toHaveLength(3);

    const ended = await publishedEvent({ patch: { closesAt: '2020-01-01T00:00:00Z' } });
    expect((await request(app).get(`/api/rsvp-public/${ended.slug}`)).body.data.state).toBe('ended');

    const tiny = await publishedEvent({ patch: { capacity: 1 } });
    expect((await respond(tiny.slug, answersFor('one@example.com'))).status).toBe(201);
    expect((await request(app).get(`/api/rsvp-public/${tiny.slug}`)).body.data.state).toBe('full');
  });
});

describe('respond', () => {
  test('a valid submission is stored with the server-resolved consent era and only whitelisted attribution', async () => {
    const ev = await publishedEvent();
    const res = await respond(ev.slug, {
      ...answersFor('Alice.Tan@Example.com', { f_note: 'see you\u202E' }),
      source: { utm_source: 'ig', referrer: 'https://redeem.sg/x?token=1' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ status: 'created' });
    const row = await RsvpResponse.findOne({ where: { rsvpEventId: ev.id } });
    expect(row).toMatchObject({
      name: 'Alice Tan', email: 'Alice.Tan@Example.com', emailNormalized: 'alice.tan@example.com', phone: '+6591234567', status: 'going',
      consentVersion: CURRENT_RSVP_CONSENT_VERSION, consentCopyHash: RSVP_CONSENT_VERSIONS[CURRENT_RSVP_CONSENT_VERSION].templateHash,
      answers: { f_diet: 'Veg', f_note: 'see you', f_okay: true },
      sourceMetadata: { utm_source: 'ig', referrer: 'https://redeem.sg/x' },
    });
    const view = await request(app).get(`/api/rsvp/${ev.id}`).set(admin());
    expect(view.body.data.event).toMatchObject({ goingCount: 1, responseCount: 1, frozen: true });
  });

  test('validation: consent tick, event-defined keys only, option membership, required checkbox, client-supplied evidence', async () => {
    const ev = await publishedEvent();
    const bad = async (body, re) => {
      const r = await respond(ev.slug, body);
      expect(r.status).toBe(400);
      expect(r.body.data.code).toBe('invalid');
      expect(JSON.stringify(r.body.data.errors)).toMatch(re);
    };
    await bad({ ...answersFor('a@x.com'), consent: false }, /consent/);
    await bad(answersFor('a@x.com', { f_ghost: 'x' }), /f_ghost/);
    await bad(answersFor('a@x.com', { f_diet: 'Beef' }), /f_diet/);
    await bad(answersFor('a@x.com', { f_okay: false }), /f_okay/);
    await bad({ ...answersFor('a@x.com'), consentVersion: 'old' }, /consentVersion/);
    expect(await RsvpResponse.count({ where: { rsvpEventId: ev.id } })).toBe(0);
  });

  test('honeypot hits look like success and store nothing; oversized bodies are refused before any work', async () => {
    const ev = await publishedEvent();
    const bot = await respond(ev.slug, { ...answersFor('bot@x.com'), website: 'http://spam' });
    expect(bot.status).toBe(200);
    expect(bot.body.data).toEqual({ status: 'ok' });
    expect(await RsvpResponse.count({ where: { rsvpEventId: ev.id } })).toBe(0);
    const huge = await respond(ev.slug, answersFor('big@x.com', { f_note: 'x'.repeat(40_000) }));
    expect(huge.status).toBe(413);
  });

  test('draft → 404, closed → 409 closed, ended → 409 ended', async () => {
    const draft = await createEvent({ slug: slugOf('drf') });
    expect((await respond(draft.slug, answersFor('a@x.com'))).status).toBe(404);
    const ev = await publishedEvent();
    await request(app).post(`/api/rsvp/${ev.id}/close`).set(admin());
    const closed = await respond(ev.slug, answersFor('a@x.com'));
    expect(closed.status).toBe(409);
    expect(closed.body.data.code).toBe('closed');
    const ended = await publishedEvent({ patch: { closesAt: '2020-01-01T00:00:00Z' } });
    const late = await respond(ended.slug, answersFor('a@x.com'));
    expect(late.status).toBe(409);
    expect(late.body.data.code).toBe('ended');
  });

  test('resubmit from the same address (any casing) updates the answers and never touches the consent stamp', async () => {
    const ev = await publishedEvent();
    expect((await respond(ev.slug, answersFor('alice@example.com'))).status).toBe(201);
    await sequelize.query(`UPDATE rsvp_responses SET "consentVersion" = 'old-era', "consentCopyHash" = 'old-hash' WHERE "rsvpEventId" = :id`, { replacements: { id: ev.id } });
    const again = await respond(ev.slug, answersFor('  ALICE@Example.com ', { f_diet: 'Halal', f_note: 'changed' }));
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ status: 'updated' });
    const rows = await RsvpResponse.findAll({ where: { rsvpEventId: ev.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ consentVersion: 'old-era', consentCopyHash: 'old-hash', answers: { f_diet: 'Halal', f_note: 'changed', f_okay: true } });
  });

  test('capacity: full is 409, a resubmit is not a seat, a cancelled seat frees, reactivation needs a seat', async () => {
    const ev = await publishedEvent({ patch: { capacity: 1 } });
    expect((await respond(ev.slug, answersFor('one@x.com'))).status).toBe(201);
    const full = await respond(ev.slug, answersFor('two@x.com'));
    expect(full.status).toBe(409);
    expect(full.body.data.code).toBe('full');
    expect((await respond(ev.slug, answersFor('one@x.com'))).status).toBe(200);
    await RsvpResponse.update({ status: 'cancelled' }, { where: { rsvpEventId: ev.id } });
    expect((await respond(ev.slug, answersFor('three@x.com'))).status).toBe(201);
    const reactivate = await respond(ev.slug, answersFor('one@x.com'));
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.data.code).toBe('full');
  });

  test('CONCURRENT submits at capacity 1 hand out exactly one seat; concurrent same-email submits make one row', async () => {
    const ev = await publishedEvent({ patch: { capacity: 1 } });
    const race = await Promise.all(Array.from({ length: 6 }, (_, i) => respond(ev.slug, answersFor(`racer${i}@x.com`))));
    const codes = race.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await RsvpResponse.count({ where: { rsvpEventId: ev.id, status: 'going' } })).toBe(1);

    const ev2 = await publishedEvent();
    const same = await Promise.all(Array.from({ length: 6 }, () => respond(ev2.slug, answersFor('same@x.com'))));
    expect(same.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(same.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await RsvpResponse.count({ where: { rsvpEventId: ev2.id } })).toBe(1);
  });

  test('once anyone has responded, field keys/types/options are frozen and fields cannot be deleted', async () => {
    const ev = await publishedEvent();
    expect((await respond(ev.slug, answersFor('a@x.com'))).status).toBe(201);
    const patch = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({
      layout: { ...CONTENT_LAYOUT, fields: [{ key: 'name' }, { key: 'email' }, { key: 'f_note', type: 'text', label: 'Anything else?' }, { key: 'f_okay', type: 'text' }] },
    });
    expect(patch.status).toBe(200);
    const fields = patch.body.data.event.layout.fields;
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(['email', 'f_diet', 'f_note', 'f_okay', 'name', 'phone']);
    expect(byKey.f_diet).toMatchObject({ type: 'select', options: ['Veg', 'Halal'] });
    expect(byKey.f_note).toMatchObject({ type: 'textarea', label: 'Anything else?' });
    expect(byKey.f_okay.type).toBe('checkbox');
    expect(patch.body.data.event.frozen).toBe(true);
  });
});

describe('responses listing', () => {
  test('cursor pagination in (createdAt, id) order; bad cursors are 400', async () => {
    const ev = await publishedEvent();
    for (const e of ['p1@x.com', 'p2@x.com', 'p3@x.com']) expect((await respond(ev.slug, answersFor(e))).status).toBe(201);
    const first = await request(app).get(`/api/rsvp/${ev.id}/responses?limit=2`).set(admin());
    expect(first.status).toBe(200);
    expect(first.body.data.responses.map((r) => r.email)).toEqual(['p1@x.com', 'p2@x.com']);
    expect(first.body.data.responses[0]).toMatchObject({ name: 'Alice Tan', status: 'going', consentVersion: CURRENT_RSVP_CONSENT_VERSION, answers: { f_diet: 'Veg' } });
    expect(first.body.data.nextCursor).toBeTruthy();
    const second = await request(app).get(`/api/rsvp/${ev.id}/responses?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`).set(admin());
    expect(second.body.data.responses.map((r) => r.email)).toEqual(['p3@x.com']);
    expect(second.body.data.nextCursor).toBeNull();
    expect((await request(app).get(`/api/rsvp/${ev.id}/responses?cursor=%25%25%25`).set(admin())).status).toBe(400);
    expect((await request(app).get(`/api/rsvp/${ZERO}/responses`).set(admin())).status).toBe(404);
  });
});

describe('responses export + correction (P2)', () => {
  test('CSV: labels as headers, hostile values neutralised, answers flattened', async () => {
    const ev = await publishedEvent();
    expect((await respond(ev.slug, answersFor('csv1@x.com', { name: '=HYPERLINK("evil")', f_note: 'a,b' }))).status).toBe(201);
    const res = await request(app).get(`/api/rsvp/${ev.id}/responses.csv`).set(admin());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="rsvp-.*-responses\.csv"/);
    const [header, line] = res.text.split('\r\n');
    expect(header).toBe('name,email,phone,status,Diet,Note,I will bring ID,consent_version,submitted_at,updated_at');
    // A leading + is a formula marker too — phones get the same ' guard the prospect export applies.
    const expectedPrefix = `"'=HYPERLINK(""evil"")",csv1@x.com,'+6591234567,going,Veg,"a,b",yes,`;
    expect(line.slice(0, expectedPrefix.length)).toBe(expectedPrefix);
    expect((await request(app).get(`/api/rsvp/${ZERO}/responses.csv`).set(admin())).status).toBe(404);
  });

  test('PATCH response: cancel frees a seat, reactivation needs one, corrections are validated, email is immutable', async () => {
    const ev = await publishedEvent({ patch: { capacity: 1 } });
    expect((await respond(ev.slug, answersFor('first@x.com'))).status).toBe(201);
    const first = (await request(app).get(`/api/rsvp/${ev.id}/responses`).set(admin())).body.data.responses[0];
    const url = `/api/rsvp/${ev.id}/responses/${first.id}`;

    const cancelled = await request(app).patch(url).set(admin()).send({ status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.response.status).toBe('cancelled');
    expect((await respond(ev.slug, answersFor('second@x.com'))).status).toBe(201); // seat freed
    const reactivate = await request(app).patch(url).set(admin()).send({ status: 'going' });
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.data.code).toBe('full');

    const fixed = await request(app).patch(url).set(admin()).send({ name: 'Alice T.', phone: '8123 4567', answers: { f_diet: 'Halal' } });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.response).toMatchObject({ name: 'Alice T.', phone: '+6581234567', answers: { f_diet: 'Halal', f_note: 'hi', f_okay: true } });
    const stored = await RsvpResponse.findByPk(first.id);
    expect(stored.consentVersion).toBe(CURRENT_RSVP_CONSENT_VERSION);

    const badAnswer = await request(app).patch(url).set(admin()).send({ answers: { f_diet: 'Beef' } });
    expect(badAnswer.status).toBe(400);
    const ghost = await request(app).patch(url).set(admin()).send({ answers: { f_ghost: 'x' } });
    expect(ghost.status).toBe(400);
    const email = await request(app).patch(url).set(admin()).send({ email: 'new@x.com' });
    expect(email.status).toBe(400);
    expect((await request(app).patch(url).set(admin()).send({})).status).toBe(400);
    expect((await request(app).patch(url).set(admin()).send({ surprise: 1 })).status).toBe(400);
    expect((await request(app).patch(`/api/rsvp/${ev.id}/responses/${ZERO}`).set(admin()).send({ status: 'going' })).status).toBe(404);
    const other = await publishedEvent();
    expect((await request(app).patch(`/api/rsvp/${other.id}/responses/${first.id}`).set(admin()).send({ status: 'going' })).status).toBe(404);
    expect((await request(app).patch(`/api/rsvp/${ev.id}/responses/not-a-uuid`).set(admin()).send({ status: 'going' })).status).toBe(404);
  });
});

describe('purge + retention (P3)', () => {
  test('purge is refused while published, then takes the event and its responses; retentionUntil is stored', async () => {
    const ev = await publishedEvent();
    expect((await respond(ev.slug, answersFor('gone@x.com'))).status).toBe(201);
    const refused = await request(app).post(`/api/rsvp/${ev.id}/purge`).set(admin()).send({ reason: 'test cleanup' });
    expect(refused.status).toBe(409);
    expect(refused.body.data.code).toBe('purge_refused');
    expect((await request(app).post(`/api/rsvp/${ev.id}/purge`).set(admin()).send({})).status).toBe(400);

    const kept = await request(app).patch(`/api/rsvp/${ev.id}`).set(admin()).send({ retentionUntil: '2030-01-01T00:00' });
    expect(kept.status).toBe(200);
    expect(new Date(kept.body.data.event.retentionUntil).toISOString()).toBe('2029-12-31T16:00:00.000Z');

    await request(app).post(`/api/rsvp/${ev.id}/close`).set(admin());
    const purged = await request(app).post(`/api/rsvp/${ev.id}/purge`).set(admin()).send({ reason: 'test cleanup' });
    expect(purged.status).toBe(200);
    expect(purged.body.data).toEqual({ purged: true, responseCount: 1 });
    expect((await request(app).get(`/api/rsvp/${ev.id}`).set(admin())).status).toBe(404);
    expect(await RsvpResponse.count({ where: { rsvpEventId: ev.id } })).toBe(0);
  });

  test('the retention sweep purges closed/draft events past their date and leaves published ones alone', async () => {
    const { purgeExpiredEvents } = await import('../src/services/rsvpService.js');
    const closed = await publishedEvent({ patch: { retentionUntil: '2020-01-01T00:00' } });
    await request(app).post(`/api/rsvp/${closed.id}/close`).set(admin());
    const live = await publishedEvent({ patch: { retentionUntil: '2020-01-01T00:00' } });
    const future = await createEvent();
    await request(app).patch(`/api/rsvp/${future.id}`).set(admin()).send({ retentionUntil: '2040-01-01T00:00' });
    const { purged } = await purgeExpiredEvents();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await RsvpEvent.findByPk(closed.id)).toBeNull();
    expect(await RsvpEvent.findByPk(live.id)).not.toBeNull();
    expect(await RsvpEvent.findByPk(future.id)).not.toBeNull();
  });
});

describe('models', () => {
  test('RsvpEvent ↔ RsvpResponse associations resolve', async () => {
    const ev = await publishedEvent();
    await respond(ev.slug, answersFor('assoc@x.com'));
    const loaded = await RsvpEvent.findByPk(ev.id, { include: [{ association: 'responses' }, { association: 'creator' }] });
    expect(loaded.responses).toHaveLength(1);
    expect(loaded.creator.role).toBe('admin');
  });
});
