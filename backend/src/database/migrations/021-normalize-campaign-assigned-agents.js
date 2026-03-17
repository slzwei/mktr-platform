export async function up(queryInterface, Sequelize) {
  // 1. Create campaign_agent_assignments join table
  await queryInterface.createTable('campaign_agent_assignments', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
    campaignId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
    agentId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
    assignedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  }).catch(() => {});

  // 2. Add indexes
  await queryInterface.addIndex('campaign_agent_assignments', ['campaignId'], { name: 'idx_caa_campaign' }).catch(() => {});
  await queryInterface.addIndex('campaign_agent_assignments', ['agentId'], { name: 'idx_caa_agent' }).catch(() => {});
  await queryInterface.addIndex('campaign_agent_assignments', ['campaignId', 'agentId'], { unique: true, name: 'idx_caa_unique' }).catch(() => {});

  // 3. Data migration: copy from JSON column to join table.
  //    assigned_agents can contain either plain UUID strings or objects like { id, name, ... }.
  //    We handle both shapes: extract the UUID with COALESCE(elem->>'id', elem#>>'{}').
  //    - For a JSON string element: elem#>>'{}' returns the raw string value (the UUID).
  //    - For a JSON object element: elem->>'id' returns the 'id' field.
  await queryInterface.sequelize.query(`
    INSERT INTO campaign_agent_assignments ("id", "campaignId", "agentId", "assignedAt")
    SELECT
      gen_random_uuid(),
      c.id,
      COALESCE(elem->>'id', elem#>>'{}')::uuid,
      NOW()
    FROM campaigns c,
         jsonb_array_elements(c.assigned_agents::jsonb) elem
    WHERE c.assigned_agents IS NOT NULL
      AND c.assigned_agents::text != '[]'
      AND c.assigned_agents::text != 'null'
      AND COALESCE(elem->>'id', elem#>>'{}') IS NOT NULL
      AND COALESCE(elem->>'id', elem#>>'{}') != ''
      AND COALESCE(elem->>'id', elem#>>'{}') != 'null'
    ON CONFLICT DO NOTHING
  `).catch((err) => {
    console.warn('Data migration (assigned_agents → join table) skipped or partial:', err.message);
  });

  // 4. Drop the old JSON column
  await queryInterface.removeColumn('campaigns', 'assigned_agents').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  // Restore the JSON column
  await queryInterface.addColumn('campaigns', 'assigned_agents', {
    type: Sequelize.DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  }).catch(() => {});

  // Back-fill JSON from join table
  await queryInterface.sequelize.query(`
    UPDATE campaigns c
    SET assigned_agents = (
      SELECT COALESCE(jsonb_agg(caa."agentId"), '[]'::jsonb)
      FROM campaign_agent_assignments caa
      WHERE caa."campaignId" = c.id
    )
  `).catch(() => {});

  // Drop join table
  await queryInterface.dropTable('campaign_agent_assignments').catch(() => {});
}
