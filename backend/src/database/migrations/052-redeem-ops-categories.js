/**
 * 052 — Admin-managed category taxonomy (redeem_ops_categories).
 *
 * Partner/pool/reward `category` stays a STRING column (house style, constants.js),
 * but writes are now validated against this admin-curated list. Seeded from every
 * distinct value already live in the three tables so day-one behaviour is unchanged;
 * admins then rename/merge/retire from the Settings UI.
 *
 * Guarded + idempotent like 045–051; safe under NODE_ENV=test where sync() has
 * already created the table (createTable skipped, index IF NOT EXISTS, seed no-ops).
 */
export async function up(queryInterface, Sequelize) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('redeem_ops_categories')) {
    await queryInterface.createTable('redeem_ops_categories', {
      // DB-side default (unlike the app-side UUIDV4 house norm) so the seed INSERT
      // below can omit id. Precedent: migration 021. PG15 everywhere → built-in.
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
      name: { type: Sequelize.STRING(64), allowNull: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  // Case-insensitive uniqueness. Functional index, NOT a constraint — so any
  // ON CONFLICT against it must use the bare form (no ON CONSTRAINT).
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_redeem_ops_categories_name_ci
             ON redeem_ops_categories (LOWER(name))`);

  // One-time normalization: padded/blank legacy values would otherwise dodge the
  // rename/merge cascades (which match on the stored string) forever.
  for (const table of ['partner_organisations', 'prospecting_pools', 'reward_offers']) {
    await q(`UPDATE ${table}
                SET category = NULLIF(TRIM(category), '')
              WHERE category IS NOT NULL
                AND category IS DISTINCT FROM NULLIF(TRIM(category), '')`);
  }

  // Seed: one row per distinct value across the three tables; the most frequent
  // casing wins deterministically (mode() breaks ties by its ORDER BY).
  await q(`INSERT INTO redeem_ops_categories (name)
           SELECT mode() WITHIN GROUP (ORDER BY category)
             FROM (
                   SELECT category FROM partner_organisations WHERE category IS NOT NULL
                   UNION ALL
                   SELECT category FROM prospecting_pools WHERE category IS NOT NULL
                   UNION ALL
                   SELECT category FROM reward_offers WHERE category IS NOT NULL
                  ) s
            GROUP BY LOWER(category)
               ON CONFLICT DO NOTHING`);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS redeem_ops_categories');
}
