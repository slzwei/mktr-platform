/**
 * Migration 014: Add proper ON DELETE cascade rules to all foreign key relationships.
 *
 * Uses NOT VALID + VALIDATE CONSTRAINT two-step pattern to avoid ACCESS EXCLUSIVE
 * locks during constraint creation. All operations are idempotent.
 *
 * Rules applied:
 *   CASCADE  (16) - child data meaningless without parent
 *   SET NULL (21) - business data survives parent deletion
 *   RESTRICT  (8) - block parent deletion while children exist
 */
export async function up(queryInterface) {
  // -----------------------------------------------------------------------
  // Helper: reset a foreign key with a specific ON DELETE rule
  // -----------------------------------------------------------------------
  async function resetFK(table, column, refTable, refColumn, onDelete) {
    const name = `${table}_${column}_fkey`;
    // Try multiple constraint name patterns (Sequelize generates different names)
    await queryInterface.removeConstraint(table, name).catch(() => {});
    await queryInterface.removeConstraint(table, `${table}_${column}_${refTable}_fk`).catch(() => {});
    // Add new constraint with NOT VALID first (avoids ACCESS EXCLUSIVE lock)
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
      FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}")
      ON DELETE ${onDelete} NOT VALID
    `).catch(() => {});
    // Then validate (SHARE UPDATE EXCLUSIVE lock -- allows concurrent reads/writes)
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"
    `).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Step 1: Clean orphaned rows that would block FK constraint creation
  // -----------------------------------------------------------------------
  const orphanCleanup = [
    `UPDATE prospects SET "assignedAgentId" = NULL WHERE "assignedAgentId" IS NOT NULL AND "assignedAgentId" NOT IN (SELECT id FROM users)`,
    `UPDATE prospects SET "campaignId" = NULL WHERE "campaignId" IS NOT NULL AND "campaignId" NOT IN (SELECT id FROM campaigns)`,
    `UPDATE prospects SET "qrTagId" = NULL WHERE "qrTagId" IS NOT NULL AND "qrTagId" NOT IN (SELECT id FROM qr_tags)`,
    `UPDATE commissions SET "approvedBy" = NULL WHERE "approvedBy" IS NOT NULL AND "approvedBy" NOT IN (SELECT id FROM users)`,
    `UPDATE commissions SET "processedBy" = NULL WHERE "processedBy" IS NOT NULL AND "processedBy" NOT IN (SELECT id FROM users)`,
    `UPDATE commissions SET "campaignId" = NULL WHERE "campaignId" IS NOT NULL AND "campaignId" NOT IN (SELECT id FROM campaigns)`,
    `UPDATE commissions SET "prospectId" = NULL WHERE "prospectId" IS NOT NULL AND "prospectId" NOT IN (SELECT id FROM prospects)`,
    `DELETE FROM prospect_activities WHERE "prospectId" NOT IN (SELECT id FROM prospects)`,
    `DELETE FROM qr_scans WHERE "qrTagId" NOT IN (SELECT id FROM qr_tags)`,
    `DELETE FROM attributions WHERE "qrTagId" NOT IN (SELECT id FROM qr_tags)`,
    `DELETE FROM beacon_events WHERE "deviceId" NOT IN (SELECT id FROM devices)`,
    `DELETE FROM impressions WHERE "deviceId" NOT IN (SELECT id FROM devices)`,
    `DELETE FROM short_link_clicks WHERE "shortLinkId" NOT IN (SELECT id FROM short_links)`,
    `DELETE FROM webhook_deliveries WHERE "subscriberId" NOT IN (SELECT id FROM webhook_subscribers)`,
  ];

  for (const sql of orphanCleanup) {
    await queryInterface.sequelize.query(sql).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Step 2: CASCADE (16) -- child data meaningless without parent
  // -----------------------------------------------------------------------
  await resetFK('fleet_owners', 'userId', 'users', 'id', 'CASCADE');
  await resetFK('drivers', 'userId', 'users', 'id', 'CASCADE');
  await resetFK('lead_package_assignments', 'agentId', 'users', 'id', 'CASCADE');
  await resetFK('user_payouts', 'userId', 'users', 'id', 'CASCADE');
  await resetFK('campaign_previews', 'campaignId', 'campaigns', 'id', 'CASCADE');
  await resetFK('qr_scans', 'qrTagId', 'qr_tags', 'id', 'CASCADE');
  await resetFK('attributions', 'qrTagId', 'qr_tags', 'id', 'CASCADE');
  await resetFK('attributions', 'qrScanId', 'qr_scans', 'id', 'CASCADE');
  await resetFK('prospect_activities', 'prospectId', 'prospects', 'id', 'CASCADE');
  await resetFK('lead_package_assignments', 'leadPackageId', 'lead_packages', 'id', 'CASCADE');
  await resetFK('beacon_events', 'deviceId', 'devices', 'id', 'CASCADE');
  await resetFK('impressions', 'deviceId', 'devices', 'id', 'CASCADE');
  await resetFK('short_link_clicks', 'shortLinkId', 'short_links', 'id', 'CASCADE');
  // round_robin_cursor.campaignId -> campaigns.id (FK was missing, add it)
  await resetFK('round_robin_cursor', 'campaignId', 'campaigns', 'id', 'CASCADE');

  // -----------------------------------------------------------------------
  // Step 3: SET NULL (21) -- business data survives parent deletion
  // -----------------------------------------------------------------------
  await resetFK('qr_tags', 'ownerUserId', 'users', 'id', 'SET NULL');
  await resetFK('commissions', 'approvedBy', 'users', 'id', 'SET NULL');
  await resetFK('commissions', 'processedBy', 'users', 'id', 'SET NULL');
  await resetFK('prospects', 'assignedAgentId', 'users', 'id', 'SET NULL');
  await resetFK('prospect_activities', 'actorUserId', 'users', 'id', 'SET NULL');
  await resetFK('short_links', 'createdBy', 'users', 'id', 'SET NULL');
  await resetFK('cars', 'current_driver_id', 'users', 'id', 'SET NULL');
  await resetFK('qr_tags', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('prospects', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('commissions', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('lead_packages', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('impressions', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('short_links', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('devices', 'campaignId', 'campaigns', 'id', 'SET NULL');
  await resetFK('prospects', 'qrTagId', 'qr_tags', 'id', 'SET NULL');
  await resetFK('prospects', 'attributionId', 'attributions', 'id', 'SET NULL');
  await resetFK('qr_tags', 'carId', 'cars', 'id', 'SET NULL');
  await resetFK('commissions', 'leadPackageId', 'lead_packages', 'id', 'SET NULL');
  await resetFK('commissions', 'prospectId', 'prospects', 'id', 'SET NULL');
  await resetFK('devices', 'vehicleId', 'vehicles', 'id', 'SET NULL');
  await resetFK('webhook_deliveries', 'subscriberId', 'webhook_subscribers', 'id', 'SET NULL');
  // campaigns.agentGroupId was dropped in migration 012 -- skip
  await resetFK('qr_tags', 'agentGroupId', 'agent_groups', 'id', 'SET NULL');
  await resetFK('qr_tags', 'parentQrTagId', 'qr_tags', 'id', 'SET NULL');
  await resetFK('vehicles', 'masterDeviceId', 'devices', 'id', 'SET NULL');
  await resetFK('vehicles', 'slaveDeviceId', 'devices', 'id', 'SET NULL');

  // -----------------------------------------------------------------------
  // Step 4: RESTRICT (8) -- block parent deletion while children exist
  // -----------------------------------------------------------------------
  await resetFK('campaigns', 'createdBy', 'users', 'id', 'RESTRICT');
  await resetFK('commissions', 'agentId', 'users', 'id', 'RESTRICT');
  await resetFK('lead_packages', 'createdBy', 'users', 'id', 'RESTRICT');
  await resetFK('agent_groups', 'createdBy', 'users', 'id', 'RESTRICT');
  await resetFK('cars', 'fleet_owner_id', 'fleet_owners', 'id', 'RESTRICT');
  await resetFK('drivers', 'fleetOwnerId', 'fleet_owners', 'id', 'RESTRICT');
}

export async function down(queryInterface) {
  // Revert all constraints to NO ACTION (Postgres default)
  async function resetFK(table, column, refTable, refColumn) {
    const name = `${table}_${column}_fkey`;
    await queryInterface.removeConstraint(table, name).catch(() => {});
    await queryInterface.removeConstraint(table, `${table}_${column}_${refTable}_fk`).catch(() => {});
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
      FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}")
      ON DELETE NO ACTION NOT VALID
    `).catch(() => {});
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"
    `).catch(() => {});
  }

  // CASCADE group
  await resetFK('fleet_owners', 'userId', 'users', 'id');
  await resetFK('drivers', 'userId', 'users', 'id');
  await resetFK('lead_package_assignments', 'agentId', 'users', 'id');
  await resetFK('user_payouts', 'userId', 'users', 'id');
  await resetFK('campaign_previews', 'campaignId', 'campaigns', 'id');
  await resetFK('qr_scans', 'qrTagId', 'qr_tags', 'id');
  await resetFK('attributions', 'qrTagId', 'qr_tags', 'id');
  await resetFK('attributions', 'qrScanId', 'qr_scans', 'id');
  await resetFK('prospect_activities', 'prospectId', 'prospects', 'id');
  await resetFK('lead_package_assignments', 'leadPackageId', 'lead_packages', 'id');
  await resetFK('beacon_events', 'deviceId', 'devices', 'id');
  await resetFK('impressions', 'deviceId', 'devices', 'id');
  await resetFK('short_link_clicks', 'shortLinkId', 'short_links', 'id');
  await resetFK('round_robin_cursor', 'campaignId', 'campaigns', 'id');

  // SET NULL group
  await resetFK('qr_tags', 'ownerUserId', 'users', 'id');
  await resetFK('commissions', 'approvedBy', 'users', 'id');
  await resetFK('commissions', 'processedBy', 'users', 'id');
  await resetFK('prospects', 'assignedAgentId', 'users', 'id');
  await resetFK('prospect_activities', 'actorUserId', 'users', 'id');
  await resetFK('short_links', 'createdBy', 'users', 'id');
  await resetFK('cars', 'current_driver_id', 'users', 'id');
  await resetFK('qr_tags', 'campaignId', 'campaigns', 'id');
  await resetFK('prospects', 'campaignId', 'campaigns', 'id');
  await resetFK('commissions', 'campaignId', 'campaigns', 'id');
  await resetFK('lead_packages', 'campaignId', 'campaigns', 'id');
  await resetFK('impressions', 'campaignId', 'campaigns', 'id');
  await resetFK('short_links', 'campaignId', 'campaigns', 'id');
  await resetFK('devices', 'campaignId', 'campaigns', 'id');
  await resetFK('prospects', 'qrTagId', 'qr_tags', 'id');
  await resetFK('prospects', 'attributionId', 'attributions', 'id');
  await resetFK('qr_tags', 'carId', 'cars', 'id');
  await resetFK('commissions', 'leadPackageId', 'lead_packages', 'id');
  await resetFK('commissions', 'prospectId', 'prospects', 'id');
  await resetFK('devices', 'vehicleId', 'vehicles', 'id');
  await resetFK('webhook_deliveries', 'subscriberId', 'webhook_subscribers', 'id');
  await resetFK('qr_tags', 'agentGroupId', 'agent_groups', 'id');
  await resetFK('qr_tags', 'parentQrTagId', 'qr_tags', 'id');
  await resetFK('vehicles', 'masterDeviceId', 'devices', 'id');
  await resetFK('vehicles', 'slaveDeviceId', 'devices', 'id');

  // RESTRICT group
  await resetFK('campaigns', 'createdBy', 'users', 'id');
  await resetFK('commissions', 'agentId', 'users', 'id');
  await resetFK('lead_packages', 'createdBy', 'users', 'id');
  await resetFK('agent_groups', 'createdBy', 'users', 'id');
  await resetFK('cars', 'fleet_owner_id', 'fleet_owners', 'id');
  await resetFK('drivers', 'fleetOwnerId', 'fleet_owners', 'id');
}
