/**
 * 116 — meta_agent_connections: the Connect-Facebook state machine
 * (docs/plans/facebook-connect-self-serve.md §1).
 *
 * One row per agent OAuth journey: awaiting_callback → provisioning →
 * needs_page_selection | waiting_for_agent → connected → reauth_required |
 * disconnected | failed. Ownership is the LOCAL users.id (RESTRICT — a user
 * with an active connection must disconnect first); agentMktrUserId is an
 * audit snapshot only. stateNonce is the opaque single-use OAuth state.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes('meta_agent_connections')) {
    await queryInterface.createTable('meta_agent_connections', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      agentMktrUserId: { type: Sequelize.STRING(64), allowNull: true },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'awaiting_callback' },
      statusDetail: { type: Sequelize.TEXT, allowNull: true },
      fbUserIdAppScoped: { type: Sequelize.STRING(64), allowNull: true },
      pageId: { type: Sequelize.STRING(64), allowNull: true },
      metaPageRowId: { type: Sequelize.UUID, allowNull: true },
      qrTagId: { type: Sequelize.UUID, allowNull: true },
      formId: { type: Sequelize.STRING(64), allowNull: true },
      mappingId: { type: Sequelize.UUID, allowNull: true },
      stateNonce: { type: Sequelize.STRING(64), allowNull: true },
      stateExpiresAt: { type: Sequelize.DATE, allowNull: true },
      oauthCodeEnc: { type: Sequelize.TEXT, allowNull: true },
      secretKind: { type: Sequelize.STRING(16), allowNull: true },
      deletionCode: { type: Sequelize.STRING(48), allowNull: true },
      candidatePages: { type: Sequelize.JSONB, allowNull: true },
      grantedScopes: { type: Sequelize.JSONB, allowNull: true },
      pageTasks: { type: Sequelize.JSONB, allowNull: true },
      leadsAccessOk: { type: Sequelize.BOOLEAN, allowNull: true },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: Sequelize.DATE, allowNull: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      tokenExpiresAt: { type: Sequelize.DATE, allowNull: true },
      dataAccessExpiresAt: { type: Sequelize.DATE, allowNull: true },
      lastTokenCheckAt: { type: Sequelize.DATE, allowNull: true },
      connectedAt: { type: Sequelize.DATE, allowNull: true },
      disconnectedAt: { type: Sequelize.DATE, allowNull: true },
      disconnectReason: { type: Sequelize.STRING(64), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_mac_state_nonce ON meta_agent_connections ("stateNonce") WHERE "stateNonce" IS NOT NULL');
  // 1:1 v1 — one LIVE connection per agent, one per page.
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mac_live_user ON meta_agent_connections ("userId")
             WHERE status IN ('awaiting_callback','provisioning','needs_page_selection','waiting_for_agent','connected','reauth_required')`);
  // Page reservation (review F3): the reserve happens DURING provisioning and
  // reauth keeps the page while awaiting — every live status holds the claim.
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mac_live_page ON meta_agent_connections ("pageId")
             WHERE "pageId" IS NOT NULL AND status IN ('awaiting_callback','provisioning','needs_page_selection','waiting_for_agent','connected','reauth_required')`);
  await idx('CREATE INDEX IF NOT EXISTS idx_mac_status_next ON meta_agent_connections (status, "nextAttemptAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_mac_fb_user ON meta_agent_connections ("fbUserIdAppScoped")');
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS meta_agent_connections');
}
