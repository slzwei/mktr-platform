/**
 * Migration 028 — add prospects.externalAgentId (+ single-assignee guard).
 *
 * A prospect is assigned to EITHER an internal Lyfe agent (`assignedAgentId`
 * -> users) OR an external buyer (`externalAgentId` -> external_agents), never
 * both. The CHECK enforces at-most-one — both NULL is allowed pre-assignment
 * or while quarantined. Which column is set is also the webhook DESTINATION
 * signal: externalAgentId set -> MKTR Leads subscriber; assignedAgentId set ->
 * Lyfe subscriber (Phase 0.5).
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('prospects', 'externalAgentId', {
    type: Sequelize.DataTypes.UUID,
    allowNull: true,
    references: { model: 'external_agents', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  }).catch(() => {});

  await queryInterface.addIndex('prospects', ['externalAgentId'], { name: 'idx_prospects_external_agent' }).catch(() => {});

  // Single-assignee guard. Drop-then-add keeps the migration idempotent without
  // swallowing a genuine failure to create the constraint.
  await queryInterface.sequelize.query(
    'ALTER TABLE prospects DROP CONSTRAINT IF EXISTS chk_prospect_single_assignee'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE prospects ADD CONSTRAINT chk_prospect_single_assignee ' +
      'CHECK (NOT ("assignedAgentId" IS NOT NULL AND "externalAgentId" IS NOT NULL))'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE prospects DROP CONSTRAINT IF EXISTS chk_prospect_single_assignee'
  );
  await queryInterface.removeColumn('prospects', 'externalAgentId').catch(() => {});
}
