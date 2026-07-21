import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The suppression-propagation projection (tracker "propagate", plan §1): one
 * row per (subscriber, lead, scope) that must receive — or has received — a
 * `lead.suppressed` webhook. DERIVED state: the reconciler recomputes rows
 * from consumer_suppressions/consumers.erasedAt ⨝ prospects ⨝ delivery
 * history; the unique index makes concurrent reconciles idempotent
 * (ON CONFLICT DO NOTHING). `queuedAt IS NULL` = delivery row not yet
 * created. Scope is monotonic — 'all' joins 'marketing', never replaces it;
 * there is no unsuppression event in v1.
 *
 * consumerId is provenance ONLY and never appears in webhook payloads
 * (spine payload contract, Decisions #8).
 */
const SuppressionPropagation = sequelize.define('SuppressionPropagation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  consumerId: { type: DataTypes.UUID, allowNull: false, references: { model: 'consumers', key: 'id' } },
  prospectId: { type: DataTypes.UUID, allowNull: false, references: { model: 'prospects', key: 'id' } },
  subscriberId: { type: DataTypes.UUID, allowNull: false, references: { model: 'webhook_subscribers', key: 'id' } },
  scope: {
    type: DataTypes.STRING(16),
    allowNull: false,
    validate: { isIn: [['marketing', 'all']] },
  },
  reason: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [['unsubscribe', 'complaint', 'admin', 'erasure']] },
  },
  occurredAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Authoritative transition time (suppression.createdAt / consumer.erasedAt) — stable across repairs',
  },
  deliveryId: { type: DataTypes.UUID, allowNull: true },
  queuedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'suppression_propagations',
  indexes: [
    // Mirrored on the model (sync-built test schemas) — the idempotency key.
    { unique: true, fields: ['subscriberId', 'prospectId', 'scope'], name: 'uq_sp_sub_prospect_scope' },
    { fields: ['consumerId'], name: 'idx_sp_consumer' },
    { fields: ['createdAt'], name: 'idx_sp_needs_queue', where: { queuedAt: null } },
  ],
});

export default SuppressionPropagation;
