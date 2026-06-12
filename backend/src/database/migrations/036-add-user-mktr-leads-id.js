/**
 * Add users.mktrLeadsId — provenance marker for agents mirrored from the
 * mktr-leads app (a second agent source alongside Lyfe). Stores the mktr-leads
 * `agents.mktr_user_id` (the key its receiver matches on).
 *
 * Mirrors the lyfeId pattern (nullable, unique). A CHECK enforces ONE external
 * provenance per user — lyfeId and mktrLeadsId are mutually exclusive — so the
 * two source syncs can never corrupt each other into an ambiguous dual-source
 * row. Additive + nullable → safe rollback.
 *
 * IMPORTANT: deploy the code that reads/writes mktrLeadsId (destination routing +
 * the mktr-leads adapter) alongside/after this migration. Old code ignores it.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface
    .addColumn('users', 'mktrLeadsId', {
      type: Sequelize.DataTypes.STRING,
      allowNull: true,
    })
    .catch(() => {});

  // Partial unique index — many NULLs allowed; each mktr-leads agent id unique.
  await queryInterface
    .addIndex('users', ['mktrLeadsId'], {
      name: 'users_mktr_leads_id_uniq',
      unique: true,
      where: { mktrLeadsId: { [Sequelize.Op.ne]: null } },
    })
    .catch(() => {});

  // One external provenance per user: lyfeId XOR mktrLeadsId (both-null allowed
  // for local-only users like the System Agent).
  await queryInterface.sequelize
    .query(
      'ALTER TABLE "users" ADD CONSTRAINT "users_single_provenance_chk" CHECK ("lyfeId" IS NULL OR "mktrLeadsId" IS NULL)'
    )
    .catch((err) => {
      console.warn('[migration 036] could not add users_single_provenance_chk:', err?.message);
    });
}

export async function down(queryInterface) {
  await queryInterface.sequelize
    .query('ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_single_provenance_chk"')
    .catch(() => {});
  await queryInterface.removeIndex('users', 'users_mktr_leads_id_uniq').catch(() => {});
  await queryInterface.removeColumn('users', 'mktrLeadsId').catch(() => {});
}
