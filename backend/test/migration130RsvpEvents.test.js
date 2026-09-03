/**
 * 130 on real Postgres: the invariants the DATABASE owns (docs/plans/rsvp-pages.md
 * §3). Self-contained replay (down → up) then every CHECK, the unique
 * (event, emailNormalized) index, the creator RESTRICT and the response CASCADE
 * are exercised with raw SQL — the paths a future import or ops script would
 * take around the service.
 */
import { getApp, closeDb, createTestUser } from './helpers.js';
import { Sequelize } from 'sequelize';
import { sequelize } from '../src/models/index.js';
import { up, down } from '../src/database/migrations/130-rsvp-events.js';

let admin;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
});

afterAll(async () => {
  await closeDb();
});

const qi = () => sequelize.getQueryInterface();

// A unique-index violation surfaces as SequelizeUniqueConstraintError whose
// MESSAGE is the generic "Validation error" — the index name rides on the pg
// error underneath, so that is what we pin.
const expectUnique = (promise, constraint) =>
  expect(promise).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError', original: { constraint } });

async function insertEvent(over = {}) {
  const [rows] = await sequelize.query(
    `INSERT INTO rsvp_events (slug, title, status, layout, capacity, "consentVersion", "createdBy", "createdAt", "updatedAt")
     VALUES (:slug, 'Mig 130', :status, :layout::jsonb, :capacity, 'v', :uid, NOW(), NOW()) RETURNING id`,
    { replacements: { slug: over.slug ?? null, status: over.status ?? 'draft', layout: over.layout ?? '{}', capacity: over.capacity ?? null, uid: admin.user.id } }
  );
  return rows[0].id;
}

async function insertResponse(eventId, over = {}) {
  const [rows] = await sequelize.query(
    `INSERT INTO rsvp_responses ("rsvpEventId", name, email, "emailNormalized", answers, status, "consentVersion", "consentCopyHash", "createdAt", "updatedAt")
     VALUES (:eventId, 'A', :email, :norm, :answers::jsonb, :status, 'v', 'h', NOW(), NOW()) RETURNING id`,
    { replacements: { eventId, email: over.email ?? 'A@x.com', norm: over.norm ?? 'a@x.com', answers: over.answers ?? '{}', status: over.status ?? 'going' } }
  );
  return rows[0].id;
}

test('replays cleanly, then the database refuses every invalid shape', async () => {
  await down(qi());
  await up(qi(), Sequelize);

  const eventId = await insertEvent({ slug: 'mig-130' });

  await expect(insertEvent({ status: 'archived' })).rejects.toThrow(/chk_rsvp_events_status/);
  await expect(insertEvent({ capacity: 0 })).rejects.toThrow(/chk_rsvp_events_capacity/);
  await expect(insertEvent({ layout: '[]' })).rejects.toThrow(/chk_rsvp_events_layout_object/);
  await expectUnique(insertEvent({ slug: 'mig-130' }), 'uq_rsvp_events_slug');
  // Several drafts may sit without a slug.
  await insertEvent({ slug: null });
  await insertEvent({ slug: null });

  await insertResponse(eventId);
  await expectUnique(insertResponse(eventId, { email: 'a@x.com', norm: 'a@x.com' }), 'uq_rsvp_responses_event_email');
  await expect(insertResponse(eventId, { email: 'B@x.com', norm: 'B@x.com' })).rejects.toThrow(/chk_rsvp_responses_email_norm/);
  await expect(insertResponse(eventId, { email: 'c@x.com', norm: ' c@x.com' })).rejects.toThrow(/chk_rsvp_responses_email_norm/);
  await expect(insertResponse(eventId, { email: 'd@x.com', norm: '' })).rejects.toThrow(/chk_rsvp_responses_email_norm/);
  await expect(insertResponse(eventId, { email: 'e@x.com', norm: 'e@x.com', status: 'maybe' })).rejects.toThrow(/chk_rsvp_responses_status/);
  await expect(insertResponse(eventId, { email: 'f@x.com', norm: 'f@x.com', answers: '"str"' })).rejects.toThrow(/chk_rsvp_responses_answers_object/);
  await expect(insertResponse('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/foreign key/i);

  // The creator cannot be deleted from under an event (RESTRICT)…
  await expect(sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: admin.user.id } })).rejects.toThrow(/foreign key/i);

  // …and responses die with their event (CASCADE) — the purge path's contract.
  await insertResponse(eventId, { email: 'g@x.com', norm: 'g@x.com' });
  const [[before]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM rsvp_responses WHERE "rsvpEventId" = :id', { replacements: { id: eventId } });
  expect(before.n).toBe(2);
  await sequelize.query('DELETE FROM rsvp_events WHERE id = :id', { replacements: { id: eventId } });
  const [[after]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM rsvp_responses WHERE "rsvpEventId" = :id', { replacements: { id: eventId } });
  expect(after.n).toBe(0);

  // Timestamps carry defaults (prod and test agree) — a raw write that omits them still lands.
  const [rows] = await sequelize.query(
    `INSERT INTO rsvp_events (title, layout, "consentVersion", "createdBy") VALUES ('defaults', '{}'::jsonb, 'v', :uid) RETURNING "createdAt", status`,
    { replacements: { uid: admin.user.id } }
  );
  expect(rows[0].createdAt).toBeInstanceOf(Date);
  expect(rows[0].status).toBe('draft');

  // Idempotent replay.
  await down(qi());
  await up(qi(), Sequelize);
});
