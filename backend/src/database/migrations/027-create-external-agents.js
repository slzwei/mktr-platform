/**
 * Migration 027 — create external_agents.
 *
 * External (rival-firm) insurance agents who BUY leads via the MKTR Leads app.
 * Kept in a dedicated table — NOT in `users` — so the Lyfe agent-sync loop
 * (agentSyncService, which deactivates/deletes any role='agent' row missing
 * upstream) can never see, adopt, or delete them. This is the structural half
 * of the MKTR Leads isolation guarantee. `id` is the stable MKTR-side identity
 * mirrored into the MKTR Leads Supabase project as `agents.mktr_user_id`.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('external_agents', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    phone: { type: Sequelize.DataTypes.STRING, allowNull: false, unique: true }, // canonical SG: 65XXXXXXXX
    email: { type: Sequelize.DataTypes.STRING, allowNull: true },
    fullName: { type: Sequelize.DataTypes.STRING, allowNull: true },
    agency: { type: Sequelize.DataTypes.STRING, allowNull: true },
    isActive: { type: Sequelize.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  }).catch(() => {});

  await queryInterface.addIndex('external_agents', ['isActive'], { name: 'idx_external_agents_active' }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.dropTable('external_agents').catch(() => {});
}
