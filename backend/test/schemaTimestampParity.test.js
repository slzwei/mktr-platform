/**
 * P2-18 regression: the model-built schema agrees with prod on timestamps.
 *
 * Test boot runs sync({force:true}) from the MODELS and only THEN replays
 * migrations, so a table's shape in test comes from its model. Sequelize emits
 * implicit createdAt/updatedAt as NOT NULL with NO database default (it fills
 * them in the ORM), while the migrations that created these tables declare
 * DEFAULT NOW(). The two schemas therefore disagree, and the disagreement is
 * invisible until someone writes a raw INSERT: it succeeds in prod and dies in
 * every test — on `payments`, the most financially consequential table here.
 *
 * Nothing trips it today (no raw INSERT omits the timestamps), so this is a
 * trap being closed, not an outage being fixed. These assert the parity
 * directly against the live test schema.
 */
import { sequelize } from '../src/models/index.js';
import { getApp, closeDb } from './helpers.js';

/** Every table whose migration declares DEFAULT NOW() on its timestamps. */
const TABLES = [
  'payments',
  'agent_group_members',
  'external_agents',
  'external_campaign_agents',
  'waitlist_signups',
];

const defaultsFor = async (table) => {
  const [rows] = await sequelize.query(
    `SELECT column_name, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_name = :table AND column_name IN ('createdAt', 'updatedAt')`,
    { replacements: { table } }
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r]));
};

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeDb(); });

describe('timestamp defaults match the production schema', () => {
  it.each(TABLES)('%s carries a DB-level default on both timestamps', async (table) => {
    const cols = await defaultsFor(table);

    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
    // The point: a default EXISTS, so the column does not depend on the ORM.
    expect(cols.createdAt.column_default).not.toBeNull();
    expect(cols.updatedAt.column_default).not.toBeNull();
    expect(cols.createdAt.is_nullable).toBe('NO');
    expect(cols.updatedAt.is_nullable).toBe('NO');
  });
});

describe('a raw INSERT that omits the timestamps succeeds', () => {
  it('inserts a payment without naming createdAt/updatedAt', async () => {
    // The exact shape that passed in prod and died in test.
    const [rows] = await sequelize.query(
      `INSERT INTO payments (id, amount, "leadCount", currency, status, source)
       VALUES (gen_random_uuid(), 15.00, 1, 'SGD', 'pending', 'web')
       RETURNING id, "createdAt", "updatedAt"`
    );

    const row = rows[0];
    expect(row.createdAt).not.toBeNull();
    expect(row.updatedAt).not.toBeNull();

    await sequelize.query('DELETE FROM payments WHERE id = :id', { replacements: { id: row.id } });
  });

  it('inserts a waitlist signup without naming them either', async () => {
    const [rows] = await sequelize.query(
      `INSERT INTO waitlist_signups (id, email)
       VALUES (gen_random_uuid(), 'timestamp-parity@test.com')
       RETURNING id, "createdAt", "updatedAt"`
    );

    const row = rows[0];
    expect(row.createdAt).not.toBeNull();

    await sequelize.query('DELETE FROM waitlist_signups WHERE id = :id', { replacements: { id: row.id } });
  });
});
