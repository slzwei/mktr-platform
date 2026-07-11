/**
 * 056 — Discover: cross-run place memory
 * (plan: ~/.claude/plans/redeem-ops-discover-cross-run-memory.md, Codex-reviewed).
 *
 * discovery_place_memory = one row per Google place ever seen, recording the
 * team's latest intent (dismissed / added) + sighting counters + a handle-keyed
 * enrichment cache. Deliberately holds NO scraped contact data (the whitelist
 * lives in discoveryService.buildMemoryEnrichment); erasure requests are honored
 * by deleting the row for a place id.
 *
 * Also adds discovery_candidates."previouslySeenAt" (render "Seen previously").
 *
 * Backfill: seeds memory from candidate rows that already exist so
 * pre-deployment dismissals/additions/enrichments are not forgotten. Precedence
 * added > dismissed. Every step guarded/idempotent (045–055 pattern; safe under
 * NODE_ENV=test sync-first where the table is created by model sync first).
 */
export async function up(queryInterface, Sequelize) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('discovery_place_memory')) {
    await queryInterface.createTable('discovery_place_memory', {
      externalPlaceId: { type: Sequelize.STRING(128), primaryKey: true, allowNull: false },
      timesSeen: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      firstSeenAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      lastSeenAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      // Reprocessing guard: a duplicate webhook/reconcile re-materialization of
      // the SAME run must not inflate timesSeen (exactly-once per run).
      lastSeenRunId: { type: Sequelize.UUID, allowNull: true },
      dismissedAt: { type: Sequelize.DATE, allowNull: true },
      addedPartnerId: {
        type: Sequelize.UUID, allowNull: true,
        references: { model: 'partner_organisations', key: 'id' }, onDelete: 'SET NULL',
      },
      lastEnrichment: { type: Sequelize.JSONB, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  await q('ALTER TABLE discovery_candidates ADD COLUMN IF NOT EXISTS "previouslySeenAt" TIMESTAMPTZ');

  // ── Backfill from existing candidate rows (idempotent: ON CONFLICT DO NOTHING) ──
  // timesSeen = distinct runs that saw the place; added beats dismissed;
  // enrichment cache keyed to the handle it was scraped for.
  await q(`
    INSERT INTO discovery_place_memory
      ("externalPlaceId", "timesSeen", "firstSeenAt", "lastSeenAt", "lastSeenRunId",
       "dismissedAt", "addedPartnerId", "lastEnrichment", "createdAt", "updatedAt")
    SELECT
      c."externalPlaceId",
      COUNT(DISTINCT c."discoveryRunId"),
      MIN(c."createdAt"),
      MAX(c."createdAt"),
      NULL,
      CASE WHEN BOOL_OR(c.status = 'added') THEN NULL
           ELSE MAX(c."updatedAt") FILTER (WHERE c.status = 'dismissed') END,
      (ARRAY_AGG(c."addedPartnerId" ORDER BY c."updatedAt" DESC)
         FILTER (WHERE c.status = 'added' AND c."addedPartnerId" IS NOT NULL))[1],
      (ARRAY_AGG(
         CASE WHEN c."followersCount" IS NULL AND c."isVerified" IS NULL THEN NULL
              ELSE jsonb_strip_nulls(jsonb_build_object(
                'handle', LOWER(c."instagramHandle"),
                'followersCount', c."followersCount",
                'isVerified', c."isVerified",
                'enrichedAt', c."enrichedAt"))
         END ORDER BY c."enrichedAt" DESC NULLS LAST)
         FILTER (WHERE c."enrichmentStatus" = 'enriched' AND c."instagramHandle" IS NOT NULL))[1],
      NOW(), NOW()
    FROM discovery_candidates c
    WHERE c."externalPlaceId" IS NOT NULL
    GROUP BY c."externalPlaceId"
    ON CONFLICT ("externalPlaceId") DO NOTHING
  `);
}

export async function down(queryInterface) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS discovery_place_memory');
  await q('ALTER TABLE discovery_candidates DROP COLUMN IF EXISTS "previouslySeenAt"');
}
