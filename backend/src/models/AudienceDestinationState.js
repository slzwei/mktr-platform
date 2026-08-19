import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Per-destination settlement watermark (migration 128, ads-centralisation
 * §5.1). Exactly one row per (platform, destinationId).
 * `oldestUnsettledAcceptAt` NULL means every accepted additive ingest has
 * settled — the ONLY state in which a removal may dispatch to that
 * destination (zero unsettled ingests; no timestamp comparison).
 */
const AudienceDestinationState = sequelize.define('AudienceDestinationState', {
  platform: { type: DataTypes.STRING(16), primaryKey: true },
  destinationId: { type: DataTypes.STRING(64), primaryKey: true },
  lastIngestAcceptedAt: { type: DataTypes.DATE, allowNull: true },
  oldestUnsettledAcceptAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'audience_destination_state',
});

export default AudienceDestinationState;
