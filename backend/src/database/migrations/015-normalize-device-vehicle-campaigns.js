export async function up(queryInterface, Sequelize) {
  // Create device_campaign_assignments join table
  await queryInterface.createTable('device_campaign_assignments', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    deviceId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'devices', key: 'id' }, onDelete: 'CASCADE' },
    campaignId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
    sortOrder: { type: Sequelize.DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    assignedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  }).catch(() => {});

  // Add indexes
  await queryInterface.addIndex('device_campaign_assignments', ['deviceId'], { name: 'idx_dca_device' }).catch(() => {});
  await queryInterface.addIndex('device_campaign_assignments', ['campaignId'], { name: 'idx_dca_campaign' }).catch(() => {});
  await queryInterface.addIndex('device_campaign_assignments', ['deviceId', 'campaignId'], { unique: true, name: 'idx_dca_unique' }).catch(() => {});

  // Create vehicle_campaign_assignments join table (same structure)
  await queryInterface.createTable('vehicle_campaign_assignments', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    vehicleId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'vehicles', key: 'id' }, onDelete: 'CASCADE' },
    campaignId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
    sortOrder: { type: Sequelize.DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    assignedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  }).catch(() => {});

  await queryInterface.addIndex('vehicle_campaign_assignments', ['vehicleId'], { name: 'idx_vca_vehicle' }).catch(() => {});
  await queryInterface.addIndex('vehicle_campaign_assignments', ['campaignId'], { name: 'idx_vca_campaign' }).catch(() => {});
  await queryInterface.addIndex('vehicle_campaign_assignments', ['vehicleId', 'campaignId'], { unique: true, name: 'idx_vca_unique' }).catch(() => {});

  // Data migration: copy from JSON arrays to join tables
  // Devices
  await queryInterface.sequelize.query(`
    INSERT INTO device_campaign_assignments ("id", "deviceId", "campaignId", "sortOrder", "assignedAt")
    SELECT gen_random_uuid(), d.id, elem::text::uuid, (row_number() OVER (PARTITION BY d.id)) - 1, NOW()
    FROM devices d, jsonb_array_elements_text(d."campaignIds"::jsonb) elem
    WHERE d."campaignIds" IS NOT NULL
      AND d."campaignIds"::text != '[]'
      AND elem::text != 'null'
      AND elem::text != ''
    ON CONFLICT DO NOTHING
  `).catch(() => {});

  // Vehicles
  await queryInterface.sequelize.query(`
    INSERT INTO vehicle_campaign_assignments ("id", "vehicleId", "campaignId", "sortOrder", "assignedAt")
    SELECT gen_random_uuid(), v.id, elem::text::uuid, (row_number() OVER (PARTITION BY v.id)) - 1, NOW()
    FROM vehicles v, jsonb_array_elements_text(v."campaignIds"::jsonb) elem
    WHERE v."campaignIds" IS NOT NULL
      AND v."campaignIds"::text != '[]'
      AND elem::text != 'null'
      AND elem::text != ''
    ON CONFLICT DO NOTHING
  `).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.dropTable('device_campaign_assignments').catch(() => {});
  await queryInterface.dropTable('vehicle_campaign_assignments').catch(() => {});
}
