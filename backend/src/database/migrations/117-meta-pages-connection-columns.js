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
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_meta_pages_connection');
  await queryInterface.sequelize.query('ALTER TABLE meta_pages DROP COLUMN IF EXISTS "connectedVia"');
  await queryInterface.sequelize.query('ALTER TABLE meta_pages DROP COLUMN IF EXISTS "connectionId"');
  // Rows with a wiped token cannot re-acquire NOT NULL — leave nullability in
  // place on down (compatible with pre-117 code, which never reads NULL rows
  // because inactive pages are DENY).
}
