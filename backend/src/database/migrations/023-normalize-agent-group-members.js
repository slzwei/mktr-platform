export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('agent_group_members', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    agentGroupId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'agent_groups', key: 'id' }, onDelete: 'CASCADE' },
    userId: { type: Sequelize.DataTypes.UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
    phone: { type: Sequelize.DataTypes.STRING(20), allowNull: false },
    email: { type: Sequelize.DataTypes.STRING(255) },
    name: { type: Sequelize.DataTypes.STRING(100) },
    lyfeId: { type: Sequelize.DataTypes.STRING(100) },
    sortOrder: { type: Sequelize.DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  }).catch(() => {});

  // Indexes
  await queryInterface.addIndex('agent_group_members', ['agentGroupId'], { name: 'idx_agm_group' }).catch(() => {});
  await queryInterface.addIndex('agent_group_members', ['userId'], { name: 'idx_agm_user' }).catch(() => {});
  await queryInterface.addIndex('agent_group_members', ['phone'], { name: 'idx_agm_phone' }).catch(() => {});
  await queryInterface.addIndex('agent_group_members', ['agentGroupId', 'phone'], { unique: true, name: 'idx_agm_unique' }).catch(() => {});

  // Data migration from AgentGroup.agents JSON
  await queryInterface.sequelize.query(`
    INSERT INTO agent_group_members (id, "agentGroupId", phone, email, name, "lyfeId", "sortOrder", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid(),
      ag.id,
      elem->>'phone',
      elem->>'email',
      elem->>'name',
      elem->>'lyfeId',
      (row_number() OVER (PARTITION BY ag.id)) - 1,
      NOW(), NOW()
    FROM agent_groups ag, jsonb_array_elements(ag.agents::jsonb) elem
    WHERE ag.agents IS NOT NULL
      AND ag.agents::text != '[]'
      AND elem->>'phone' IS NOT NULL
      AND elem->>'phone' != ''
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  // Try to resolve userId from users table by phone match
  await queryInterface.sequelize.query(`
    UPDATE agent_group_members agm
    SET "userId" = u.id
    FROM users u
    WHERE u.phone = agm.phone
      AND u.role = 'agent'
      AND u."isActive" = true
      AND agm."userId" IS NULL
  `).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.dropTable('agent_group_members').catch(() => {});
}
