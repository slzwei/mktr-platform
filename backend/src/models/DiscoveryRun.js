import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * One Apify prospecting search (migration 053). Lifecycle:
 * pending → running → completed | failed | aborted | timed_out.
 * Concurrency posture: there is deliberately NO row lock — a duplicate
 * webhook/reconcile double-process is benign because materialization dedupes on
 * the (discoveryRunId, externalPlaceId) unique index and enrichment fills blanks.
 * Owns discovery_candidates. See ~/.claude/plans/redeem-ops-discover-tool.md.
 */
const DiscoveryRun = sequelize.define('DiscoveryRun', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  // M11: nullable + ON DELETE SET NULL (migration 110) — paid discovery
  // history (provider run ids, costs, raw results, quota rows) must OUTLIVE
  // the operator who fired it. createdByEmail is the immutable identity
  // snapshot stamped at run creation.
  createdBy: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  createdByEmail: { type: DataTypes.STRING(160), allowNull: true },
  provider: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'apify_google_maps' },
  category: { type: DataTypes.STRING(64), allowNull: true },
  area: { type: DataTypes.STRING(120), allowNull: true },
  requestedLimit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
  providerRunId: { type: DataTypes.STRING(64), allowNull: true },
  providerDatasetId: { type: DataTypes.STRING(64), allowNull: true },
  resultCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  estimatedCostUsd: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
  actualCostUsd: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
  error: { type: DataTypes.TEXT, allowNull: true },
  rawPayload: { type: DataTypes.JSONB, allowNull: true },
  startedAt: { type: DataTypes.DATE, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'discovery_runs',
});

export default DiscoveryRun;
