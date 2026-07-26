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
 */
const EnrichmentScoringConfig = sequelize.define('EnrichmentScoringConfig', {
  version: { type: DataTypes.INTEGER, primaryKey: true },
  configJson: { type: DataTypes.JSONB, allowNull: false },
  activatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actorUserId: { type: DataTypes.UUID, allowNull: true }
}, {
  tableName: 'enrichment_scoring_configs'
});

export default EnrichmentScoringConfig;
