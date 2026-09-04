/**
 * 132 on real Postgres: the notification recipients are a COLUMN, not a corner
 * of `layout` — the layout is served to every visitor, so addresses there would
 * be public. Replay down → up, then prove the default and the round-trip.
 */
import { getApp, closeDb, createTestUser } from './helpers.js';
import { Sequelize } from 'sequelize';
import { sequelize } from '../src/models/index.js';
import { up, down } from '../src/database/migrations/132-rsvp-notify-emails.js';

let admin;

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
});

afterAll(async () => {
  await closeDb();
});

const qi = () => sequelize.getQueryInterface();

const insert = async (slug) => {
  const [rows] = await sequelize.query(
    `INSERT INTO rsvp_events (id, slug, title, "organiserName", status, layout, "consentVersion", "createdBy", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), :slug, 'T', 'Org', 'draft', '{}'::jsonb, 'v1', :uid, NOW(), NOW())
     RETURNING id, "notifyEmails"`,
    { replacements: { slug, uid: admin.user.id } },
  );
  return rows[0];
};

describe('migration 132 — rsvp_events.notifyEmails', () => {
  test('replays cleanly and every existing row lands on an empty list', async () => {
    await down(qi());
    const [before] = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'rsvp_events' AND column_name = 'notifyEmails'`,
    );
    expect(before).toHaveLength(0);

    await up(qi(), Sequelize);
    const row = await insert(`m132-${Date.now()}`);
    expect(row.notifyEmails).toEqual([]);
  });

  test('stores a list and refuses NULL', async () => {
    const row = await insert(`m132b-${Date.now()}`);
    await sequelize.query(
      `UPDATE rsvp_events SET "notifyEmails" = :emails::jsonb WHERE id = :id`,
      { replacements: { emails: JSON.stringify(['a@x.com', 'b@x.com']), id: row.id } },
    );
    const [read] = await sequelize.query(`SELECT "notifyEmails" FROM rsvp_events WHERE id = :id`, { replacements: { id: row.id } });
    expect(read[0].notifyEmails).toEqual(['a@x.com', 'b@x.com']);

    await expect(
      sequelize.query(`UPDATE rsvp_events SET "notifyEmails" = NULL WHERE id = :id`, { replacements: { id: row.id } }),
    ).rejects.toThrow();
  });
});
