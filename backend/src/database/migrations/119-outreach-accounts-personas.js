/**
 * 119 — outreach sending identities (cadence email auto-send Phase A,
 * docs/plans/redeem-ops-cadence-email-autosend.md §3).
 *
 * `outreach_accounts`: the Google Workspace mailbox the platform impersonates
 * (business@mktr.sg today; a persona that turns out to be its own Google
 * account gets a second row — plan F2). Carries the encrypted service-account
 * key, the account-level warm-up cap (a shared-mailbox lockout bricks the
 * company inbox for 24h — plan F7), and the reply-poll health fields the
 * Phase-B sender gates on.
 *
 * `outreach_personas`: one row per sending alias (emily@redeem.sg …), tied to
 * the CRM rep it belongs to (assignedUserId UNIQUE — the who-is-who).
 * Personas without a rep, or reps without a persona, never send.
 */

export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('outreach_accounts')) {
    await queryInterface.createTable('outreach_accounts', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      provider: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'google' },
      accountEmail: { type: Sequelize.STRING(160), allowNull: false, unique: true },
      encryptedCredentials: { type: Sequelize.TEXT, allowNull: true },
      dailySendCap: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 500 },
      sentToday: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sentTodayDate: { type: Sequelize.STRING(10), allowNull: true },
      historyCursor: { type: Sequelize.STRING(32), allowNull: true },
      lastSuccessfulPollAt: { type: Sequelize.DATE, allowNull: true },
      lastHealthCheckAt: { type: Sequelize.DATE, allowNull: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  if (!tables.includes('outreach_personas')) {
    await queryInterface.createTable('outreach_personas', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      accountId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'outreach_accounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      address: { type: Sequelize.STRING(160), allowNull: false, unique: true },
      displayName: { type: Sequelize.STRING(120), allowNull: false },
      assignedUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      sendAsRegistered: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      sendAsVerified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isAccountAlias: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      dailySendCap: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      sentToday: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sentTodayDate: { type: Sequelize.STRING(10), allowNull: true },
      consecutiveFailures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    // One persona per rep — the who-is-who mapping is 1:1 while assigned.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_op_assigned_user ON outreach_personas ("assignedUserId") WHERE "assignedUserId" IS NOT NULL'
    );
  }
}

export async function down(queryInterface) {
  await queryInterface.dropTable('outreach_personas');
  await queryInterface.dropTable('outreach_accounts');
}
