import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The suppression-propagation projection (tracker "propagate" + resubscribe
 * lift, plan v3): one row per (subscriber, lead, scope), each a tiny state
 * machine — `state` is the DESIRED downstream state ('suppressed'|'lifted'),
 * `deliveredState` what the last queued delivery conveyed; needs-queue ⇔
 * they differ (or the delivery terminally failed/purged). DERIVED state: the
 * reconciler recomputes rows from consumer_suppressions/consumers.erasedAt +
 * qualified resubscribe ledger evidence ⨝ prospects ⨝ delivery history; the
 * unique index makes concurrent reconciles idempotent (ON CONFLICT DO
 * NOTHING) and flips are authoritative single statements. The 'all' scope
 * (erasure) is a latch and never lifts; 'marketing' flips both ways —
 * lead.suppressed / lead.unsuppressed.
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
    validate: { isIn: [['unsubscribe', 'complaint', 'admin', 'erasure', 'resubscribe']] },
  },
  occurredAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Authoritative transition time (suppression.createdAt / erasedAt / resubscribe event) — stable across repairs',
  },
  state: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'suppressed',
    validate: { isIn: [['suppressed', 'lifted']] },
    comment: "Desired downstream state; 'all'-scope pairs are a latch and never flip to lifted",
  },
  deliveredState: {
    type: DataTypes.STRING(16),
    allowNull: true,
    validate: { isIn: [['suppressed', 'lifted']] },
    comment: 'What the last queued delivery conveyed; null = nothing queued. Needs-queue = differs from state.',
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
    // 086's real index is partial on ("deliveredState" IS DISTINCT FROM state)
    // — inexpressible in a model `where`; test schemas get the full index
    // (perf-only difference), prod gets the partial from the migration.
    { fields: ['createdAt'], name: 'idx_sp_state_pending' },
  ],
});

export default SuppressionPropagation;
