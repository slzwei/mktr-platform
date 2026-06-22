/**
 * Indexes for the repeat-signup admin flag (cross-campaign repeat detection).
 *
 * The flag matches a prospect against others by phone OR email across campaigns.
 * Neither lookup is well-served today:
 *   - phone lives only in the composite UNIQUE (campaignId, phone) index
 *     (migration 010); its leading column is campaignId, so it can't serve
 *     `WHERE phone = :phone` across campaigns.
 *   - email has a plain index, which can't serve `lower(trim(email))`.
 *
 * Add a standalone partial phone index + a functional lower(trim(email)) index.
 * Indexes only — no columns. Plain CREATE INDEX (not CONCURRENTLY): the prospects
 * table is tiny, the build is instant, and CONCURRENTLY can leave an invalid
 * index on failure. IF NOT EXISTS keeps it idempotent.
 */
export async function up(queryInterface) {
  const sql = queryInterface.sequelize;
  await sql
    .query(`
      CREATE INDEX IF NOT EXISTS prospects_phone_idx
        ON prospects (phone)
        WHERE phone IS NOT NULL AND phone <> ''
    `)
    .catch(() => {});
  await sql
    .query(`
      CREATE INDEX IF NOT EXISTS prospects_email_lower_idx
        ON prospects (lower(trim(email)))
        WHERE email IS NOT NULL AND email NOT LIKE '%@calls.mktr.sg'
    `)
    .catch(() => {});
}

export async function down(queryInterface) {
  const sql = queryInterface.sequelize;
  await sql.query('DROP INDEX IF EXISTS prospects_phone_idx').catch(() => {});
  await sql.query('DROP INDEX IF EXISTS prospects_email_lower_idx').catch(() => {});
}
