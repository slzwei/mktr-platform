/**
 * 124 — admin-hideable timeline entries (display-level delete).
 *
 * The partner timeline renders five heterogeneous sources (activities, stage
 * events, assignment events, audit rows, task events). Activities already
 * soft-void; the others BACK live machinery — deleting a stage event skews
 * stageSince, deleting a task row cascades its sent-email record, deleting
 * audit rows erases the trail. So "delete" for those is a MARKER: one row
 * here hides one timeline entry, the source row stays intact. Audited, with
 * a required reason; admin tier only (partners.delete).
 */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('timeline_hidden_entries', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    partnerOrganisationId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'partner_organisations', key: 'id' },
      onDelete: 'CASCADE',
    },
    // 'stage' | 'assignment' | 'audit' | 'task'
    kind: { type: Sequelize.STRING(20), allowNull: false },
    // Source row id; task entries use `${taskId}:${event}` so hiding
    // "Task created" leaves "Task completed" visible.
    refKey: { type: Sequelize.STRING(100), allowNull: false },
    reason: { type: Sequelize.TEXT, allowNull: false },
    hiddenBy: {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
    },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_the_kind_ref ON timeline_hidden_entries (kind, "refKey")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_the_partner ON timeline_hidden_entries ("partnerOrganisationId")`
  );
}

export async function down(queryInterface) {
  await queryInterface.dropTable('timeline_hidden_entries');
}
