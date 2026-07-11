import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Cross-run Discover memory (migration 056): one row per Google place ever seen,
 * recording the team's LATEST intent — dismissed-once stays hidden, added links
 * instantly, enrichment metrics carry forward (handle-keyed). Holds NO scraped
 * contact data by design (whitelist: discoveryService.buildMemoryEnrichment);
 * erasure = delete the row. timesSeen counts DISTINCT runs — lastSeenRunId
 * guards against duplicate webhook/reconcile re-materialization inflating it.
 */
const DiscoveryPlaceMemory = sequelize.define('DiscoveryPlaceMemory', {
  externalPlaceId: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
  timesSeen: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  firstSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  lastSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  lastSeenRunId: { type: DataTypes.UUID, allowNull: true },
  dismissedAt: { type: DataTypes.DATE, allowNull: true },
  addedPartnerId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_organisations', key: 'id' } },
  // { handle, followersCount, isVerified, enrichedAt } — null-stripped
  lastEnrichment: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: 'discovery_place_memory',
});

export default DiscoveryPlaceMemory;
