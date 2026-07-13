/**
 * Add the first-class Guided Review campaign format.
 *
 * Guided Review campaigns use the normal lead pipeline, but receive a dedicated
 * long-form editor and qualification flow in the web app. PostgreSQL enum values
 * cannot be removed safely in-place, so the down migration is intentionally a no-op.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_campaigns_type" ADD VALUE IF NOT EXISTS 'guided_review'`
  );
}

export async function down() {
  // PostgreSQL cannot remove an enum value without recreating the enum type.
}
