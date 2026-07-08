/**
 * Redeem Ops Phase 2 — Partner CRM tables (docs/redeem-ops/ERD.md §3.1–3.6).
 * partner_organisations, partner_locations, partner_contacts,
 * partner_assignment_events, partner_stage_events, outreach_activities.
 *
 * pg_trgm is attempted for fuzzy-name duplicate detection; failure is non-fatal
 * (dedupeService falls back to prefix matching — ERD.md §5). Every step is
 * guarded so a partial re-run and NODE_ENV=test (sync-first) are both safe.
 */
export async function up(queryInterface, Sequelize) {
  // Fuzzy-match support (optional). CREATE EXTENSION needs no transaction here —
  // the runner is non-transactional. Requires the DB role to allow it; Render
  // Postgres does. Failure only disables trigram matching, never the migration.
  try {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (err) {
    console.warn('[046] pg_trgm unavailable — dedupe falls back to prefix matching:', err.message);
  }

  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });
  const userFk = (allowNull = true) => ({
    type: UUID, allowNull, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL',
  });

  if (!tables.includes('partner_organisations')) {
    await queryInterface.createTable('partner_organisations', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      legalName: { type: Sequelize.STRING(160) },
      tradingName: { type: Sequelize.STRING(160) },
      brandName: { type: Sequelize.STRING(120) },
      normalizedName: { type: Sequelize.STRING(160), allowNull: false },
      uen: { type: Sequelize.STRING(16) },
      website: { type: Sequelize.STRING(255) },
      websiteDomain: { type: Sequelize.STRING(160) },
      primaryPhone: { type: Sequelize.STRING(20) },
      primaryEmail: { type: Sequelize.STRING(160) },
      instagramHandle: { type: Sequelize.STRING(64) },
      tiktokHandle: { type: Sequelize.STRING(64) },
      facebookUrl: { type: Sequelize.STRING(255) },
      facebookHandle: { type: Sequelize.STRING(120) },
      linkedinUrl: { type: Sequelize.STRING(255) },
      category: { type: Sequelize.STRING(64) },
      subcategory: { type: Sequelize.STRING(64) },
      source: { type: Sequelize.STRING(64) },
      tags: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      notes: { type: Sequelize.TEXT },
      pipelineStage: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'UNCLAIMED' },
      availability: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'available' },
      ownerUserId: userFk(),
      claimedAt: { type: Sequelize.DATE },
      firstOutreachAt: { type: Sequelize.DATE },
      lastActivityAt: { type: Sequelize.DATE },
      nextTaskAt: { type: Sequelize.DATE },
      atRiskFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      staleFlag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      mergedIntoId: { type: UUID, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'SET NULL' },
      archivedAt: { type: Sequelize.DATE },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      ...ts(),
    });
  }

  if (!tables.includes('partner_locations')) {
    await queryInterface.createTable('partner_locations', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(120) },
      addressLine: { type: Sequelize.STRING(255) },
      postalCode: { type: Sequelize.STRING(6) },
      postalDistrict: { type: Sequelize.STRING(2) },
      area: { type: Sequelize.STRING(64) },
      phone: { type: Sequelize.STRING(20) },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.TEXT },
      ...ts(),
    });
  }

  if (!tables.includes('partner_contacts')) {
    await queryInterface.createTable('partner_contacts', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(120), allowNull: false },
      roleTitle: { type: Sequelize.STRING(80) },
      mobile: { type: Sequelize.STRING(20) },
      whatsapp: { type: Sequelize.STRING(20) },
      email: { type: Sequelize.STRING(160) },
      preferredChannel: { type: Sequelize.STRING(24) },
      isPrimary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      notes: { type: Sequelize.TEXT },
      archivedAt: { type: Sequelize.DATE },
      ...ts(),
    });
  }

  if (!tables.includes('partner_assignment_events')) {
    await queryInterface.createTable('partner_assignment_events', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      kind: { type: Sequelize.STRING(24), allowNull: false },
      fromUserId: userFk(),
      toUserId: userFk(),
      actorUserId: userFk(),
      reason: { type: Sequelize.STRING(255) },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  if (!tables.includes('partner_stage_events')) {
    await queryInterface.createTable('partner_stage_events', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      fromStage: { type: Sequelize.STRING(32) },
      toStage: { type: Sequelize.STRING(32), allowNull: false },
      actorUserId: userFk(),
      reason: { type: Sequelize.STRING(255) },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  // partner_organisations indexes — ALWAYS run, IF NOT EXISTS (independent of the
  // table-exists branch so a crashed partial run can't skip them; 045 pattern).
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_po_uen ON partner_organisations ("uen") WHERE "uen" IS NOT NULL');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_po_phone ON partner_organisations ("primaryPhone") WHERE "primaryPhone" IS NOT NULL');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_po_instagram ON partner_organisations ("instagramHandle") WHERE "instagramHandle" IS NOT NULL');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_po_tiktok ON partner_organisations ("tiktokHandle") WHERE "tiktokHandle" IS NOT NULL');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_normalized_name ON partner_organisations ("normalizedName")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_domain ON partner_organisations ("websiteDomain")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_owner_stage ON partner_organisations ("ownerUserId", "pipelineStage")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_stage ON partner_organisations ("pipelineStage")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_availability ON partner_organisations ("availability")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_category ON partner_organisations ("category")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_last_activity ON partner_organisations ("lastActivityAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_po_next_task ON partner_organisations ("nextTaskAt")');
  // Trigram index only when the extension made it in (best-effort)
  try {
    await idx('CREATE INDEX IF NOT EXISTS idx_po_name_trgm ON partner_organisations USING gin ("normalizedName" gin_trgm_ops)');
  } catch (err) {
    console.warn('[046] trigram index skipped:', err.message);
  }

  if (!tables.includes('outreach_activities')) {
    await queryInterface.createTable('outreach_activities', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      contactId: { type: UUID, references: { model: 'partner_contacts', key: 'id' }, onDelete: 'SET NULL' },
      type: { type: Sequelize.STRING(32), allowNull: false },
      direction: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'outbound' },
      summary: { type: Sequelize.STRING(255), allowNull: false },
      details: { type: Sequelize.TEXT },
      outcome: { type: Sequelize.STRING(64) },
      occurredAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      actorUserId: userFk(),
      editedAt: { type: Sequelize.DATE },
      editedBy: { type: UUID },
      voidedAt: { type: Sequelize.DATE },
      voidReason: { type: Sequelize.STRING(255) },
      ...ts(),
    });
  }

  // Child-table indexes — same always-run IF NOT EXISTS treatment.
  await idx('CREATE INDEX IF NOT EXISTS idx_pl_partner ON partner_locations ("partnerOrganisationId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_pl_postal ON partner_locations ("postalCode")');
  await idx('CREATE INDEX IF NOT EXISTS idx_pc_partner ON partner_contacts ("partnerOrganisationId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_pae_partner_created ON partner_assignment_events ("partnerOrganisationId", "createdAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_pse_partner_created ON partner_stage_events ("partnerOrganisationId", "createdAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_oa_partner_occurred ON outreach_activities ("partnerOrganisationId", "occurredAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_oa_actor_occurred ON outreach_activities ("actorUserId", "occurredAt")');
}

export async function down(queryInterface) {
  // Reverse dependency order; CASCADE clears FK references defensively.
  for (const table of [
    'outreach_activities',
    'partner_stage_events',
    'partner_assignment_events',
    'partner_contacts',
    'partner_locations',
    'partner_organisations',
  ]) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  // pg_trgm extension is left installed (shared, harmless).
}
