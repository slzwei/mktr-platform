import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Immutable, versioned consumer-scoring configuration
 * (docs/plans/consumer-profile-enrichment.md §7.2) — NOT AiSettings, which
 * is a fixed-column singleton whose route schema strips unknown keys
 * (Codex R1 #15).
 *
 * Rows are append-only; the highest version wins. configJson carries
 * component weight overrides + targetSegments, e.g.
 *   { targetSegments: [{ language: 'zh', ethnicity: 'chinese', weight: 1 }] }
 * Retargeting to a different market segment is ONE new row here — no deploy.
 * Any config change recomputes ALL score components on the next sweep, and
 * scoreBreakdown rows record which version scored them, so historical
 * breakdowns stay interpretable forever (R3 #11).
 *
 * SCOPE + LIFECYCLE (per-campaign-lead-scoring.md §9, migration 100). A row
 * binds ONE scope — campaign, product, or global — and resolution walks
 * campaign → product → global taking the highest APPROVED version at the first
 * step that matches. `version` stays the primary key and the single global
 * sequence, so the integer stamped on a scored row identifies its config
 * unambiguously no matter which scope won.
 */
const EnrichmentScoringConfig = sequelize.define('EnrichmentScoringConfig', {
  // autoIncrement is what makes sync({force:true}) build this column with a
  // sequence in the test database (bootstrap.js syncs from models BEFORE
  // running migrations, and a reused test DB skips migration 100 entirely
  // because `_migrations` survives the sync). Without it, every runtime insert
  // that omits `version` would work in prod and fail in test.
  version: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  configJson: { type: DataTypes.JSONB, allowNull: false },
  // Scope tags. Deliberately NO association/FK on campaignId — snapshot
  // semantics, see migration 100's header.
  campaignId: { type: DataTypes.UUID, allowNull: true },
  productKey: { type: DataTypes.STRING(24), allowNull: true },
  // draft | approved | superseded. Only 'approved' rows are ever resolved;
  // 'approved' is the default so pre-100 rows grandfather as live.
  status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'approved' },
  activatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actorUserId: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'enrichment_scoring_configs'
});

export default EnrichmentScoringConfig;
