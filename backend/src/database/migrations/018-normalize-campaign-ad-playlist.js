/**
 * Normalize campaign ad_playlist JSON array into a proper campaign_media_items table.
 *
 * Strategy: single migration that creates the table, migrates data, then drops the
 * JSON column.  Service layer does dual-write (table + virtual getter) so the API
 * response shape stays backward-compatible for frontend callers.
 */
export async function up(queryInterface, Sequelize) {
  // 1. Create the normalized table
  await queryInterface.createTable('campaign_media_items', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    campaignId: {
      type: Sequelize.DataTypes.UUID,
      allowNull: false,
      references: { model: 'campaigns', key: 'id' },
      onDelete: 'CASCADE'
    },
    mediaType: { type: Sequelize.DataTypes.STRING(20), allowNull: false },
    url: { type: Sequelize.DataTypes.TEXT, allowNull: false },
    durationSecs: { type: Sequelize.DataTypes.INTEGER },
    sortOrder: { type: Sequelize.DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  }).catch(() => {});

  // 2. Add index on campaignId for fast lookups
  await queryInterface.addIndex('campaign_media_items', ['campaignId'], {
    name: 'idx_cmi_campaign'
  }).catch(() => {});

  // 3. Migrate existing JSON data into the new table
  //    - Handles NULL, empty arrays, missing url, and 'null' string gracefully
  //    - Duration: stored in JSON as milliseconds or seconds (varies); normalize to seconds
  //    - WITH ORDINALITY preserves original array order -> sortOrder
  await queryInterface.sequelize.query(`
    INSERT INTO campaign_media_items (id, "campaignId", "mediaType", url, "durationSecs", "sortOrder", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid(),
      c.id,
      COALESCE(elem->>'type', 'video'),
      elem->>'url',
      CASE
        WHEN elem->>'duration' IS NULL THEN NULL
        WHEN NOT (elem->>'duration' ~ '^[0-9]+$') THEN NULL
        WHEN (elem->>'duration')::bigint > 1000 THEN ((elem->>'duration')::bigint / 1000)::integer
        ELSE (elem->>'duration')::integer
      END,
      (row_number() OVER (PARTITION BY c.id ORDER BY ordinality)) - 1,
      NOW(), NOW()
    FROM campaigns c,
         jsonb_array_elements(c.ad_playlist::jsonb) WITH ORDINALITY AS t(elem, ordinality)
    WHERE c.ad_playlist IS NOT NULL
      AND c.ad_playlist::text != '[]'
      AND c.ad_playlist::text != 'null'
      AND elem->>'url' IS NOT NULL
      AND elem->>'url' != ''
    ON CONFLICT DO NOTHING
  `).catch((err) => {
    // May fail if ad_playlist column is already dropped or data is malformed
    console.warn('[Migration 018] Data migration warning:', err.message);
  });

  // 4. Drop the old JSON column
  await queryInterface.removeColumn('campaigns', 'ad_playlist').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  // Re-add the JSON column
  await queryInterface.addColumn('campaigns', 'ad_playlist', {
    type: Sequelize.DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  }).catch(() => {});

  // Migrate data back from table to JSON column
  await queryInterface.sequelize.query(`
    UPDATE campaigns SET ad_playlist = (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', cmi.id,
          'type', cmi."mediaType",
          'url', cmi.url,
          'duration', cmi."durationSecs"
        ) ORDER BY cmi."sortOrder"
      ), '[]'::jsonb)
      FROM campaign_media_items cmi
      WHERE cmi."campaignId" = campaigns.id
    )
  `).catch(() => {});

  await queryInterface.dropTable('campaign_media_items').catch(() => {});
}
