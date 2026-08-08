/**
 * 117 — meta_pages joins the connection lifecycle
 * (docs/plans/facebook-connect-self-serve.md §1).
 *
 * accessTokenEnc becomes NULLABLE: disconnect WIPES the sealed token while
 * the row remains as an inactive tombstone — deleting the row would re-arm
 * the single-page env fallback for that pageId, silently reviving intake.
 * connectionId links a page to the agent connection that provisioned it.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.sequelize.query(
    'ALTER TABLE meta_pages ALTER COLUMN "accessTokenEnc" DROP NOT NULL'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS "connectionId" UUID'
  );
  await queryInterface.sequelize.query(
    "ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS \"connectedVia\" VARCHAR(16)"
  );
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_meta_pages_connection ON meta_pages ("connectionId")'
  );
}

export async function down(queryInterface) {
  // Honest rollback (review F18 + round-2 NEW-5): the refusal check runs
  // BEFORE any DDL, and the whole rollback is one transaction — a refusal
  // leaves the schema untouched, never half-rolled-back.
  const [[{ count }]] = await queryInterface.sequelize.query(
    'SELECT COUNT(*)::int AS count FROM meta_pages WHERE "accessTokenEnc" IS NULL'
  );
  if (count > 0) {
    throw new Error(`117 down: ${count} meta_pages row(s) have a wiped (NULL) token — delete those tombstones first, then re-run`);
  }
  await queryInterface.sequelize.transaction(async (transaction) => {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q('DROP INDEX IF EXISTS idx_meta_pages_connection');
    await q('ALTER TABLE meta_pages DROP COLUMN IF EXISTS "connectedVia"');
    await q('ALTER TABLE meta_pages DROP COLUMN IF EXISTS "connectionId"');
    await q('ALTER TABLE meta_pages ALTER COLUMN "accessTokenEnc" SET NOT NULL');
  });
}
