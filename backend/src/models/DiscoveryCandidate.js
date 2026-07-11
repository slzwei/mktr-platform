import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A business found by a DiscoveryRun (migration 053). Deduped against existing
 * partners (dedupeStatus) and one-click-addable to the pipeline (status/addedPartnerId).
 * Instagram enrichment fields fill in on-demand (§2.6 of the spec).
 */
const DiscoveryCandidate = sequelize.define('DiscoveryCandidate', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  discoveryRunId: { type: DataTypes.UUID, allowNull: false, references: { model: 'discovery_runs', key: 'id' } },
  externalPlaceId: { type: DataTypes.STRING(128), allowNull: true },
  name: { type: DataTypes.STRING(200), allowNull: true },
  primaryPhone: { type: DataTypes.STRING(32), allowNull: true },
  website: { type: DataTypes.STRING(255), allowNull: true },
  websiteDomain: { type: DataTypes.STRING(160), allowNull: true },
  instagramHandle: { type: DataTypes.STRING(64), allowNull: true },
  address: { type: DataTypes.STRING(255), allowNull: true },
  area: { type: DataTypes.STRING(64), allowNull: true },
  rating: { type: DataTypes.DECIMAL(2, 1), allowNull: true },
  reviewsCount: { type: DataTypes.INTEGER, allowNull: true },
  sourceUrl: { type: DataTypes.STRING(500), allowNull: true },
  dedupeStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'new' },
  matchedPartnerId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_organisations', key: 'id' } },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
  addedPartnerId: { type: DataTypes.UUID, allowNull: true, references: { model: 'partner_organisations', key: 'id' } },
  enrichmentStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' },
  isVerified: { type: DataTypes.BOOLEAN, allowNull: true },
  followersCount: { type: DataTypes.INTEGER, allowNull: true },
  email: { type: DataTypes.STRING(160), allowNull: true },
  bio: { type: DataTypes.TEXT, allowNull: true },
  enrichedAt: { type: DataTypes.DATE, allowNull: true },
  enrichmentSource: { type: DataTypes.STRING(32), allowNull: true },
  rawPayload: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: 'discovery_candidates',
});

export default DiscoveryCandidate;
