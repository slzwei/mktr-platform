/**
 * Migration 033 — create waitlist_signups.
 *
 * Pre-launch "register interest" captures from the public mktr.sg homepage.
 * Standalone table so the waitlist never touches `users` / `prospects` / the
 * lead pipeline. `email` is unique + normalized (lowercase) so repeat signups
 * are idempotent. Persistence here is the source of truth for "you're on the
 * list" — the admin notification email is a non-authoritative side effect.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('waitlist_signups', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    email: { type: Sequelize.DataTypes.STRING, allowNull: false, unique: true }, // normalized lowercase
    name: { type: Sequelize.DataTypes.STRING, allowNull: true },
    phone: { type: Sequelize.DataTypes.STRING, allowNull: true },
    source: { type: Sequelize.DataTypes.STRING, allowNull: true },
    ipAddress: { type: Sequelize.DataTypes.STRING, allowNull: true },
    userAgent: { type: Sequelize.DataTypes.TEXT, allowNull: true },
    notifiedAt: { type: Sequelize.DataTypes.DATE, allowNull: true },
    createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  }).catch(() => {});

  await queryInterface.addIndex('waitlist_signups', ['createdAt'], { name: 'idx_waitlist_signups_created' }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.dropTable('waitlist_signups').catch(() => {});
}
