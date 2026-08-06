import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable inbox for Meta leadgen webhook events
 * (docs/plans/meta-lead-ads-native-pipe.md §2.2).
 *
 * The webhook handler upserts a row and 200s; the worker does the Graph
 * fetch + prospect creation with backoff. The UNIQUE leadgenId is the
 * PERMANENT protocol dedupe (deliberately not the TTL'd idempotency_keys
 * table — its hourly expiry purge would eventually re-admit a replay).
 * prospectId is a plain UUID on purpose: the inbox row is an audit trail
 * that must survive whatever later happens to the prospect.
 */
const MetaLeadgenEvent = sequelize.define('MetaLeadgenEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  leadgenId: { type: DataTypes.STRING(64), allowNull: false },
  pageId: { type: DataTypes.STRING(64), allowNull: true },
  formId: { type: DataTypes.STRING(64), allowNull: true },
  createdTime: { type: DataTypes.BIGINT, allowNull: true, comment: 'Meta unix seconds' },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [['pending', 'completed', 'duplicate', 'dead']] },
  },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  prospectId: { type: DataTypes.UUID, allowNull: true },
}, {
  tableName: 'meta_leadgen_events',
  indexes: [
    { unique: true, fields: ['leadgenId'], name: 'uq_meta_leadgen_events_leadgen_id' },
    { fields: ['status', 'nextAttemptAt'], name: 'idx_mle_status_next' },
  ],
});

export default MetaLeadgenEvent;
